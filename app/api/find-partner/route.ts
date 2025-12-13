// app/api/find-partner/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";     // public client for auth
import supabaseAdmin from "@/lib/supabaseAdmin"; // service-role client
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate the current user (from cookies)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    const userId = user.id;

    // 2. Check if user is already matched
    const { data: existing } = await supabaseAdmin
      .from("matches")
      .select("room_slug")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .maybeSingle();

    if (existing?.room_slug) {
      return NextResponse.json({ match: existing.room_slug });
    }

    // 3. Load the user’s selected topics (public client honors RLS)
    const { data: myTopics } = await supabase
      .from("user_topics")
      .select("topic_id")
      .eq("user_id", userId);

    if (!myTopics || myTopics.length === 0) {
      return NextResponse.json(
        { error: "No topics selected" },
        { status: 400 }
      );
    }

    // 4. Search the queue for any other user with at least one shared topic (admin client)
    const { data: queued } = await supabaseAdmin
      .from("queue")
      .select("user_id, topic_id");

    let partnerId: string | null = null;
    let chosenTopic: string | null = null;
    for (const q of queued || []) {
      if (
        q.user_id !== userId &&
        myTopics.some((t) => t.topic_id === q.topic_id)
      ) {
        partnerId = q.user_id;
        chosenTopic = q.topic_id;
        break;
      }
    }

    // 5. If a partner is found, create a match and remove both queue entries
    if (partnerId) {
      const room = `deb-${nanoid(6)}`;
      await supabaseAdmin.from("matches").insert({
        user_a: partnerId,
        user_b: userId,
        topic_id: chosenTopic,
        room_slug: room,
      });

      await supabaseAdmin
        .from("queue")
        .delete()
        .in("user_id", [userId, partnerId]);

      return NextResponse.json({ match: room });
    }

    // 6. Otherwise, add the user to the queue
    await supabaseAdmin.from("queue").upsert({
      user_id: userId,
      topic_id: myTopics[0].topic_id,
      rating: 1000,
      inserted_at: new Date().toISOString(),
    });

    return NextResponse.json({ match: null });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
