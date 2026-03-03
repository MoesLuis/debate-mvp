import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import supabaseAdmin from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type CreateUploadBody = {
  topicId: number;
  questionId: number;
  stance?: "neutral" | "pro" | "against";
  parentTakeId?: string | null; // can be root OR a response; server will normalize to root
  isChallengeable?: boolean;
  durationSeconds?: number; // <-- client already sends this
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

function getCorsOrigin(req: NextRequest) {
  // Mux expects a concrete origin string (not "*").
  // Prefer Origin header; fallback to a known site URL if present.
  const origin = req.headers.get("origin");
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL;

  if (origin && origin !== "null") return origin;
  if (site) {
    const normalized = site.startsWith("http") ? site : `https://${site}`;
    return normalized;
  }
  // Last resort: omit cors_origin (Mux will apply default behavior)
  return null;
}

function isRateLimitError(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  const details = String(err?.details ?? "").toLowerCase();
  const code = String(err?.code ?? "");

  // Your trigger raises errcode 'P0001' and message "Rate limit: ..."
  if (code === "P0001" && msg.includes("rate limit")) return true;
  if (msg.includes("rate limit")) return true;
  if (details.includes("rate limit")) return true;

  return false;
}

export async function POST(req: NextRequest) {
  try {
    // 1) Require Bearer token (Supabase session token)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2) Authed Supabase client to identify user
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

    // 3) Read body
    const body = (await req.json()) as CreateUploadBody;

    const requestedTopicId = Number(body?.topicId);
    const requestedQuestionId = Number(body?.questionId);

    const stance: "neutral" | "pro" | "against" =
      body?.stance === "pro" || body?.stance === "against" ? body.stance : "neutral";

    const parentTakeIdRaw = body?.parentTakeId ? String(body.parentTakeId) : null;

    const durationSeconds =
      typeof body?.durationSeconds === "number" && Number.isFinite(body.durationSeconds)
        ? Math.max(1, Math.min(60, Math.round(body.durationSeconds)))
        : null;

    if (!Number.isFinite(requestedTopicId) || !Number.isFinite(requestedQuestionId)) {
      return NextResponse.json(
        { error: "Missing or invalid topicId/questionId" },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------
    // 4) Normalize replies to ROOT:
    //    - If parentTakeId is provided, it may be root or response.
    //    - We compute rootTakeId = parent.parent_take_id ?? parent.id
    //    - We force topic/question to match the ROOT take.
    // ---------------------------------------------------------
    let finalParentTakeId: string | null = null;
    let finalTopicId = requestedTopicId;
    let finalQuestionId = requestedQuestionId;

    if (parentTakeIdRaw) {
      // Fetch the referenced take (could be root or response)
      const { data: parent, error: pErr } = await supabaseAdmin
        .from("takes")
        .select("id, parent_take_id, topic_id, question_id")
        .eq("id", parentTakeIdRaw)
        .maybeSingle();

      if (pErr || !parent) {
        return NextResponse.json({ error: "Parent take not found" }, { status: 404 });
      }

      const rootTakeId = parent.parent_take_id ?? parent.id;

      // Fetch the root take (must exist)
      const { data: root, error: rErr } = await supabaseAdmin
        .from("takes")
        .select("id, parent_take_id, topic_id, question_id")
        .eq("id", rootTakeId)
        .maybeSingle();

      if (rErr || !root) {
        return NextResponse.json({ error: "Root take not found" }, { status: 404 });
      }

      // Root must actually be root
      if (root.parent_take_id) {
        return NextResponse.json(
          { error: "Invalid root take (root take cannot have a parent)." },
          { status: 400 }
        );
      }

      // Force reply to attach to ROOT (no branching)
      finalParentTakeId = root.id;

      // Force topic/question to match ROOT (prevents mismatch issues)
      finalTopicId = root.topic_id;
      finalQuestionId = root.question_id;

      // Optional: if client sent different values, fail loudly (helps debugging)
      if (requestedTopicId !== finalTopicId || requestedQuestionId !== finalQuestionId) {
        return NextResponse.json(
          { error: "Reply must match the root take's topic/question." },
          { status: 400 }
        );
      }
    }

    // NEW: Only ROOT takes can be challengeable
    const isChallengeable = finalParentTakeId ? false : !!body?.isChallengeable;

    // 5) Ensure question belongs to topic (using FINAL ids)
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

    // 6) Create Mux Direct Upload (signed upload URL)
    const corsOrigin = getCorsOrigin(req);

    const muxRes = await fetch("https://api.mux.com/video/v1/uploads", {
      method: "POST",
      headers: {
        Authorization: muxAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(corsOrigin ? { cors_origin: corsOrigin } : {}),
        new_asset_settings: { playback_policies: ["public"] },
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

    // 7) Create the takes row
    const { data: takeRow, error: takeErr } = await supabaseAdmin
      .from("takes")
      .insert({
        user_id: user.id,
        topic_id: finalTopicId,
        question_id: finalQuestionId,
        parent_take_id: finalParentTakeId, // ALWAYS root when replying
        stance,
        is_challengeable: isChallengeable,

        video_provider: "mux",
        video_ref: uploadId,
        playback_id: null,
        status: "uploading",

        ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {}),
      })
      .select("id")
      .single();

    if (takeErr || !takeRow) {
      if (isRateLimitError(takeErr)) {
        return NextResponse.json(
          { error: "Rate limit: max 4 root takes per hour. Try again soon." },
          { status: 429 }
        );
      }

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