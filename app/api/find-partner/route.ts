// app/api/find-partner/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  try {
    // 1) Read token from Authorization header
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2) Create an authed Supabase client (acts as the user for RLS reads)
    const supabaseAuthed = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    // 3) Validate token -> get user
    const {
      data: { user },
      error: authError,
    } = await supabaseAuthed.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = user.id;

    // 4) Load the user’s selected topics FIRST (current truth)
    const { data: myTopics, error: topicsErr } = await supabaseAuthed
      .from("user_topics")
      .select("topic_id")
      .eq("user_id", userId);

    if (topicsErr) {
      return NextResponse.json({ error: topicsErr.message }, { status: 500 });
    }

    if (!myTopics || myTopics.length === 0) {
      return NextResponse.json({ error: "No topics selected" }, { status: 400 });
    }

    const topicIds = myTopics.map((t) => t.topic_id);

    // 5) Check if user is already in an ACTIVE match that still matches their topics
    const { data: existingActive, error: existingErr } = await supabaseAdmin
      .from("matches")
      .select("id, room_slug, topic_id, status")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .eq("status", "active")
      .maybeSingle();

    if (existingErr) {
      return NextResponse.json(
        { error: existingErr.message },
        { status: 500 }
      );
    }

    // If they have an active match AND that match topic is still one of their current topics, reuse it
    if (
      existingActive?.room_slug &&
      existingActive?.topic_id != null &&
      topicIds.includes(existingActive.topic_id)
    ) {
      return NextResponse.json({ match: existingActive.room_slug });
    }

    // OPTIONAL: If they have an active match but it no longer matches their topics,
    // mark it completed so it stops hijacking matchmaking.
    if (existingActive?.id && existingActive?.status === "active") {
      await supabaseAdmin
        .from("matches")
        .update({ status: "completed" })
        .eq("id", existingActive.id);
    }

    // 6) Find ONE partner already in queue that shares at least one topic

    const { data: partnerRow, error: partnerErr } = await supabaseAdmin
      .from("queue")
      .select("user_id, topic_id")
      .in("topic_id", topicIds)
      .neq("user_id", userId)
      .order("inserted_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (partnerErr) {
      return NextResponse.json({ error: partnerErr.message }, { status: 500 });
    }

    // 7) If partner found, create match + remove both from queue
    if (partnerRow?.user_id && partnerRow?.topic_id != null) {
      const partnerId = partnerRow.user_id as string;
      const chosenTopic = partnerRow.topic_id as any; // bigint vs string depends on your DB client typing

      const room = `deb-${nanoid(6)}`;

      const { error: insertMatchErr } = await supabaseAdmin
        .from("matches")
        .insert({
          user_a: partnerId,
          user_b: userId,
          topic_id: chosenTopic,
          room_slug: room,
          room_name: room,
          status: "active",
        });

      if (insertMatchErr) {
        return NextResponse.json(
          { error: insertMatchErr.message },
          { status: 500 }
        );
      }

      // 🔥 DEBUG LOG — confirms matchmaking succeeded
      console.log("MATCH CREATED", {
        room,
        userA: partnerId,
        userB: userId,
        topic: chosenTopic,
      });

      const { error: deleteQueueErr } = await supabaseAdmin
        .from("queue")
        .delete()
        .in("user_id", [userId, partnerId]);

      if (deleteQueueErr) {
        return NextResponse.json(
          { error: deleteQueueErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ match: room });
    }

    // 8) Otherwise, add this user to queue (use their first topic for now)
    
    const { error: upsertErr } = await supabaseAdmin.from("queue").upsert(
      {
        user_id: userId,
        topic_id: topicIds[0],
        rating: 1000,
        inserted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ match: null });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
