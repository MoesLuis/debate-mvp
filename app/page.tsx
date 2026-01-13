"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type TrendingTopic = {
  id: number;
  name: string;
  count: number;
};

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [trending, setTrending] = useState<TrendingTopic[]>([]);
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [matchSlug, setMatchSlug] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [waitingCount, setWaitingCount] = useState(0);
  const [debatingCount, setDebatingCount] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // Realtime counts
  useEffect(() => {
    async function loadCounts() {
      const [{ count: waiting }, { count: debating }] = await Promise.all([
        supabase.from("queue").select("*", { count: "exact", head: true }),
        supabase
          .from("matches")
          .select("*", { count: "exact", head: true })
          .eq("status", "active"),
      ]);
      setWaitingCount(waiting ?? 0);
      setDebatingCount(debating ? debating * 2 : 0);
    }
    loadCounts();
  }, []);

  // Load trending
  useEffect(() => {
    supabase
      .from("trending_topics")
      .select("id, name, user_count")
      .limit(5)
      .then(({ data }) => {
        if (!data) return;
        setTrending(
          data.map((r: any) => ({
            id: Number(r.id),
            name: r.name,
            count: Number(r.user_count),
          }))
        );
      });
  }, []);

  async function queueForTopic(topic: TrendingTopic) {
    setFinding(true);
    setActiveTopic(topic.name);
    setFindMsg(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch("/api/find-partner", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ topicId: topic.id }),
    });

    const body = await res.json();
    if (body?.match) setMatchSlug(body.match);
    else setFindMsg("Waiting for another debater…");
    setFinding(false);
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">Welcome to Debate.Me</h1>

      <section>
        <h2 className="text-xl font-semibold mb-2">Trending topics</h2>
        <ul className="space-y-2">
          {trending.map((t) => (
            <li
              key={t.id}
              onClick={() => queueForTopic(t)}
              className="cursor-pointer hover:text-emerald-400 transition"
            >
              {t.name} — {t.count} debating
            </li>
          ))}
        </ul>
        <p className="text-sm text-zinc-400 mt-2">
          {debatingCount} debating • {waitingCount} waiting
        </p>
      </section>

      <section className="p-4 border border-zinc-800 rounded-lg">
        <button
          disabled={finding}
          className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {finding ? "Searching…" : "Find partner"}
        </button>

        {finding && (
          <p className="mt-2 animate-pulse text-zinc-300">
            Looking for someone debating {activeTopic}…
          </p>
        )}

        {findMsg && <p className="mt-2">{findMsg}</p>}

        {matchSlug && (
          <a
            href={`/room/${matchSlug}`}
            className="inline-block mt-3 underline"
          >
            Join match
          </a>
        )}
      </section>
    </main>
  );
}
