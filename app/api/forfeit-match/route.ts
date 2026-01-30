import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { roomSlug } = await req.json();

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

    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("*")
      .eq("room_slug", roomSlug)
      .eq("status", "active")
      .maybeSingle();

    if (!match) return NextResponse.json({ ok: true });

    // Apply 5% penalty
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("skill_rating, collab_rating")
      .eq("user_id", user.id)
      .single();

    if (profile) {
      const skillLoss = Math.ceil(profile.skill_rating * 0.05);
      const collabLoss = Math.ceil(profile.collab_rating * 0.05);

      await supabaseAdmin.rpc("increment_user_ratings", {
        uid: user.id,
        skill_delta: -skillLoss,
        collab_delta: -collabLoss,
      });
    }

    await supabaseAdmin
      .from("matches")
      .update({
        status: "completed",
        agreement_validated: false,
        ended_at: new Date().toISOString(),
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
