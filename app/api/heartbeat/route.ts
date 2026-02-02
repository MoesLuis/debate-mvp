import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";

const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const roomSlug = body?.roomSlug ? String(body.roomSlug) : null;

    if (!roomSlug) {
      return NextResponse.json({ error: "Missing roomSlug" }, { status: 400 });
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
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
    } = await supabaseAuthed.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: match } = await supabaseAdmin
      .from("matches")
      .select(
        `
        id,
        user_a,
        user_b,
        last_heartbeat_a,
        last_heartbeat_b,
        status
      `
      )
      .eq("room_slug", roomSlug)
      .eq("status", "active")
      .maybeSingle();

    if (!match) {
      return NextResponse.json({ ok: true });
    }

    // Update THIS user's heartbeat
    const nowIso = new Date().toISOString();

    if (match.user_a === user.id) {
      await supabaseAdmin
        .from("matches")
        .update({ last_heartbeat_a: nowIso })
        .eq("id", match.id);
    } else if (match.user_b === user.id) {
      await supabaseAdmin
        .from("matches")
        .update({ last_heartbeat_b: nowIso })
        .eq("id", match.id);
    } else {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    // 🔥 SERVER-SIDE DEAD USER CHECK
    const now = Date.now();

    const aDead =
      match.last_heartbeat_a &&
      now - new Date(match.last_heartbeat_a).getTime() > HEARTBEAT_TIMEOUT_MS;

    const bDead =
      match.last_heartbeat_b &&
      now - new Date(match.last_heartbeat_b).getTime() > HEARTBEAT_TIMEOUT_MS;

    if (aDead || bDead) {
      await supabaseAdmin
        .from("matches")
        .update({
          status: "completed",
          agreement_validated: false,
          ended_at: new Date().toISOString(),
        })
        .eq("id", match.id);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
