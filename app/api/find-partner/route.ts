// app/api/find-partner/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const forcedTopicId: number | null =
      body?.topicId != null ? Number(body.topicId) : null;

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const supabaseAuthed = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: { user } } = await supabaseAuthed.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = user.id;

    // Determine topics to use
    let topicIds: number[] = [];

    if (forcedTopicId != null) {
      topicIds = [forcedTopicId];
    } else {
      const { data } = await supabaseAuthed
        .from("user_topics")
        .select("topic_id")
        .eq("user_id", userId);

      if (!data || data.length === 0) {
        return NextResponse.json({ error: "No topics selected" }, { status: 400 });
      }
      topicIds = data.map((t) => Number(t.topic_id));
    }

    // Find partner
    const { data: partnerRow } = await supabaseAdmin
      .from("queue")
      .select("user_id, topic_id")
      .in("topic_id", topicIds)
      .neq("user_id", userId)
      .order("inserted_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (partnerRow) {
      const room = `deb-${nanoid(6)}`;

      await supabaseAdmin.from("matches").insert({
        user_a: partnerRow.user_id,
        user_b: userId,
        topic_id: partnerRow.topic_id,
        room_slug: room,
        room_name: room,
        status: "active",
      });

      await supabaseAdmin
        .from("queue")
        .delete()
        .in("user_id", [userId, partnerRow.user_id]);

      return NextResponse.json({ match: room });
    }

    // Queue user
    await supabaseAdmin.from("queue").upsert(
      {
        user_id: userId,
        topic_id: topicIds[0],
        rating: 1000,
        inserted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    return NextResponse.json({ match: null });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
