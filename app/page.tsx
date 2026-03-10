"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TrendingTopic = {
  id: number;
  name: string;
  count: number;
};

type TrendingQuestion = {
  id: number;
  topicId: number;
  topicName: string;
  question: string;
  createdAt: string | null;
  trendScore: number;
  activeMatches: number;
  recentMatches: number;
};

type MyTopic = {
  id: number;
  name: string;
};

type GateMode = "matchmaking" | "scheduled";
type Stance = "in_favor" | "against";

function JoinRoomListener({ onJoinRoom }: { onJoinRoom: (roomSlug: string) => void }) {
  const params = useSearchParams();

  useEffect(() => {
    const joinRoom = params.get("joinRoom");
    if (!joinRoom) return;
    onJoinRoom(joinRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return null;
}

function trendStyleByRank(rank: number) {
  if (rank === 0) {
    return {
      emoji: "🔥",
      cls: "bg-rose-600/20 border-rose-500/40 hover:bg-rose-600/25",
      label: "Hot",
    };
  }
  if (rank === 1) {
    return {
      emoji: "🚀",
      cls: "bg-orange-600/20 border-orange-500/40 hover:bg-orange-600/25",
      label: "Rising",
    };
  }
  if (rank === 2) {
    return {
      emoji: "⭐",
      cls: "bg-yellow-600/20 border-yellow-500/40 hover:bg-yellow-600/25",
      label: "Top",
    };
  }
  if (rank <= 5) {
    return {
      emoji: "📈",
      cls: "bg-emerald-600/15 border-emerald-500/30 hover:bg-emerald-600/20",
      label: "Trending",
    };
  }
  return {
    emoji: "💬",
    cls: "bg-zinc-800/40 border-zinc-700 hover:bg-zinc-800/55",
    label: "Active",
  };
}

function getQuestionTrendScore(matchRows: any[], createdAt: string | null) {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const threeDaysMs = 3 * oneDayMs;

  let activeMatches = 0;
  let recentMatches = 0;
  let score = 0;

  for (const row of matchRows) {
    const status = String(row?.status ?? "");
    const createdMs = row?.created_at ? new Date(row.created_at).getTime() : 0;

    if (status === "active") {
      activeMatches += 1;
      recentMatches += 1;
      score += 12;
      continue;
    }

    if (!createdMs) continue;

    const age = now - createdMs;

    if (age <= oneDayMs) {
      recentMatches += 1;
      score += 6;
    } else {
      recentMatches += 1;
      score += 3;
    }
  }

  if (createdAt) {
    const questionAge = now - new Date(createdAt).getTime();
    if (questionAge <= threeDaysMs) {
      score += 1;
    }
  }

  return {
    score,
    activeMatches,
    recentMatches,
  };
}

export default function Home() {
  const router = useRouter();

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [handle, setHandle] = useState("");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const [myTopics, setMyTopics] = useState<MyTopic[]>([]);
  const [loadingMyTopics, setLoadingMyTopics] = useState(false);
  const [topicSaveMsg, setTopicSaveMsg] = useState<string | null>(null);
  const [savingTopicId, setSavingTopicId] = useState<number | null>(null);

  const [trending, setTrending] = useState<TrendingTopic[]>([]);
  const [trendingQuestions, setTrendingQuestions] = useState<TrendingQuestion[]>([]);
  const [loadingTrendingQuestions, setLoadingTrendingQuestions] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);

  const [waitingCount, setWaitingCount] = useState(0);
  const [debatingPeople, setDebatingPeople] = useState(0);

  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [matchSlug, setMatchSlug] = useState<string | null>(null);
  const [activeSearchLabel, setActiveSearchLabel] = useState<string | null>(null);

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

  /* ---------------- LOAD MY TOPICS ---------------- */
  async function loadMyTopics() {
    setLoadingMyTopics(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMyTopics([]);
      setLoadingMyTopics(false);
      return;
    }

    const { data, error } = await supabase
      .from("user_topics")
      .select("topic_id, topics(name)")
      .eq("user_id", user.id);

    if (error) {
      console.warn("loadMyTopics error", error);
      setMyTopics([]);
      setLoadingMyTopics(false);
      return;
    }

    const mapped: MyTopic[] = (data ?? [])
      .map((row: any) => {
        const id = Number(row?.topic_id);
        const name = row?.topics?.name;
        if (!Number.isFinite(id) || typeof name !== "string") return null;
        return { id, name };
      })
      .filter(Boolean) as MyTopic[];

    mapped.sort((a, b) => a.name.localeCompare(b.name));
    setMyTopics(mapped);
    setLoadingMyTopics(false);
  }

  useEffect(() => {
    loadMyTopics();

    const channel = supabase
      .channel("live-debates-my-topics")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_topics" }, () => loadMyTopics())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* ---------------- REALTIME MATCH DETECT ---------------- */
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`matches-for-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, (payload: any) => {
        const row = payload.new;
        if (!row) return;

        const isMe = row.user_a === userId || row.user_b === userId;
        if (!isMe) return;

        if (row.status === "active" && row.room_slug) {
          setMatchSlug(row.room_slug);
          setFinding(false);
          setFindMsg(null);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  /* ---------------- TRENDING TOPICS ---------------- */
  async function loadTrending() {
    const { data, error } = await supabase
      .from("trending_topics")
      .select("id, name, user_count")
      .limit(12);

    if (error || !data) return;

    const rows: TrendingTopic[] = data
      .map((row: any) => ({
        id: Number(row.id),
        name: row.name,
        count: Number(row.user_count),
      }))
      .filter(
        (t) =>
          Number.isFinite(t.id) &&
          typeof t.name === "string" &&
          Number.isFinite(t.count)
      );

    rows.sort((a, b) => b.count - a.count);
    setTrending(rows);
  }

  useEffect(() => {
    loadTrending();
    const t = setInterval(loadTrending, 20000);
    return () => clearInterval(t);
  }, []);

  /* ---------------- TRENDING QUESTIONS ---------------- */
  async function loadTrendingQuestions() {
    setLoadingTrendingQuestions(true);

    if (!userId || myTopics.length === 0) {
      setTrendingQuestions([]);
      setSelectedQuestionId((prev) => prev);
      setLoadingTrendingQuestions(false);
      return;
    }

    const topicIds = myTopics.map((t) => t.id);

    const { data: questionData, error: questionError } = await supabase
      .from("questions")
      .select("id, topic_id, question, created_at, topics(name)")
      .eq("is_active", true)
      .in("topic_id", topicIds)
      .limit(50);

    if (questionError || !questionData) {
      setTrendingQuestions([]);
      setLoadingTrendingQuestions(false);
      return;
    }

    const mappedQuestions = (questionData ?? [])
      .map((row: any) => {
        const topicId = Number(row?.topic_id);
        const topicName = row?.topics?.name;

        if (
          !Number.isFinite(Number(row?.id)) ||
          !Number.isFinite(topicId) ||
          typeof row?.question !== "string" ||
          typeof topicName !== "string"
        ) {
          return null;
        }

        return {
          id: Number(row.id),
          topicId,
          topicName,
          question: row.question,
          createdAt: row.created_at ?? null,
        };
      })
      .filter(Boolean) as Array<{
      id: number;
      topicId: number;
      topicName: string;
      question: string;
      createdAt: string | null;
    }>;

    if (mappedQuestions.length === 0) {
      setTrendingQuestions([]);
      setLoadingTrendingQuestions(false);
      return;
    }

    const questionIds = mappedQuestions.map((q) => q.id);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: matchData, error: matchError } = await supabase
      .from("matches")
      .select("question_id, status, created_at")
      .in("question_id", questionIds)
      .gte("created_at", sevenDaysAgo);

    const matchRows = matchError || !matchData ? [] : matchData;

    const matchesByQuestion = new Map<number, any[]>();
    for (const row of matchRows) {
      const qid = Number(row?.question_id);
      if (!Number.isFinite(qid)) continue;
      const arr = matchesByQuestion.get(qid) ?? [];
      arr.push(row);
      matchesByQuestion.set(qid, arr);
    }

    const ranked: TrendingQuestion[] = mappedQuestions
      .map((q) => {
        const stats = getQuestionTrendScore(matchesByQuestion.get(q.id) ?? [], q.createdAt);

        return {
          id: q.id,
          topicId: q.topicId,
          topicName: q.topicName,
          question: q.question,
          createdAt: q.createdAt,
          trendScore: stats.score,
          activeMatches: stats.activeMatches,
          recentMatches: stats.recentMatches,
        };
      })
      .sort((a, b) => {
        if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
        if (b.activeMatches !== a.activeMatches) return b.activeMatches - a.activeMatches;
        if (b.recentMatches !== a.recentMatches) return b.recentMatches - a.recentMatches;

        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 12);

    setTrendingQuestions(ranked);
    setSelectedQuestionId((prev) =>
      prev != null && ranked.some((q) => q.id === prev) ? prev : null
    );
    setLoadingTrendingQuestions(false);
  }

  useEffect(() => {
    loadTrendingQuestions();
    const t = setInterval(loadTrendingQuestions, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, myTopics]);

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

  /* ---------------- CONSENT AUTO-CANCEL ---------------- */
  useEffect(() => {
    if (!showGate || !pendingRoom) return;
    if (gateMode !== "matchmaking") return;

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

  async function addTrendingTopicToMyTopics(topic: { id: number; name: string }) {
    setTopicSaveMsg(null);
    setSavingTopicId(topic.id);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setTopicSaveMsg("Sign in to save topics.");
      setSavingTopicId(null);
      return;
    }

    const alreadySaved = myTopics.some((t) => t.id === topic.id);
    if (alreadySaved) {
      setTopicSaveMsg(`"${topic.name}" is already in your topics.`);
      setSavingTopicId(null);
      return;
    }

    const { error } = await supabase.from("user_topics").insert({
      user_id: user.id,
      topic_id: topic.id,
    });

    if (error) {
      setTopicSaveMsg(error.message);
    } else {
      setTopicSaveMsg(`Added "${topic.name}" to My topics.`);
      await loadMyTopics();
    }

    setSavingTopicId(null);
  }

  async function callFindPartner(options?: {
    topicId?: number;
    topicName?: string;
    questionId?: number;
    questionText?: string;
    stance?: Stance;
  }) {
    if (finding) return;

    setFinding(true);
    setFindMsg(null);
    setMatchSlug(null);

    if (options?.questionId && options?.questionText && options?.stance) {
      const stanceLabel = options.stance === "in_favor" ? "In Favor" : "Against";
      setActiveSearchLabel(`${stanceLabel}: ${options.questionText}`);
    } else if (options?.topicName) {
      setActiveSearchLabel(options.topicName);
    } else {
      setActiveSearchLabel(null);
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setFindMsg("Not signed in.");
      setFinding(false);
      return;
    }

    const payload: Record<string, any> = {};

    if (options?.topicId != null) payload.topicId = options.topicId;
    if (options?.questionId != null) payload.questionId = options.questionId;
    if (options?.stance != null) payload.stance = options.stance;

    const res = await fetch("/api/find-partner", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setFindMsg(body?.error || "Server error");
    } else if (!body?.match) {
      if (options?.questionText && options?.stance) {
        const neededOpponentLabel =
          options.stance === "in_favor" ? "against" : "in favor of";
        setFindMsg(`Searching… waiting for someone ${neededOpponentLabel} this question.`);
      } else {
        setFindMsg("Searching… waiting for another debater.");
      }
    }

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
    setPendingRoom(roomSlug);
    setGateMode("scheduled");
    setShowGate(true);
    router.replace("/");
  }

  const canUseTopics = !!email;

  const myTopicIds = useMemo(() => {
    return new Set(myTopics.map((t) => t.id));
  }, [myTopics]);

  const myTopicsEmptyText = useMemo(() => {
    if (!email) return "Sign in to see your topics.";
    if (loadingMyTopics) return "Loading topics…";
    if (myTopics.length === 0) return "No topics selected yet. Add topics in your Profile.";
    return null;
  }, [email, loadingMyTopics, myTopics.length]);

  const trendingQuestionsEmptyText = useMemo(() => {
    if (!email) return "Sign in to see trending questions from your saved topics.";
    if (loadingMyTopics || loadingTrendingQuestions) return "Loading trending questions…";
    if (myTopics.length === 0) return "Save topics to start seeing trending questions here.";
    if (trendingQuestions.length === 0) return "No active questions yet for your saved topics.";
    return null;
  }, [email, loadingMyTopics, loadingTrendingQuestions, myTopics.length, trendingQuestions.length]);

  /* ---------------- UI ---------------- */
  return (
    <main className="p-6 space-y-6">
      <Suspense fallback={null}>
        <JoinRoomListener onJoinRoom={openScheduledJoin} />
      </Suspense>

      <h1 className="text-3xl font-bold">Welcome to Debate.Me</h1>

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

      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-xl font-semibold">My topics</h2>
          <button
            onClick={() => router.push("/profile")}
            className="text-xs rounded bg-zinc-800 px-3 py-1 hover:bg-zinc-700"
          >
            Edit topics
          </button>
        </div>

        {myTopicsEmptyText ? (
          <p className="text-sm text-zinc-400">{myTopicsEmptyText}</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2 md:flex-wrap md:overflow-x-visible">
            {myTopics.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setGateMode("matchmaking");
                  callFindPartner({ topicId: t.id, topicName: t.name });
                }}
                disabled={!canUseTopics || finding}
                className="shrink-0 px-4 py-2 rounded-full border border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/60 text-sm"
                title="Matchmake on this topic"
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {trending.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Trending topics</h2>

          <div className="flex gap-2 overflow-x-auto pb-2 md:flex-wrap md:overflow-x-visible">
            {trending.map((t, idx) => {
              const sty = trendStyleByRank(idx);
              const alreadySaved = myTopicIds.has(t.id);

              return (
                <button
                  key={t.id}
                  onClick={() => addTrendingTopicToMyTopics({ id: t.id, name: t.name })}
                  disabled={savingTopicId === t.id}
                  className={`shrink-0 px-4 py-2 rounded-full border text-sm transition ${sty.cls}`}
                  title={`${sty.label} • ${t.count} debater${t.count === 1 ? "" : "s"}`}
                >
                  <span className="mr-2">{sty.emoji}</span>
                  {t.name}
                  {alreadySaved ? (
                    <span className="ml-2 text-xs opacity-90">✓ Saved</span>
                  ) : (
                    <span className="ml-2 text-xs opacity-80">+ Add</span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-xs text-zinc-400 mt-2">
            {debatingPeople} debating now • {waitingCount} waiting
          </p>

          <p className="text-xs text-zinc-500 mt-1">
            Click a trending topic to add it to My topics.
          </p>

          {topicSaveMsg && (
            <p className="text-sm text-zinc-300 mt-2">{topicSaveMsg}</p>
          )}
        </section>
      )}

      <section>
        <div className="mb-2">
          <h2 className="text-xl font-semibold">Trending Questions</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Showing the most active questions from your saved topics, based on current and recent debates.
          </p>
        </div>

        {trendingQuestionsEmptyText ? (
          <p className="text-sm text-zinc-400">{trendingQuestionsEmptyText}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {trendingQuestions.map((q) => {
              const isSelected = selectedQuestionId === q.id;

              return (
                <div
                  key={q.id}
                  className={`rounded-2xl border p-4 transition ${
                    isSelected
                      ? "border-emerald-500/40 bg-emerald-600/10"
                      : "border-zinc-800 bg-zinc-900/50"
                  }`}
                >
                  <button
                    onClick={() =>
                      setSelectedQuestionId((prev) => (prev === q.id ? null : q.id))
                    }
                    className="w-full text-left"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="text-xs uppercase tracking-wide text-zinc-400">
                        {q.topicName}
                      </p>

                      {(q.activeMatches > 0 || q.recentMatches > 0) && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-600/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                          {q.activeMatches > 0
                            ? `${q.activeMatches} live`
                            : `${q.recentMatches} recent`}
                        </span>
                      )}
                    </div>

                    <p className="text-base font-medium leading-6">{q.question}</p>
                  </button>

                  {isSelected && (
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => {
                          setGateMode("matchmaking");
                          callFindPartner({
                            topicId: q.topicId,
                            topicName: q.topicName,
                            questionId: q.id,
                            questionText: q.question,
                            stance: "in_favor",
                          });
                        }}
                        disabled={finding}
                        className="rounded-full border border-emerald-500/40 bg-emerald-600/15 px-4 py-2 text-sm hover:bg-emerald-600/20"
                      >
                        In Favor
                      </button>

                      <button
                        onClick={() => {
                          setGateMode("matchmaking");
                          callFindPartner({
                            topicId: q.topicId,
                            topicName: q.topicName,
                            questionId: q.id,
                            questionText: q.question,
                            stance: "against",
                          });
                        }}
                        disabled={finding}
                        className="rounded-full border border-rose-500/40 bg-rose-600/15 px-4 py-2 text-sm hover:bg-rose-600/20"
                      >
                        Against
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="p-4 border border-zinc-800 rounded-lg bg-zinc-900/50">
        <h2 className="text-lg font-semibold mb-2">Find a debating partner</h2>

        <button
          onClick={() => {
            setGateMode("matchmaking");
            callFindPartner();
          }}
          disabled={finding}
          className="rounded border border-emerald-500/30 bg-emerald-600/15 hover:bg-emerald-600/20 px-4 py-2 text-white transition"
        >
          {finding ? "Searching…" : "Find partner"}
        </button>

        {finding && (
          <p className="mt-3 text-sm animate-pulse">
            Looking for someone {activeSearchLabel ? `for ${activeSearchLabel}` : "to debate with"}…
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