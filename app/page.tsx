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
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      setEmail(u?.email ?? null);
      setUserId(u?.id ?? null);

      if (u?.id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("handle")
          .eq("user_id", u.id)
          .maybeSingle();
        if (prof?.handle) setHandle(prof.handle);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load trending topics
  useEffect(() => {
    async function loadTrending() {
      const { data, error } = await supabase
        .from("trending_topics")
        .select("id, name, user_count")
        .limit(5);

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
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    // Simple refresh to clear UI state
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

  // 🔍 Simple matchmaking based on overlapping topics
  async function findMatch() {
    setFindMsg(null);
    setMatchSlug(null);

    if (!userId) {
      setFindMsg("Please sign in first.");
      return;
    }

    setFinding(true);

    // 1) Load my topics
    const { data: myTopicsData, error: myTopicsErr } = await supabase
      .from("user_topics")
      .select("topic_id")
      .eq("user_id", userId);

    if (myTopicsErr) {
      setFindMsg("Error loading your topics.");
      setFinding(false);
      return;
    }

    const myTopicIds = (myTopicsData || []).map((r: any) => Number(r.topic_id));
    if (myTopicIds.length === 0) {
      setFindMsg("Select at least one topic on your profile first.");
      setFinding(false);
      return;
    }

        // 2) Put myself in the queue (start everyone at rating 1000 for now)
    const { error: upsertErr } = await supabase
      .from("queue")
      .upsert({ user_id: userId, rating: 1000 });


    if (upsertErr) {
      setFindMsg(`Error joining the queue: ${upsertErr.message}`);
      setFinding(false);
      return;
    }

        // 3) Get other queued users (oldest first)
    const { data: queued, error: queueErr } = await supabase
      .from("queue")
      .select("user_id, inserted_at")
      .neq("user_id", userId)
      .order("inserted_at", { ascending: true });

    if (queueErr) {
      setFindMsg(`Error reading the queue: ${queueErr.message}`);
      setFinding(false);
      return;
    }

    if (!queued || queued.length === 0) {
      setFindMsg(
        "No one is waiting yet. Leave this page open and try again in a bit."
      );
      setFinding(false);
      return;
    }


    const otherIds = queued.map((q: any) => q.user_id);

    // 4) Load topics for all other queued users
    const { data: otherTopics, error: otherErr } = await supabase
      .from("user_topics")
      .select("user_id, topic_id")
      .in("user_id", otherIds);

    if (otherErr) {
      setFindMsg("Error loading others' topics.");
      setFinding(false);
      return;
    }

    // 5) Find first queued user with at least one overlapping topic
    let partnerId: string | null = null;

    for (const candidateId of otherIds) {
      const topicsForCandidate = (otherTopics || []).filter(
        (row: any) => row.user_id === candidateId
      );
      const candidateTopicIds = topicsForCandidate.map((r: any) =>
        Number(r.topic_id)
      );
      const overlap = candidateTopicIds.some((id: number) =>
        myTopicIds.includes(id)
      );
      if (overlap) {
        partnerId = candidateId;
        break;
      }
    }

    if (!partnerId) {
      setFindMsg(
        "Users are queued, but none share your topics yet. Try again soon."
      );
      setFinding(false);
      return;
    }

    // 6) Create a simple unique room slug
    const slug = `deb-${userId.slice(0, 6)}-${partnerId.slice(0, 6)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    // 7) Save the match
    await supabase.from("matches").insert({
      user1_id: userId,
      user2_id: partnerId,
      room_slug: slug,
    });

    // 8) Remove both users from queue
    await supabase.from("queue").delete().in("user_id", [userId, partnerId]);

    setMatchSlug(slug);
    setFindMsg("Match found! Tap the button below to join the room.");
    setFinding(false);
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

        {/* Display name editor (only when signed in) */}
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
            <p className="text-xs text-zinc-500 mt-1">
              This name will appear in the video room.
            </p>
          </div>
        )}

        {/* Join the test room */}
        <div className="mt-6">
          <a
            href="/room/deb-test-123"
            className="inline-block rounded bg-zinc-800 text-white px-4 py-2"
          >
            Join test room
          </a>
          <p className="text-sm text-zinc-500 mt-2">
            Open this link in two different browsers (or devices) to see both
            participants.
          </p>
        </div>
      </div>

      {/* Trending topics */}
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

      {/* Matchmaking section */}
      <section className="mt-4 p-4 border border-zinc-800 rounded-lg bg-zinc-900/50">
        <h2 className="text-lg font-semibold mb-2">Find a debating partner</h2>
        <p className="text-sm text-zinc-400 mb-3">
          We’ll look for someone in the queue who shares at least one of your
          topics.
        </p>
        <button
          onClick={findMatch}
          disabled={finding}
          className="rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2"
        >
          {finding ? "Searching…" : "Find partner"}
        </button>
        {findMsg && (
          <p className="text-sm text-zinc-300 mt-2">
            {findMsg}
          </p>
        )}
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
