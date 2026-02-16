"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import JitsiRoom from "@/components/JitsiRoom";

type Outcome = "agreement" | "partial" | "no_agreement";

export default function RoomPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const room = typeof slug === "string" ? slug : "";

  const [name, setName] = useState("");

  const [forceExitMsg, setForceExitMsg] = useState<string | null>(null);
  const debateEndedRef = useRef(false);

  // End debate modal state
  const [showEnd, setShowEnd] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("agreement");
  const [statement, setStatement] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [bothSubmitted, setBothSubmitted] = useState(false);
  const [endMsg, setEndMsg] = useState<string | null>(null);

  /* ---------- AUTH + VALIDATE ROOM ---------- */
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: match } = await supabase
        .from("matches")
        .select("status")
        .eq("room_slug", room)
        .maybeSingle();

      if (!match || match.status !== "active") {
        router.replace("/");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", user.id)
        .maybeSingle();

      setName(profile?.handle || user.email || "Guest");
    })();
  }, [room, router]);

  /* ---------- HEARTBEAT ---------- */
  useEffect(() => {
    let t: number;

    async function beat() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      await fetch("/api/heartbeat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomSlug: room }),
        keepalive: true,
      });
    }

    beat();
    t = window.setInterval(beat, 15000);
    return () => clearInterval(t);
  }, [room]);

  /* ---------- REALTIME MATCH UPDATES ---------- */
  useEffect(() => {
    const channel = supabase
      .channel(`match-watch-${room}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `room_slug=eq.${room}`,
        },
        (payload: any) => {
          const row = payload.new;

          // If match ended (disconnect/quit/forfeit/etc)
          if (row?.status && row.status !== "active") {
            setForceExitMsg("Your partner disconnected or quit. Closing room…");
            return;
          }

          // Determine whether BOTH have submitted end-debate data
          const isBothNow =
            !!row?.user_a_outcome &&
            !!row?.user_b_outcome &&
            !!row?.user_a_statement &&
            !!row?.user_b_statement;

          if (isBothNow) {
            setBothSubmitted(true);
            setEndMsg("Both debaters submitted. You may exit.");
          } else {
            // If someone retracts, revert to waiting state
            setBothSubmitted(false);
            if (hasSubmitted) {
              setEndMsg("Waiting for the other debater…");
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  /* ---------- FORCE REDIRECT ON MATCH END ---------- */
  useEffect(() => {
    if (!forceExitMsg) return;
    const t = setTimeout(() => router.replace("/"), 1200);
    return () => clearTimeout(t);
  }, [forceExitMsg, router]);

  /* ---------- INTERCEPT BACK / CLOSE ---------- */
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (debateEndedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }

    async function handleBack() {
      if (debateEndedRef.current) return;

      const ok = window.confirm(
        "Leaving without ending the debate will result in a 5% penalty."
      );

      if (!ok) {
        router.push(`/room/${room}`);
        return;
      }

      debateEndedRef.current = true;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        await fetch("/api/forfeit-match", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roomSlug: room }),
          keepalive: true,
        });
      }

      router.replace("/");
    }

    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", handleBack);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", handleBack);
    };
  }, [room, router]);

  /* ---------- END-DEBATE: submit your side, then wait ---------- */
  async function submitMyEndDebate() {
    setSubmitting(true);
    setEndMsg(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setEndMsg("Not authenticated.");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/api/end-match", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roomSlug: room, outcome, statement }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setEndMsg(data?.error || "Error submitting.");
      setSubmitting(false);
      return;
    }

    setHasSubmitted(true);

    if (data?.completed) {
      setBothSubmitted(true);
      setEndMsg("Both debaters submitted. You may exit.");
    } else {
      setEndMsg("Submitted. Waiting for the other debater…");
    }

    setSubmitting(false);
  }

  /* ---------- NEW: retract your submission if you close after submitting ---------- */
  async function retractMySubmissionAndClose() {
    // If you never submitted, just close
    if (!hasSubmitted) {
      setShowEnd(false);
      return;
    }

    // If both already submitted, don't allow retract (it would be unfair / racey)
    if (bothSubmitted) {
      setShowEnd(false);
      return;
    }

    setSubmitting(true);
    setEndMsg("Retracting your submission…");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      await fetch("/api/retract-end", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomSlug: room }),
      });
    }

    // Reset local state to "as if never ended"
    setHasSubmitted(false);
    setBothSubmitted(false);
    setEndMsg(null);
    setSubmitting(false);
    setShowEnd(false);
  }

  function exitAfterBothSubmitted() {
    if (!bothSubmitted) return;
    debateEndedRef.current = true;
    router.replace("/");
  }

  if (!name) return <p className="text-zinc-400">Loading…</p>;

  return (
    <main className="p-4">
      <div className="flex justify-between mb-3">
        <h1 className="text-xl font-semibold">Room: {room}</h1>
        <button
          onClick={() => {
            setShowEnd(true);
            setEndMsg(null);
          }}
          className="bg-zinc-800 px-3 py-2 rounded"
        >
          End debate
        </button>
      </div>

      {forceExitMsg && (
        <div className="mb-3 rounded border border-red-800 bg-red-900/30 p-3 text-sm">
          {forceExitMsg}
        </div>
      )}

      <JitsiRoom room={room} name={name} />

      {showEnd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
          <div className="bg-zinc-950 p-4 rounded max-w-lg w-full border border-zinc-800">
            <h2 className="text-lg font-semibold">End debate</h2>

            <p className="text-xs text-zinc-400 mt-1">
              You won’t be able to leave until both debaters submit.
            </p>

            <select
              className="w-full mt-3"
              value={outcome}
              disabled={hasSubmitted}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
            >
              <option value="agreement">✅ Agreement reached</option>
              <option value="partial">🤝 Partial agreement</option>
              <option value="no_agreement">❌ No agreement</option>
            </select>

            <textarea
              className="w-full mt-2"
              placeholder="1–3 sentence agreement statement"
              value={statement}
              disabled={hasSubmitted}
              onChange={(e) => setStatement(e.target.value)}
            />

            {endMsg && <p className="mt-2 text-sm text-zinc-300">{endMsg}</p>}

            <div className="flex justify-end mt-4 gap-2">
              <button
                onClick={retractMySubmissionAndClose}
                className="rounded bg-zinc-900 px-3 py-2"
                disabled={submitting}
              >
                Close
              </button>

              {!hasSubmitted ? (
                <button
                  onClick={submitMyEndDebate}
                  disabled={submitting || !statement.trim()}
                  className="rounded bg-zinc-800 px-4 py-2"
                >
                  {submitting ? "Submitting…" : "Submit my response"}
                </button>
              ) : (
                <button
                  onClick={exitAfterBothSubmitted}
                  disabled={!bothSubmitted}
                  className={`rounded px-4 py-2 ${
                    bothSubmitted
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {bothSubmitted ? "Finish ✅" : "Waiting for other debater…"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
