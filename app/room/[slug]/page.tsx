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
  const [showEnd, setShowEnd] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("agreement");
  const [statement, setStatement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const debateEndedRef = useRef(false);

  // Auth + name
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", user.id)
        .maybeSingle();

      setName(data?.handle || user.email || "Guest");
    })();
  }, [router]);

  // Heartbeat (unchanged)
  useEffect(() => {
    let t: number;

    async function heartbeat() {
      const { data: { session } } = await supabase.auth.getSession();
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

    heartbeat();
    t = window.setInterval(heartbeat, 15000);
    return () => clearInterval(t);
  }, [room]);

  // 🔒 INTERCEPT BACK / REFRESH / TAB CLOSE
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (debateEndedRef.current) return;

      e.preventDefault();
      e.returnValue =
        "Leaving without ending the debate will apply a 5% rating penalty.";
      return e.returnValue;
    }

    async function handleForfeit() {
      if (debateEndedRef.current) return;

      const confirmLeave = window.confirm(
        "Are you sure you want to leave?\n\nLeaving without ending the debate will result in a 5% penalty to your profile score."
      );

      if (!confirmLeave) {
        router.push(`/room/${room}`);
        return;
      }

      debateEndedRef.current = true;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

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

    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", handleForfeit);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", handleForfeit);
    };
  }, [room, router]);

  // Normal end debate
  async function submitEndMatch() {
    debateEndedRef.current = true;
    setSubmitting(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch("/api/end-match", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roomSlug: room, outcome, statement }),
    });

    setSubmitMsg("Debate ended. You may now close this page.");
    setSubmitting(false);
  }

  if (!name) return <p className="text-zinc-400">Loading…</p>;

  return (
    <main className="p-4">
      <div className="flex justify-between mb-3">
        <h1 className="text-xl font-semibold">Room: {room}</h1>
        <button
          onClick={() => setShowEnd(true)}
          className="bg-zinc-800 px-3 py-2 rounded"
        >
          End debate
        </button>
      </div>

      <JitsiRoom room={room} name={name} />

      {showEnd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
          <div className="bg-zinc-950 p-4 rounded max-w-lg w-full">
            <h2 className="text-lg font-semibold">End debate</h2>

            <select
              className="w-full mt-2"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
            >
              <option value="agreement">Agreement reached</option>
              <option value="partial">Partial agreement</option>
              <option value="no_agreement">No agreement</option>
            </select>

            <textarea
              className="w-full mt-2"
              placeholder="Agreement summary"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />

            {submitMsg && <p className="mt-2">{submitMsg}</p>}

            <div className="flex justify-end mt-3 gap-2">
              <button onClick={() => setShowEnd(false)}>Cancel</button>
              <button onClick={submitEndMatch} disabled={submitting}>
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
