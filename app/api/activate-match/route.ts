// app/api/activate-match/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import supabaseAdmin from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const roomSlug = String(body?.roomSlug ?? "").trim();

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

    // Must be a participant in the match
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("matches")
      .select("id, status, user_a, user_b, room_slug")
      .eq("room_slug", roomSlug)
      .maybeSingle();

    if (matchErr) {
      return NextResponse.json({ error: matchErr.message }, { status: 500 });
    }

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const isMe = match.user_a === user.id || match.user_b === user.id;
    if (!isMe) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    // Activate if pending; if already active that's fine (idempotent)
    if (match.status !== "active") {
      const { error: upErr } = await supabaseAdmin
        .from("matches")
        .update({
          status: "active",
          starts_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
        })
        .eq("id", match.id);

      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, roomSlug });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}