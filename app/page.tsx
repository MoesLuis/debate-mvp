"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type TrendingTopic = {
  id: number;
  name: string;
  count: number;
};

export default function Home() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Trending topics
  const [trending, setTrending] = useState<TrendingTopic[]>([]);

  // Matchmaking state
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [matchSlug, setMatchSlug] = useState<string | null>(null);

  // Load auth + profile handle
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

  // 🔥 REALTIME LISTENER: auto-update when a match is created for this user
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
            setFindMsg(null);
            setFinding(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Load trending topics
  useEffect(() => {
    let cancelled = false;

    async function loadTrending() {
      const { data, error } = await supabase
        .from("trending_topics")
        .select("id, name, user_count")
        .limit(5);

      if (cancelled) return;
      if (error || !data) return;

      setTrending(
        data.map((row: any) => ({
          id: Number(row.id),
          name: row.name,
          count: Number(row.user_count),
        }))
      );
    }

    loadTrending();

    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function saveHandle() {
    setProfileMsg(null);

    if (!userId) {
      setProfileMsg("Please sign in first.");
      return;
    }
    if (!handle.trim()) {
      setProfileMsg("Enter a display name.");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, handle: handle.trim() });

    if (error) setProfileMsg(error.message);
    else setProfileMsg("Saved!");
  }

  async function findMatch() {
    if (finding) return;

    setFinding(true);
    setFindMsg(null);
    setMatchSlug(null);

    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();

      if (sessionErr) {
        setFindMsg(sessionErr.message);
        return;
      }

      const token = session?.access_token;

      if (!token) {
        setFindMsg("Not signed in (no session). Please sign in again.");
        return;
      }

      const res = await fetch("/api/find-partner", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = {};
      }

      if (!res.ok) {
        setFindMsg(body?.error || `Server error (${res.status})`);
      } else if (body?.match) {
        setMatchSlug(body.match);
      } else {
        setFindMsg("Searching… waiting for another debater.");
      }
    } catch (err: any) {
      setFindMsg(err?.message || "Network error");
    } finally {
      setFinding(false);
    }
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">Welcome to Debate.Me</h1>

      <div className="mt-4 p-4 border border-zinc-800 rounded-lg bg-zinc-900/50">
        {email ? (
          <div className="space-x-3 mb-3">
            <span>
              Signed in as <b>{email}</b>
            </span>
            <button
              onClick={signOut}
              className="rounded bg-zinc-800 text-white px-3 py-1"
            >
              Sign out
            </button>
          </div>
        ) : (
          <a
            href="/login"
            className="inline-block rounded bg-zinc-800 text-white px-3 py-1 mb-3"
          >
            Sign in
          </a>
        )}

        {email && (
          <div className="mt-2">
            <label className="block text-sm mb-1">Display name</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="e.g., MoesLuis"
                className="border border-zinc-700 rounded p-2 flex-1 bg-black/40"
              />
              <button
                onClick={saveHandle}
                className="rounded bg-zinc-800 text-white px-4 py-2"
              >
                Save
              </button>
            </div>
            {profileMsg && (
              <p className="text-xs text-zinc-400 mt-1">{profileMsg}</p>
            )}
          </div>
        )}

        <div className="mt-6">
          <a
            href="/room/deb-test-123"
            className="inline-block rounded bg-zinc-800 text-white px-4 py-2"
          >
            Join test room
          </a>
        </div>
      </div>

      {trending.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Trending topics</h2>
          <ul className="list-disc ml-5 space-y-1 text-sm text-zinc-200">
            {trending.map((t) => (
              <li key={t.id}>
                {t.name} – {t.count} debater{t.count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4 p-4 border border-zinc-800 rounded-lg bg-zinc-900/50">
        <h2 className="text-lg font-semibold mb-2">
          Find a debating partner
        </h2>
        <button
          onClick={findMatch}
          disabled={finding}
          className="rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2"
        >
          {finding ? "Searching…" : "Find partner"}
        </button>
        {findMsg && <p className="text-sm text-zinc-300 mt-2">{findMsg}</p>}
        {matchSlug && (
          <a
            href={`/room/${matchSlug}`}
            className="inline-block mt-3 rounded bg-zinc-800 text-white px-4 py-2"
          >
            Join matched room
          </a>
        )}
      </section>
    </main>
  );
}
