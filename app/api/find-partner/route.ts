// app/api/find-partner/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { nanoid } from "nanoid";

type Stance = "in_favor" | "against";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const forcedTopicId: number | null =
      body?.topicId != null ? Number(body.topicId) : null;

    const forcedQuestionId: number | null =
      body?.questionId != null ? Number(body.questionId) : null;

    const forcedStance: Stance | null =
      body?.stance === "in_favor" || body?.stance === "against"
        ? body.stance
        : null;

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

    const {
      data: { user },
    } = await supabaseAuthed.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = user.id;

    // ---------------- QUESTION + STANCE MATCHMAKING ----------------
    if (forcedQuestionId != null) {
      if (!forcedStance) {
        return NextResponse.json(
          { error: "A stance is required for question matchmaking." },
          { status: 400 }
        );
      }

      const { data: questionRow, error: questionErr } = await supabaseAdmin
        .from("questions")
        .select("id, topic_id, is_active")
        .eq("id", forcedQuestionId)
        .maybeSingle();

      if (questionErr) {
        return NextResponse.json({ error: questionErr.message }, { status: 500 });
      }

      if (!questionRow || questionRow.is_active !== true) {
        return NextResponse.json(
          { error: "Question not found or inactive." },
          { status: 404 }
        );
      }

      const topicId = Number(questionRow.topic_id);
      const oppositeStance: Stance =
        forcedStance === "in_favor" ? "against" : "in_favor";

      const { data: partnerRow, error: partnerErr } = await supabaseAdmin
        .from("queue")
        .select("user_id, topic_id, question_id, stance")
        .eq("question_id", forcedQuestionId)
        .eq("stance", oppositeStance)
        .neq("user_id", userId)
        .order("inserted_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (partnerErr) {
        return NextResponse.json({ error: partnerErr.message }, { status: 500 });
      }

      if (partnerRow) {
        const room = `deb-${nanoid(6)}`;

        const { error: matchInsertErr } = await supabaseAdmin.from("matches").insert({
          user_a: partnerRow.user_id,
          user_b: userId,
          topic_id: topicId,
          question_id: forcedQuestionId,
          user_a_stance: partnerRow.stance,
          user_b_stance: forcedStance,
          room_slug: room,
          room_name: room,
          status: "active",
        });

        if (matchInsertErr) {
          return NextResponse.json(
            { error: matchInsertErr.message },
            { status: 500 }
          );
        }

        const { error: queueDeleteErr } = await supabaseAdmin
          .from("queue")
          .delete()
          .in("user_id", [userId, partnerRow.user_id]);

        if (queueDeleteErr) {
          return NextResponse.json(
            { error: queueDeleteErr.message },
            { status: 500 }
          );
        }

        return NextResponse.json({ match: room });
      }

      const { error: upsertErr } = await supabaseAdmin.from("queue").upsert(
        {
          user_id: userId,
          topic_id: topicId,
          question_id: forcedQuestionId,
          stance: forcedStance,
          rating: 1000,
          inserted_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }

      return NextResponse.json({ match: null });
    }

    // ---------------- GENERAL TOPIC MATCHMAKING ----------------
    let topicIds: number[] = [];

    if (forcedTopicId != null) {
      topicIds = [forcedTopicId];
    } else {
      const { data, error } = await supabaseAuthed
        .from("user_topics")
        .select("topic_id")
        .eq("user_id", userId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: "No topics selected" },
          { status: 400 }
        );
      }

      topicIds = data.map((t) => Number(t.topic_id));
    }

    const { data: partnerRow, error: partnerErr } = await supabaseAdmin
      .from("queue")
      .select("user_id, topic_id")
      .in("topic_id", topicIds)
      .is("question_id", null)
      .is("stance", null)
      .neq("user_id", userId)
      .order("inserted_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (partnerErr) {
      return NextResponse.json({ error: partnerErr.message }, { status: 500 });
    }

    if (partnerRow) {
      const room = `deb-${nanoid(6)}`;

      const { error: matchInsertErr } = await supabaseAdmin.from("matches").insert({
        user_a: partnerRow.user_id,
        user_b: userId,
        topic_id: partnerRow.topic_id,
        room_slug: room,
        room_name: room,
        status: "active",
      });

      if (matchInsertErr) {
        return NextResponse.json(
          { error: matchInsertErr.message },
          { status: 500 }
        );
      }

      const { error: queueDeleteErr } = await supabaseAdmin
        .from("queue")
        .delete()
        .in("user_id", [userId, partnerRow.user_id]);

      if (queueDeleteErr) {
        return NextResponse.json(
          { error: queueDeleteErr.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ match: room });
    }

    const { error: upsertErr } = await supabaseAdmin.from("queue").upsert(
      {
        user_id: userId,
        topic_id: topicIds[0],
        question_id: null,
        stance: null,
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