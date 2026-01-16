import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";

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
      error: userErr,
    } = await supabaseAuthed.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Make sure the user is part of this active match
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("id, user_a, user_b")
      .eq("room_slug", roomSlug)
      .eq("status", "active")
      .maybeSingle();

    if (matchErr) {
      return NextResponse.json({ error: matchErr.message }, { status: 500 });
    }

    if (!match || (match.user_a !== user.id && match.user_b !== user.id)) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const { error: upErr } = await supabaseAdmin
      .from("matches")
      .update({ last_heartbeat: new Date().toISOString() })
      .eq("id", match.id);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
