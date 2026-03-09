import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import supabaseAdmin from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const roomSlug = String(body?.roomSlug ?? "").trim();

    if (!roomSlug) {
      return NextResponse.json({ error: "Missing roomSlug" }, { status: 400 });
    }

    const livekitUrl = process.env.LIVEKIT_URL;
    const livekitApiKey = process.env.LIVEKIT_API_KEY;
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
      return NextResponse.json(
        { error: "LiveKit environment variables are missing." },
        { status: 500 }
      );
    }

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

    const { data: match, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("id, status, user_a, user_b, room_slug")
      .eq("room_slug", roomSlug)
      .maybeSingle();

    if (matchErr) {
      return NextResponse.json({ error: matchErr.message }, { status: 500 });
    }

    if (!match || match.status !== "active") {
      return NextResponse.json(
        { error: "Match not found or inactive." },
        { status: 404 }
      );
    }

    const isParticipant = match.user_a === user.id || match.user_b === user.id;
    if (!isParticipant) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("handle")
      .eq("user_id", user.id)
      .maybeSingle();

    const displayName =
      (profile?.handle || user.email || "Guest").toString().trim().slice(0, 80) ||
      "Guest";

    const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: user.id,
      name: displayName,
      metadata: JSON.stringify({
        app: "Debate.Me",
        roomSlug,
      }),
    });

    accessToken.addGrant({
      room: roomSlug,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await accessToken.toJwt();

    return NextResponse.json({
      token: jwt,
      url: livekitUrl,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}