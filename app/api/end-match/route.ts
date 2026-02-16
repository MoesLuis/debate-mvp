import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";

type Outcome = "agreement" | "partial" | "no_agreement";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomSlug, outcome, statement } = body as {
      roomSlug: string;
      outcome: Outcome;
      statement: string;
    };

    if (!roomSlug || !outcome || !statement) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
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
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
    } = await supabaseAuthed.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = user.id;

    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("*")
      .eq("room_slug", roomSlug)
      .eq("status", "active")
      .maybeSingle();

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const isUserA = match.user_a === userId;
    const isUserB = match.user_b === userId;

    if (!isUserA && !isUserB) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    // Save this user's submission (do NOT complete match until both submitted)
    const updates: any = {
      ended_at: new Date().toISOString(), // ok to set once the first person ends
    };

    if (isUserA) {
      updates.user_a_outcome = outcome;
      updates.user_a_statement = statement;
    } else {
      updates.user_b_outcome = outcome;
      updates.user_b_statement = statement;
    }

    await supabaseAdmin.from("matches").update(updates).eq("id", match.id);

    // Reload to see if both are done
    const { data: updated } = await supabaseAdmin
      .from("matches")
      .select("*")
      .eq("id", match.id)
      .maybeSingle();

    const bothSubmitted =
      !!updated?.user_a_outcome &&
      !!updated?.user_b_outcome &&
      !!updated?.user_a_statement &&
      !!updated?.user_b_statement;

    if (!bothSubmitted) {
      return NextResponse.json({ ok: true, waiting: true, completed: false });
    }

    // Phase 1 agreement validation: mutual confirmation only
    const agreementValidated =
      updated.user_a_outcome === "agreement" &&
      updated.user_b_outcome === "agreement";

    const disagreement = updated.user_a_outcome !== updated.user_b_outcome;

    await finalizeRatings(updated, agreementValidated, disagreement);

    return NextResponse.json({ ok: true, waiting: false, completed: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}

async function finalizeRatings(
  match: any,
  agreementValidated: boolean,
  disagreement: boolean
) {
  // CR
  const CR_GAIN = 10;
  const CR_LOSS = 5;
  const CR_DISAGREE_LOSS = 8;

  // SR (simple MVP)
  const SR_GAIN = 5;
  const SR_LOSS = 2;

  const ops: Promise<any>[] = [];

  if (agreementValidated) {
    ops.push(
      adjustRatings(match.user_a, +SR_GAIN, +CR_GAIN),
      adjustRatings(match.user_b, +SR_GAIN, +CR_GAIN)
    );
  } else if (disagreement) {
    ops.push(
      adjustRatings(match.user_a, -SR_LOSS, -CR_DISAGREE_LOSS),
      adjustRatings(match.user_b, -SR_LOSS, -CR_DISAGREE_LOSS)
    );
  } else {
    // both chose partial or both chose no_agreement
    ops.push(
      adjustRatings(match.user_a, -SR_LOSS, -CR_LOSS),
      adjustRatings(match.user_b, -SR_LOSS, -CR_LOSS)
    );
  }

  await Promise.all(ops);

  await supabaseAdmin
    .from("matches")
    .update({
      status: "completed",
      agreement_validated: agreementValidated,
    })
    .eq("id", match.id);
}

async function adjustRatings(
  userId: string,
  skillDelta: number,
  collabDelta: number
) {
  await supabaseAdmin.rpc("increment_user_ratings", {
    uid: userId,
    skill_delta: skillDelta,
    collab_delta: collabDelta,
  });
}
