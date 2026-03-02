"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TrendingTopic = {
  id: number;
  name: string;
  count: number;
};

type GateMode = "matchmaking" | "scheduled";

/**
 * Next.js requirement: useSearchParams must be inside a Suspense boundary.
 * So we isolate it into this tiny component and render it inside <Suspense>.
 */
function JoinRoomListener({
  onJoinRoom,
}: {
  onJoinRoom: (roomSlug: string) => void;
}) {
  const params = useSearchParams();

  useEffect(() => {
    const joinRoom = params.get("joinRoom");
    if (!joinRoom) return;
    onJoinRoom(joinRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return null;
}

export default function Home() {
  const router = useRouter();

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [handle, setHandle] = useState("");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const [trending, setTrending] = useState<TrendingTopic[]>([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [debatingPeople, setDebatingPeople] = useState(0);

  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [matchSlug, setMatchSlug] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  // 🔒 Consent gate state
  const [showGate, setShowGate] = useState(false);
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);
  const [gateMode, setGateMode] = useState<GateMode>("matchmaking");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateMsg, setGateMsg] = useState<string | null>(null);

  /* ---------------- AUTH + PROFILE ---------------- */
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return;

      const u = data.user;
      setEmail(u?.email ?? null);
      setUserId(u?.id ?? null);

      if (u?.id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("handle")
          .eq("user_id", u.id)
          .maybeSingle();

        if (!cancelled && prof?.handle) setHandle(prof.handle);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      setEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* ---------------- REALTIME MATCH DETECT ---------------- */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`matches-for-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;

          const isMe = row.user_a === userId || row.user_b === userId;
          if (!isMe) return;

          if (row.status === "active" && row.room_slug) {
            setMatchSlug(row.room_slug);
            setFinding(false);
            setFindMsg(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  /* ---------------- TRENDING ---------------- */
  useEffect(() => {
    supabase
      .from("trending_topics")
      .select("id, name, user_count")
      .limit(5)
      .then(({ data }) => {
        if (!data) return;
        setTrending(
          data.map((row: any) => ({
            id: Number(row.id),
            name: row.name,
            count: Number(row.user_count),
          }))
        );
      });
  }, []);

  /* ---------------- LIVE COUNTS ---------------- */
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase
        .from("live_counts")
        .select("debating_people, waiting_people")
        .maybeSingle();

      if (!cancelled && data) {
        setDebatingPeople(Number(data.debating_people ?? 0));
        setWaitingCount(Number(data.waiting_people ?? 0));
      }
    }

    refresh();
    const t = setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  /* ---------------- CONSENT AUTO-CANCEL (only matchmaking; 20s) ---------------- */
  useEffect(() => {
    if (!showGate || !pendingRoom) return;
    if (gateMode !== "matchmaking") return; // ✅ do NOT auto-cancel scheduled rooms

    const timer = setTimeout(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        await fetch("/api/cancel-match", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roomSlug: pendingRoom }),
        });
      }

      setShowGate(false);
      setPendingRoom(null);
      setMatchSlug(null);
    }, 20000);

    return () => clearTimeout(timer);
  }, [showGate, pendingRoom, gateMode]);

  /* ---------------- ACTIONS ---------------- */
  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function saveHandle() {
    setProfileMsg(null);
    if (!userId || !handle.trim()) return;

    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, handle: handle.trim() });

    setProfileMsg(error ? error.message : "Saved!");
  }

  async function callFindPartner(topicId?: number, topicName?: string) {
    if (finding) return;

    setFinding(true);
    setFindMsg(null);
    setMatchSlug(null);
    setActiveTopic(topicName ?? null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setFindMsg("Not signed in.");
      setFinding(false);
      return;
    }

    const res = await fetch("/api/find-partner", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(topicId != null ? { topicId } : {}),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) setFindMsg(body?.error || "Server error");
    else if (!body?.match) setFindMsg("Searching… waiting for another debater.");

    setFinding(false);
  }

  async function acceptGateAndJoin(roomSlug: string) {
    setGateBusy(true);
    setGateMsg(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setGateMsg("Not signed in.");
      setGateBusy(false);
      return;
    }

    // If it’s a scheduled room, activate it before entering.
    if (gateMode === "scheduled") {
      const res = await fetch("/api/activate-match", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomSlug }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGateMsg(body?.error || "Could not activate match.");
        setGateBusy(false);
        return;
      }
    }

    setShowGate(false);
    setPendingRoom(null);
    setGateBusy(false);

    router.push(`/room/${roomSlug}`);
  }

  function openScheduledJoin(roomSlug: string) {
    // Open the “Before you enter” gate for scheduled joins
    setPendingRoom(roomSlug);
    setGateMode("scheduled");
    setShowGate(true);

    // Clean URL so refresh doesn’t retrigger it
    router.replace("/");
  }

  /* ---------------- UI ---------------- */
  return (
    <main className="p-6 space-y-6">
      {/* ✅ REQUIRED: JoinRoomListener uses useSearchParams, so wrap in Suspense */}
      <Suspense fallback={null}>
        <JoinRoomListener onJoinRoom={openScheduledJoin} />
      </Suspense>

      <h1 className="text-3xl font-bold">Welcome to Debate.Me</h1>

      {/* Sign in card */}
      <div className="p-4 border border-zinc-800 rounded-lg bg-zinc-900/50">
        {email ? (
          <div className="space-x-3 mb-3">
            <span>
              Signed in as <b>{email}</b>
            </span>
            <button onClick={signOut} className="rounded bg-zinc-800 px-3 py-1">
              Sign out
            </button>
          </div>
        ) : (
          <a href="/login" className="rounded bg-zinc-800 px-3 py-1">
            Sign in
          </a>
        )}

        {email && (
          <div className="mt-2">
            <label className="block text-sm mb-1">Display name</label>
            <div className="flex gap-2">
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="border border-zinc-700 rounded p-2 bg-black/40"
              />
              <button onClick={saveHandle} className="bg-zinc-800 px-4 rounded">
                Save
              </button>
            </div>
            {profileMsg && <p className="text-xs text-zinc-400 mt-1">{profileMsg}</p>}
          </div>
        )}
      </div>

      {/* Trending */}
      {trending.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Trending topics</h2>
          <ul className="space-y-2 text-sm">
            {trending.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => callFindPartner(t.id, t.name)}
                  disabled={finding}
                  className="hover:text-emerald-400"
                >
                  {t.name} — {t.count} debater{t.count === 1 ? "" : "s"}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-400 mt-3">
            {debatingPeople} debating now • {waitingCount} waiting
          </p>
        </section>
      )}

      {/* Find partner */}
      <section className="p-4 border border-zinc-800 rounded-lg bg-zinc-900/50">
        <h2 className="text-lg font-semibold mb-2">Find a debating partner</h2>

        <button
          onClick={() => {
            setGateMode("matchmaking");
            callFindPartner();
          }}
          disabled={finding}
          className="rounded bg-emerald-600 px-4 py-2 text-white"
        >
          {finding ? "Searching…" : "Find partner"}
        </button>

        {finding && (
          <p className="mt-3 text-sm animate-pulse">
            Looking for someone {activeTopic ? `debating ${activeTopic}` : "to debate with"}…
          </p>
        )}

        {findMsg && <p className="text-sm mt-2">{findMsg}</p>}

        {matchSlug && (
          <button
            onClick={() => {
              setPendingRoom(matchSlug);
              setGateMode("matchmaking");
              setShowGate(true);
            }}
            className="inline-block mt-3 rounded bg-zinc-800 text-white px-4 py-2"
          >
            Join matched room
          </button>
        )}
      </section>

      {/* 🔒 CONSENT MODAL */}
      {showGate && pendingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-md w-full rounded-lg bg-zinc-950 border border-zinc-800 p-4">
            <h2 className="text-lg font-semibold mb-2">⚠️ Before you enter</h2>
            <p className="text-sm text-zinc-300">
              Leaving a debate without properly ending it will result in a <b>5% penalty</b> to your profile score.
            </p>

            {gateMsg && <p className="mt-3 text-sm text-red-300">{gateMsg}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={async () => {
                  // Only cancel matchmaking matches; scheduled should just close modal.
                  if (gateMode === "matchmaking" && pendingRoom) {
                    const {
                      data: { session },
                    } = await supabase.auth.getSession();

                    if (session?.access_token) {
                      await fetch("/api/cancel-match", {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${session.access_token}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ roomSlug: pendingRoom }),
                      });
                    }
                  }

                  setShowGate(false);
                  setPendingRoom(null);
                  setMatchSlug(null);
                }}
                className="rounded bg-zinc-900 px-3 py-2"
                disabled={gateBusy}
              >
                Cancel
              </button>

              <button
                onClick={() => acceptGateAndJoin(pendingRoom)}
                className="rounded bg-emerald-600 px-4 py-2 text-white"
                disabled={gateBusy}
              >
                {gateBusy ? "Entering…" : "I accept ✅"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}