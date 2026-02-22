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
    // 🔥 Debug log (temporary)
    console.log("MUX TOKEN ID:", process.env.MUX_TOKEN_ID ? "Loaded" : "Missing");

    // 1) Require Bearer token (Supabase session token)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2) Create an authed Supabase client using the bearer token
    const supabaseAuthed = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const {
      data: { user },
      error: userErr,
    } = await supabaseAuthed.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 3) Read and validate body
    const body = (await req.json()) as CreateUploadBody;

    const topicId = Number(body?.topicId);
    const questionId = Number(body?.questionId);
    const stance =
      body?.stance === "pro" || body?.stance === "against" ? body.stance : "neutral";
    const parentTakeId = body?.parentTakeId ? String(body.parentTakeId) : null;
    const isChallengeable = !!body?.isChallengeable;

    if (!Number.isFinite(topicId) || !Number.isFinite(questionId)) {
      return NextResponse.json(
        { error: "Missing or invalid topicId/questionId" },
        { status: 400 }
      );
    }

    // 4) Ensure question belongs to topic (prevents mismatched ids)
    const { data: qRow, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, topic_id, is_active")
      .eq("id", questionId)
      .maybeSingle();

    if (qErr || !qRow) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }
    if (qRow.topic_id !== topicId) {
      return NextResponse.json(
        { error: "Question does not belong to the selected topic" },
        { status: 400 }
      );
    }
    if (qRow.is_active === false) {
      return NextResponse.json({ error: "Question is not active" }, { status: 400 });
    }

    // 5) Create Mux Direct Upload (signed upload URL)
    // Playback policy is PUBLIC for the resulting asset
    const origin = req.headers.get("origin") || "*";

    const muxRes = await fetch("https://api.mux.com/video/v1/uploads", {
      method: "POST",
      headers: {
        Authorization: muxAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cors_origin: origin,
        new_asset_settings: {
          playback_policies: ["public"],
        },
      }),
    });

    const muxJson = await muxRes.json().catch(() => null);

    if (!muxRes.ok) {
      return NextResponse.json(
        { error: "Mux error creating upload", details: muxJson },
        { status: 502 }
      );
    }

    const uploadId: string | undefined = muxJson?.data?.id;
    const uploadUrl: string | undefined = muxJson?.data?.url;

    if (!uploadId || !uploadUrl) {
      return NextResponse.json(
        { error: "Mux did not return upload url/id", details: muxJson },
        { status: 502 }
      );
    }

    // 6) Create the takes row
    // We store the uploadId temporarily in video_ref until webhook updates with asset/playback_id
    const { data: takeRow, error: takeErr } = await supabaseAdmin
      .from("takes")
      .insert({
        user_id: user.id,
        topic_id: topicId,
        question_id: questionId,
        parent_take_id: parentTakeId,
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