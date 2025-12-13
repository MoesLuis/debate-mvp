import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) {
       return NextResponse.json({ error: "Missing userId" }, { status: 400 });
}

    // 1. Check if user already has a match
    const { data: existing } = await supabase
      .from("matches")
      .select("room_slug")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .maybeSingle();

    if (existing?.room_slug) {
      return NextResponse.json({ match: existing.room_slug });
    }

    // 2. Load my topics
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

        // 3. Load all queued users
    const { data: queued } = await supabase
      .from("queue")
      .select("user_id, topic_id")
      .neq("user_id", userId);

    let partnerId: string | null = null;
    let chosenTopic: string | null = null;

    const queueList = queued || [];

    for (const c of queueList) {
      if (myTopics.find((t) => t.topic_id === c.topic_id)) {
        partnerId = c.user_id;
        chosenTopic = c.topic_id;
        break;
      }
    }


    // 4. Found a partner — create match
    if (partnerId) {
      const room = `deb-${nanoid(6)}`;

      await supabase.from("matches").insert({
        topic_id: chosenTopic,
        user_a: partnerId,
        user_b: userId,
        room_slug: room,
      });

      // remove both from queue
      await supabase.from("queue").delete().in("user_id", [
        userId,
        partnerId,
      ]);

      return NextResponse.json({ match: room });
    }

    // 5. Otherwise — queue myself
    await supabase.from("queue").upsert({
      user_id: userId,
      topic_id: myTopics[0].topic_id,
      rating: 1000,
      inserted_at: new Date(),
    });

    return NextResponse.json({ match: null });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
