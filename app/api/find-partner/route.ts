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

    // 4) If user is already matched, return that room immediately
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("matches")
      .select("room_slug")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .maybeSingle();

    if (existingErr) {
      return NextResponse.json(
        { error: existingErr.message },
        { status: 500 }
      );
    }

    if (existing?.room_slug) {
      return NextResponse.json({ match: existing.room_slug });
    }

    // 5) Load the user’s selected topics (as the user, so RLS works)
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

    // 6) Find ONE partner already in queue that shares at least one topic
    //    (admin client so we can read queue freely)
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
    if (partnerRow?.user_id && partnerRow?.topic_id) {
      const partnerId = partnerRow.user_id as string;
      const chosenTopic = partnerRow.topic_id as string;

      const room = `deb-${nanoid(6)}`;

      const { error: insertMatchErr } = await supabaseAdmin
        .from("matches")
        .insert({
          user_a: partnerId,
          user_b: userId,
          topic_id: chosenTopic,
          room_slug: room,
        });

      if (insertMatchErr) {
        return NextResponse.json(
          { error: insertMatchErr.message },
          { status: 500 }
        );
      }

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
    //    NOTE: if queue.user_id is unique, this safely updates their row.
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
