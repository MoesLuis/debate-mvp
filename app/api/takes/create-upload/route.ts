import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import supabaseAdmin from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type CreateUploadBody = {
  topicId: number;
  questionId: number;
  stance?: "neutral" | "pro" | "against";
  parentTakeId?: string | null;
  isChallengeable?: boolean;
};

function muxAuthHeader() {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    throw new Error("Missing MUX_TOKEN_ID or MUX_TOKEN_SECRET");
  }

  const basic = Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");
  return `Basic ${basic}`;
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const supabaseAuthed = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
      error: userErr,
    } = await supabaseAuthed.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json()) as CreateUploadBody;

    const requestedTopicId = Number(body?.topicId);
    const requestedQuestionId = Number(body?.questionId);

    const stance =
      body?.stance === "pro" || body?.stance === "against" ? body.stance : "neutral";

    const parentTakeIdRaw = body?.parentTakeId ? String(body.parentTakeId) : null;
    const isChallengeable = !!body?.isChallengeable;

    if (!Number.isFinite(requestedTopicId) || !Number.isFinite(requestedQuestionId)) {
      return NextResponse.json(
        { error: "Missing or invalid topicId/questionId" },
        { status: 400 }
      );
    }

    // Normalize replies to ROOT + force topic/question
    let finalParentTakeId: string | null = null;
    let finalTopicId = requestedTopicId;
    let finalQuestionId = requestedQuestionId;

    if (parentTakeIdRaw) {
      const { data: parent, error: pErr } = await supabaseAdmin
        .from("takes")
        .select("id, parent_take_id, topic_id, question_id")
        .eq("id", parentTakeIdRaw)
        .maybeSingle();

      if (pErr || !parent) {
        return NextResponse.json({ error: "Parent take not found" }, { status: 404 });
      }

      const rootTakeId = parent.parent_take_id ?? parent.id;

      const { data: root, error: rErr } = await supabaseAdmin
        .from("takes")
        .select("id, parent_take_id, topic_id, question_id")
        .eq("id", rootTakeId)
        .maybeSingle();

      if (rErr || !root) {
        return NextResponse.json({ error: "Root take not found" }, { status: 404 });
      }

      if (root.parent_take_id) {
        return NextResponse.json(
          { error: "Invalid root take (root take cannot have a parent)." },
          { status: 400 }
        );
      }

      finalParentTakeId = root.id;
      finalTopicId = root.topic_id;
      finalQuestionId = root.question_id;

      if (requestedTopicId !== finalTopicId || requestedQuestionId !== finalQuestionId) {
        return NextResponse.json(
          { error: "Reply must match the root take's topic/question." },
          { status: 400 }
        );
      }
    }

    // Ensure question belongs to topic
    const { data: qRow, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, topic_id, is_active")
      .eq("id", finalQuestionId)
      .maybeSingle();

    if (qErr || !qRow) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }
    if (qRow.topic_id !== finalTopicId) {
      return NextResponse.json(
        { error: "Question does not belong to the selected topic" },
        { status: 400 }
      );
    }
    if (qRow.is_active === false) {
      return NextResponse.json({ error: "Question is not active" }, { status: 400 });
    }

    // ✅ Create Mux Direct Upload
    const originHeader = req.headers.get("origin");
    const corsOrigin =
      originHeader ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "*";

    const muxRes = await fetch("https://api.mux.com/video/v1/uploads", {
      method: "POST",
      headers: {
        Authorization: muxAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cors_origin: corsOrigin,
        new_asset_settings: { playback_policy: ["public"] },
      }),
    });

    const muxJson = await muxRes.json().catch(() => null);

    if (!muxRes.ok) {
      return NextResponse.json(
        {
          error: "Mux error creating upload",
          muxStatus: muxRes.status,
          muxResponse: muxJson,
          debug: {
            corsOrigin,
            hasTokenId: !!process.env.MUX_TOKEN_ID,
            hasTokenSecret: !!process.env.MUX_TOKEN_SECRET,
          },
        },
        { status: 502 }
      );
    }

    const uploadId: string | undefined = muxJson?.data?.id;
    const uploadUrl: string | undefined = muxJson?.data?.url;

    if (!uploadId || !uploadUrl) {
      return NextResponse.json(
        { error: "Mux did not return upload url/id", muxResponse: muxJson },
        { status: 502 }
      );
    }

    const { data: takeRow, error: takeErr } = await supabaseAdmin
      .from("takes")
      .insert({
        user_id: user.id,
        topic_id: finalTopicId,
        question_id: finalQuestionId,
        parent_take_id: finalParentTakeId,
        stance,
        is_challengeable: isChallengeable,

        video_provider: "mux",
        video_ref: uploadId,
        playback_id: null,
        status: "uploading",
      })
      .select("id")
      .single();

    if (takeErr || !takeRow) {
      return NextResponse.json(
        { error: "Failed to create take row", details: takeErr },
        { status: 500 }
      );
    }

    return NextResponse.json({
      takeId: takeRow.id,
      uploadId,
      uploadUrl,
      playbackPolicy: "public",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}