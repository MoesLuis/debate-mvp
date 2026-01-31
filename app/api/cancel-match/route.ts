import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { roomSlug } = await req.json();

    if (!roomSlug) {
      return NextResponse.json({ error: "Missing roomSlug" }, { status: 400 });
    }

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
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
    } = await supabaseAuthed.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Only cancel if this user is part of the match and it hasn't started
    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("id, user_a, user_b, status")
      .eq("room_slug", roomSlug)
      .eq("status", "active")
      .maybeSingle();

    if (!match) return NextResponse.json({ ok: true });

    if (match.user_a !== user.id && match.user_b !== user.id) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    // Mark match as completed without penalties
    await supabaseAdmin
      .from("matches")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        agreement_validated: false,
      })
      .eq("id", match.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
