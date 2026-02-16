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
    } = await supabaseAuthed.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = user.id;

    // Only allow retraction while match is still active
    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("id, user_a, user_b, status")
      .eq("room_slug", roomSlug)
      .eq("status", "active")
      .maybeSingle();

    if (!match) {
      // If match already completed, we don't retract (too late)
      return NextResponse.json({ ok: true, ignored: true });
    }

    const isUserA = match.user_a === userId;
    const isUserB = match.user_b === userId;

    if (!isUserA && !isUserB) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const updates: any = {};

    if (isUserA) {
      updates.user_a_outcome = null;
      updates.user_a_statement = null;
    } else {
      updates.user_b_outcome = null;
      updates.user_b_statement = null;
    }

    // Also clear validation flag if it was ever set (safe)
    updates.agreement_validated = null;

    await supabaseAdmin.from("matches").update(updates).eq("id", match.id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
