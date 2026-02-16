import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";

const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds
const JOIN_GRACE_MS = 45_000; // 45 seconds to allow both users to join + start heartbeating

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

    // Load active match (+ created_at for join-grace logic)
    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("id, user_a, user_b, status, created_at")
      .eq("room_slug", roomSlug)
      .eq("status", "active")
      .maybeSingle();

    if (!match) return NextResponse.json({ ok: true });

    // Must be one of the participants
    if (match.user_a !== user.id && match.user_b !== user.id) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const nowIso = new Date().toISOString();

    // 1) Update match-level heartbeat (useful for analytics/monitoring)
    await supabaseAdmin
      .from("matches")
      .update({ last_heartbeat: nowIso })
      .eq("id", match.id);

    // 2) Update per-user presence
    await supabaseAdmin
      .from("match_presence")
      .upsert(
        { room_slug: roomSlug, user_id: user.id, last_seen: nowIso },
        { onConflict: "room_slug,user_id" }
      );

    // 3) Load presence for both users
    const { data: presA } = await supabaseAdmin
      .from("match_presence")
      .select("last_seen")
      .eq("room_slug", roomSlug)
      .eq("user_id", match.user_a)
      .maybeSingle();

    const { data: presB } = await supabaseAdmin
      .from("match_presence")
      .select("last_seen")
      .eq("room_slug", roomSlug)
      .eq("user_id", match.user_b)
      .maybeSingle();

    const now = Date.now();

    // Join grace: if one side hasn't shown up yet, don't end immediately.
    const createdAtMs = match.created_at
      ? new Date(match.created_at).getTime()
      : now;
    const matchAgeMs = now - createdAtMs;

    const aHasPresence = !!presA?.last_seen;
    const bHasPresence = !!presB?.last_seen;

    // If either presence row is missing during the grace window, do nothing.
    if ((!aHasPresence || !bHasPresence) && matchAgeMs < JOIN_GRACE_MS) {
      return NextResponse.json({ ok: true, grace: true });
    }

    // If someone still hasn't shown up after grace, treat as no-show -> end match.
    if (!aHasPresence || !bHasPresence) {
      await supabaseAdmin
        .from("matches")
        .update({
          status: "completed",
          ended_at: new Date().toISOString(),
          agreement_validated: false,
        })
        .eq("id", match.id);

      return NextResponse.json({ ok: true, ended: true, reason: "no_show" });
    }

    // Both present: normal dead-user detection based on last_seen timeouts
    const aLast = new Date(presA!.last_seen).getTime();
    const bLast = new Date(presB!.last_seen).getTime();

    const aDead = now - aLast > HEARTBEAT_TIMEOUT_MS;
    const bDead = now - bLast > HEARTBEAT_TIMEOUT_MS;

    if (aDead || bDead) {
      await supabaseAdmin
        .from("matches")
        .update({
          status: "completed",
          ended_at: new Date().toISOString(),
          agreement_validated: false,
        })
        .eq("id", match.id);

      return NextResponse.json({ ok: true, ended: true, reason: "timeout" });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
