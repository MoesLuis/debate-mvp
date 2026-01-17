"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import JitsiRoom from "@/components/JitsiRoom";

type Outcome = "agreement" | "partial" | "no_agreement";

export default function RoomPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const [name, setName] = useState<string>("");

  const room = typeof slug === "string" ? slug : "deb-test-123";

  // End debate modal state
  const [showEnd, setShowEnd] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("agreement");
  const [statement, setStatement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      // load saved handle for display name
      const { data } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", user.id)
        .maybeSingle();

      setName(data?.handle || user.email || "Guest");
    })();
  }, [router]);

  // 🔥 HEARTBEAT: ping server while user is in the room
  useEffect(() => {
    let intervalId: number | null = null;
    let cancelled = false;

    async function sendHeartbeat() {
      try {
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
      } catch {
        // ignore heartbeat errors
      }
    }

    sendHeartbeat();
    intervalId = window.setInterval(() => {
      if (!cancelled) sendHeartbeat();
    }, 15000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [room]);

  async function submitEndMatch() {
    setSubmitMsg(null);

    const trimmed = statement.trim();
    if (trimmed.length < 10) {
      setSubmitMsg("Please write at least a short statement (10+ characters).");
      return;
    }

    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setSubmitMsg("Not signed in. Please sign in again.");
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/end-match", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomSlug: room,
          outcome,
          statement: trimmed,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitMsg(body?.error || `Server error (${res.status})`);
        setSubmitting(false);
        return;
      }

      setSubmitMsg("Submitted! You can return to the homepage.");
      // Keep the modal open so user sees confirmation
    } catch (e: any) {
      setSubmitMsg(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!name) {
    return <p className="text-sm text-zinc-400">Loading room…</p>;
  }

  return (
    <main className="p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-xl font-semibold">Room: {room}</h1>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEnd(true)}
            className="rounded bg-zinc-800 text-white px-3 py-2 hover:bg-zinc-700"
          >
            End debate
          </button>
          <button
            onClick={() => router.push("/")}
            className="rounded bg-zinc-900 text-white px-3 py-2 border border-zinc-700 hover:bg-zinc-800"
          >
            Back to home
          </button>
        </div>
      </div>

      <JitsiRoom room={room} name={name} />

      <p className="text-sm text-zinc-500 mt-2">
        Tip: open this URL in another browser/device to simulate the second
        participant.
      </p>

      {/* End Debate Modal */}
      {showEnd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">End debate</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  Choose the outcome and write a short agreement summary. This
                  affects both players’ ratings.
                </p>
              </div>
              <button
                onClick={() => setShowEnd(false)}
                className="text-zinc-400 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-sm text-zinc-300">
                Outcome
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as Outcome)}
                  className="mt-1 w-full rounded border border-zinc-700 bg-black/40 p-2"
                  disabled={submitting}
                >
                  <option value="agreement">Agreement reached</option>
                  <option value="partial">Partial agreement</option>
                  <option value="no_agreement">No agreement</option>
                </select>
              </label>

              <label className="block text-sm text-zinc-300">
                Agreement statement (1–3 sentences)
                <textarea
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-700 bg-black/40 p-2 min-h-[110px]"
                  placeholder='Example: "We agree that X is true under Y conditions, but we still disagree about Z."'
                  disabled={submitting}
                />
              </label>

              {submitMsg && (
                <p className="text-sm text-zinc-300">{submitMsg}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowEnd(false)}
                  className="rounded bg-zinc-900 text-white px-3 py-2 border border-zinc-700 hover:bg-zinc-800"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={submitEndMatch}
                  className="rounded bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60"
                  disabled={submitting}
                >
                  {submitting ? "Submitting…" : "Submit result"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
