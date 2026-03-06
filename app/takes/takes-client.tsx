"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TakesTopicsRibbon from "@/components/TakesTopicsRibbon";

type Topic = {
  id: number;
  name: string;
};

type TakeRow = {
  id: string;
  user_id: string;
  topic_id: number;
  stance: string | null;
  playback_id: string | null;
  created_at: string;
  parent_take_id?: string | null;
  is_challengeable?: boolean | null;
  topics?: { name: string }[] | null;

  // When coming from RPC we may get this instead of nested topics join
  topic_name?: string | null;
};

declare global {
  interface Window {
    Hls?: any;
  }
}

function muxHlsUrl(playbackId: string) {
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

async function ensureHlsJsLoaded() {
  if (typeof window === "undefined") return false;
  if (window.Hls) return true;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-hls="true"]');
    if (existing) {
      if (window.Hls) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject());
      return;
    }

    const script = document.createElement("script");
    script.src = "https://unpkg.com/hls.js@latest";
    script.async = true;
    script.dataset.hls = "true";
    script.onload = () => resolve();
    script.onerror = () => reject();
    document.body.appendChild(script);
  });

  return !!window.Hls;
}

type ViewMode =
  | { kind: "feed" }
  | {
      kind: "thread";
      rootTakeId: string;
      stance: "against" | "for";
      entryTakeId: string;
    }
  | {
      kind: "original";
      rootTakeId: string;
      returnTakeId: string;
    };

type GestureLock = "none" | "horizontal" | "vertical";

function isInteractiveTarget(el: EventTarget | null) {
  if (!el) return false;
  const node = el as HTMLElement | null;
  if (!node || typeof (node as any).closest !== "function") return false;

  return !!node.closest(
    [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "label",
      "[role='button']",
      "[data-no-gesture='true']",
    ].join(",")
  );
}

export default function TakesClient() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") || "following";
  const isFollowingTab = useMemo(() => tab !== "explore", [tab]);

  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [followed, setFollowed] = useState<Set<number>>(new Set());
  const [loadingTopics, setLoadingTopics] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  // Feed takes (root + responses)
  const [takes, setTakes] = useState<TakeRow[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Infinite loading
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedCursorCreatedAt, setFeedCursorCreatedAt] = useState<string | null>(null);

  // Not interested IDs
  const [notInterestedIds, setNotInterestedIds] = useState<Set<string>>(new Set());

  // Thread browsing
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: "feed" });
  const [threadTakes, setThreadTakes] = useState<TakeRow[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadIndex, setThreadIndex] = useState(0);

  // Show original
  const [originalTake, setOriginalTake] = useState<TakeRow | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);

  // Reactions
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState<number>(0);
  const [likingBusy, setLikingBusy] = useState(false);

  // Join picker
  const [joinPickerOpen, setJoinPickerOpen] = useState(false);
  const [joinRootId, setJoinRootId] = useState<string | null>(null);

  // Video playback
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsInstanceRef = useRef<any>(null);
  const [videoLoading, setVideoLoading] = useState(true);

  // Follow user (profile check)
  const [isFollowingCreator, setIsFollowingCreator] = useState(false);
  const [followUserBusy, setFollowUserBusy] = useState(false);

  // Swipe / gestures
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const capturedRef = useRef(false);

  const pendingGestureRef = useRef(false);
  const [gestureLock, setGestureLock] = useState<GestureLock>("none");

  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const animatingRef = useRef(false);
  const [animating, setAnimating] = useState(false);
  const [animateTransition, setAnimateTransition] = useState<"none" | "ease">("ease");

  const wheelLockRef = useRef(false);
  const wheelTimerRef = useRef<number | null>(null);

  const showingThread = viewMode.kind === "thread";
  const showingOriginal = viewMode.kind === "original";

  const visibleList: TakeRow[] = useMemo(() => {
    if (showingOriginal) return originalTake ? [originalTake] : [];
    if (showingThread) return threadTakes;
    return takes;
  }, [showingOriginal, originalTake, showingThread, threadTakes, takes]);

  const visibleIndex = showingOriginal ? 0 : showingThread ? threadIndex : activeIndex;
  const activeTake = visibleList[visibleIndex];

  const activeRootId = useMemo(() => {
    if (!activeTake) return null;
    return activeTake.parent_take_id ?? activeTake.id;
  }, [activeTake]);

  const activeTopicName = activeTake?.topics?.[0]?.name ?? activeTake?.topic_name ?? "Topic";
  const activeTopicId = activeTake?.topic_id ?? null;
  const activeCreatorId = activeTake?.user_id ?? null;

  const isTopicFollowed = useMemo(() => {
    if (!activeTopicId) return false;
    return followed.has(activeTopicId);
  }, [followed, activeTopicId]);

  /* =========================================================================================
     LIVE INVITES (Phase 8 - Option 1)
     ========================================================================================= */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [opponentHandle, setOpponentHandle] = useState<string | null>(null);

  // IMPORTANT: use same stance values as your app: "pro" | "against"
  const [challengerStance, setChallengerStance] = useState<"pro" | "against">("against");

  const [inviteQuestionText, setInviteQuestionText] = useState<string | null>(null);
  const [inviteQuestionId, setInviteQuestionId] = useState<number | null>(null);

  async function fetchTakeQuestionForInvite(takeId: string) {
    // Fetch question info directly from takes -> questions
    const { data, error } = await supabase.from("takes").select("question_id, questions(question)").eq("id", takeId).maybeSingle();

    if (error) {
      console.warn("fetchTakeQuestionForInvite error", error);
      return { questionId: null as number | null, questionText: null as string | null };
    }

    const questionId = (data as any)?.question_id ?? null;
    const questionText = (data as any)?.questions?.question ?? null; // supabase may return object for single join

    return { questionId, questionText };
  }

  async function openInviteModal() {
    if (!activeTake?.id || !activeCreatorId || !activeTopicId) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please log in first.");
      return;
    }

    if (activeCreatorId === user.id) {
      alert("You can’t challenge your own take.");
      return;
    }

    setInviteMsg(null);
    setOpponentHandle(null);
    setInviteQuestionText(null);
    setInviteQuestionId(null);
    setInviteOpen(true);

    // Load opponent handle for display
    const { data: prof } = await supabase.from("profiles").select("handle").eq("user_id", activeCreatorId).maybeSingle();

    if (prof?.handle) setOpponentHandle(prof.handle);

    // Load question text for display + include question_id in invite
    const q = await fetchTakeQuestionForInvite(activeTake.id);
    setInviteQuestionId(q.questionId);
    setInviteQuestionText(q.questionText);
  }

  async function sendInvite() {
    if (!activeTake?.id || !activeCreatorId || !activeTopicId) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please log in first.");
      return;
    }

    setInviteBusy(true);
    setInviteMsg(null);

    // Ensure question_id/text loaded (even if modal opened before data came back)
    let qid = inviteQuestionId;

    if (qid == null && activeTake?.id) {
      const q = await fetchTakeQuestionForInvite(activeTake.id);
      qid = q.questionId;
      setInviteQuestionId(q.questionId);
      setInviteQuestionText(q.questionText);
    }

    const payload = {
      from_user_id: user.id,
      to_user_id: activeCreatorId,
      take_id: activeTake.id,
      topic_id: activeTopicId,
      question_id: qid, // used for inbox join display
      creator_stance: activeTake.stance ?? null, // stance of the TAKE CREATOR (recipient)
      challenger_stance: challengerStance, // stance of the CHALLENGER (sender)
      status: "pending",
    };

    const { error } = await supabase.from("live_debate_invites").insert(payload);

    if (error) {
      console.warn("invite insert error", error);
      setInviteMsg(error.message || "Could not send invite.");
      setInviteBusy(false);
      return;
    }

    setInviteMsg("Invite sent ✅ They can accept/decline from their Inbox.");
    setInviteBusy(false);

    window.setTimeout(() => setInviteOpen(false), 900);
  }

  /* =========================================================================================
     WATCH / COMPLETION TRACKING (writes into take_watch_events)
     ========================================================================================= */

  const watchSessionRef = useRef<{
    takeId: string;
    startedAtMs: number;
    lastTickMs: number;
    watchedMs: number;
    completed: boolean;
    flushed: boolean;
  } | null>(null);

  async function flushWatchSession(reason: "switch" | "unmount" | "hidden" | "ended") {
    const session = watchSessionRef.current;
    if (!session) return;
    if (session.flushed) return;

    if (session.watchedMs < 750 && !session.completed) {
      session.flushed = true;
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      session.flushed = true;
      return;
    }

    const payload = {
      user_id: user.id,
      take_id: session.takeId,
      watched_ms: Math.max(0, Math.floor(session.watchedMs)),
      completed: !!session.completed,
    };

    const { error } = await supabase.from("take_watch_events").insert(payload);
    if (error) {
      console.warn("take_watch_events insert failed", error);
    }

    session.flushed = true;
  }

  function startWatchSession(takeId: string) {
    watchSessionRef.current = {
      takeId,
      startedAtMs: Date.now(),
      lastTickMs: Date.now(),
      watchedMs: 0,
      completed: false,
      flushed: false,
    };
  }

  function tickWatchSession() {
    const session = watchSessionRef.current;
    const v = videoRef.current;
    if (!session || !v) return;

    const isPlaying = !v.paused && !v.ended && v.readyState >= 2;
    const now = Date.now();

    if (isPlaying) {
      const delta = now - session.lastTickMs;
      if (delta > 0 && delta < 5000) {
        session.watchedMs += delta;
      }
    }

    session.lastTickMs = now;

    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    if (dur > 0) {
      const pct = v.currentTime / dur;
      if (pct >= 0.98) session.completed = true;
    }
  }

  useEffect(() => {
    (async () => {
      await flushWatchSession("switch");

      if (!activeTake?.id) {
        watchSessionRef.current = null;
        return;
      }

      startWatchSession(activeTake.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTake?.id]);

  useEffect(() => {
    const id = window.setInterval(() => {
      tickWatchSession();
    }, 500);

    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        tickWatchSession();
        flushWatchSession("hidden");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      tickWatchSession();
      flushWatchSession("unmount");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- USER ---------------- */
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    })();
  }, []);

  /* ---------------- LOAD NOT INTERESTED ---------------- */
  async function loadNotInterested() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setNotInterestedIds(new Set());
      return;
    }

    const { data, error } = await supabase
      .from("take_not_interested")
      .select("take_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      console.error("Failed loading not interested", error);
      return;
    }

    setNotInterestedIds(new Set<string>((data ?? []).map((r: any) => String(r.take_id))));
  }

  /* ---------------- LOAD TOPICS (Explore grid) ---------------- */
  useEffect(() => {
    if (!isFollowingTab) loadExploreTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFollowingTab]);

  async function loadExploreTopics() {
    setLoadingTopics(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoadingTopics(false);
      return;
    }

    const { data: topicsData } = await supabase.from("topics").select("id, name").order("name");

    const { data: followedData } = await supabase.from("user_topics").select("topic_id").eq("user_id", user.id);

    if (topicsData) {
      setAllTopics(
        topicsData.map((t: any) => ({
          id: Number(t.id),
          name: t.name,
        }))
      );
    }

    if (followedData) {
      setFollowed(new Set(followedData.map((r: any) => Number(r.topic_id))));
    }

    setLoadingTopics(false);
  }

  async function toggleFollowTopic(topicId: number) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    if (followed.has(topicId)) {
      await supabase.from("user_topics").delete().eq("user_id", user.id).eq("topic_id", topicId);

      setFollowed((prev) => {
        const next = new Set(prev);
        next.delete(topicId);
        return next;
      });
    } else {
      await supabase.from("user_topics").insert({
        user_id: user.id,
        topic_id: topicId,
      });

      setFollowed((prev) => new Set(prev).add(topicId));
    }
  }

  /* ---------------- FEED LOADERS (RPC) ---------------- */
  useEffect(() => {
    let channel: any;

    async function init() {
      setViewMode({ kind: "feed" });
      setThreadTakes([]);
      setThreadIndex(0);
      setOriginalTake(null);

      setActiveIndex(0);
      setFeedCursorCreatedAt(null);
      setFeedHasMore(true);

      await loadNotInterested();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: followedData } = await supabase.from("user_topics").select("topic_id").eq("user_id", user.id);
        setFollowed(new Set<number>((followedData ?? []).map((r: any) => Number(r.topic_id))));
      }

      await loadFeedFirstPage();

      if (isFollowingTab) {
        channel = supabase
          .channel("takes-feed-following-refresh")
          .on("postgres_changes", { event: "*", schema: "public", table: "user_follow_users" }, async () => {
            setViewMode({ kind: "feed" });
            setThreadTakes([]);
            setThreadIndex(0);
            setOriginalTake(null);

            setActiveIndex(0);
            setFeedCursorCreatedAt(null);
            setFeedHasMore(true);

            await loadNotInterested();
            await loadFeedFirstPage();
          })
          .subscribe();
      }
    }

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFollowingTab]);

  function normalizeTopicsField(r: any): TakeRow {
    const topicsNormalized =
      Array.isArray(r.topics) ? r.topics : r.topics ? [r.topics] : r.topic_name ? [{ name: r.topic_name }] : null;

    return {
      ...(r as TakeRow),
      topics: topicsNormalized,
    };
  }

  function applyNotInterestedFilter(rows: TakeRow[]) {
    if (notInterestedIds.size === 0) return rows;
    const blocked = notInterestedIds;
    return rows.filter((t) => !blocked.has(String(t.id)));
  }

  async function loadFeedFirstPage() {
    setFeedError(null);
    setLoadingFeed(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setTakes([]);
      setLoadingFeed(false);
      return;
    }

    const { data: followedTopicsData } = await supabase.from("user_topics").select("topic_id").eq("user_id", user.id);
    setFollowed(new Set<number>((followedTopicsData ?? []).map((r: any) => Number(r.topic_id))));

    const p_tab = isFollowingTab ? "following" : "explore";
    const p_cursor = null;
    const p_limit = 50;

    const { data, error } = await supabase.rpc("get_ranked_feed", {
      p_tab,
      p_cursor,
      p_limit,
    });

    if (error) {
      console.error("get_ranked_feed error", error);
      setFeedError(isFollowingTab ? "Could not load following feed." : "Could not load explore feed.");
      setTakes([]);
      setLoadingFeed(false);
      return;
    }

    const rows = applyNotInterestedFilter(((data ?? []) as any[]).map(normalizeTopicsField));

    setTakes(rows);
    setActiveIndex(0);

    const last = rows[rows.length - 1];
    setFeedCursorCreatedAt(last?.created_at ?? null);
    setFeedHasMore(rows.length >= p_limit);
    setLoadingFeed(false);
  }

  async function loadFeedMore() {
    if (loadingFeed || feedLoadingMore || !feedHasMore) return;
    if (!feedCursorCreatedAt) return;

    setFeedLoadingMore(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setFeedLoadingMore(false);
      return;
    }

    const p_tab = isFollowingTab ? "following" : "explore";
    const p_cursor = feedCursorCreatedAt;
    const p_limit = 50;

    const { data, error } = await supabase.rpc("get_ranked_feed", {
      p_tab,
      p_cursor,
      p_limit,
    });

    if (error) {
      console.error("get_ranked_feed load more error", error);
      setFeedLoadingMore(false);
      return;
    }

    const rows = applyNotInterestedFilter(((data ?? []) as any[]).map(normalizeTopicsField));

    setTakes((prev) => {
      const seen = new Set(prev.map((t) => t.id));
      const merged = [...prev];
      for (const r of rows) if (!seen.has(r.id)) merged.push(r);
      return merged;
    });

    const last = rows[rows.length - 1];
    setFeedCursorCreatedAt(last?.created_at ?? feedCursorCreatedAt);
    setFeedHasMore(rows.length >= p_limit);
    setFeedLoadingMore(false);
  }

  useEffect(() => {
    if (showingThread || showingOriginal) return;
    if (takes.length === 0) return;

    const remaining = takes.length - 1 - activeIndex;
    if (remaining <= 5) loadFeedMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, takes.length, showingThread, showingOriginal]);

  /* ---------------- NOT INTERESTED ---------------- */
  async function markNotInterested(takeId: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      alert("Please log in first.");
      return;
    }

    const { error } = await supabase.from("take_not_interested").insert({
      user_id: user.id,
      take_id: takeId,
    });

    if (error) console.warn("not interested insert error", error);

    setNotInterestedIds((prev) => {
      const next = new Set(prev);
      next.add(takeId);
      return next;
    });

    if (viewMode.kind === "feed") {
      setTakes((prev) => prev.filter((t) => t.id !== takeId));
      setActiveIndex((i) => Math.max(0, Math.min(i, Math.max(0, takes.length - 2))));
    }
  }

  /* ---------------- THREAD LOADERS ---------------- */
  async function openThread(rootTakeId: string, stance: "against" | "for", entryTakeId: string) {
    setViewMode({ kind: "thread", rootTakeId, stance, entryTakeId });
    setThreadError(null);
    setLoadingThread(true);
    setThreadIndex(0);

    let query = supabase
      .from("takes")
      .select("id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)")
      .eq("status", "ready")
      .eq("parent_take_id", rootTakeId)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data, error } =
      stance === "against" ? await query.eq("stance", "against") : await query.or("stance.is.null,stance.neq.against");

    if (error) {
      setThreadError("Could not load replies.");
      setThreadTakes([]);
      setLoadingThread(false);
      return;
    }

    setThreadTakes(((data ?? []) as any[]).map(normalizeTopicsField));
    setThreadIndex(0);
    setLoadingThread(false);
  }

  function backToEntryInThread() {
    if (viewMode.kind !== "thread") return;
    const entryId = viewMode.entryTakeId;

    const idx = takes.findIndex((t) => t.id === entryId);
    setViewMode({ kind: "feed" });
    setThreadTakes([]);
    setThreadIndex(0);

    if (idx >= 0) setActiveIndex(idx);
    else setActiveIndex(0);
  }

  /* ---------------- ORIGINAL (ROOT) LOADER ---------------- */
  async function showOriginal() {
    if (!activeTake) return;
    const rootId = activeTake.parent_take_id;
    if (!rootId) return;

    setLoadingOriginal(true);
    setOriginalTake(null);

    const { data, error } = await supabase
      .from("takes")
      .select("id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)")
      .eq("id", rootId)
      .maybeSingle();

    if (error || !data) {
      setLoadingOriginal(false);
      alert("Could not load original take.");
      return;
    }

    setOriginalTake(normalizeTopicsField(data));
    setViewMode({ kind: "original", rootTakeId: rootId, returnTakeId: activeTake.id });
    setLoadingOriginal(false);
  }

  function backToThreadFromOriginal() {
    if (viewMode.kind !== "original") return;
    const returnId = viewMode.returnTakeId;

    setViewMode({ kind: "feed" });
    setOriginalTake(null);

    const idx = takes.findIndex((t) => t.id === returnId);
    if (idx >= 0) setActiveIndex(idx);
    else setActiveIndex(0);
  }

  /* ---------------- VIDEO ATTACH ---------------- */
  useEffect(() => {
    setVideoLoading(true);

    if (hlsInstanceRef.current) {
      try {
        hlsInstanceRef.current.destroy();
      } catch {}
      hlsInstanceRef.current = null;
    }

    const videoEl = videoRef.current;
    if (!activeTake || !videoEl || !activeTake.playback_id) return;

    const src = muxHlsUrl(activeTake.playback_id);
    const canPlayHlsNatively = videoEl.canPlayType("application/vnd.apple.mpegurl") !== "";

    async function attach() {
      const v = videoRef.current;
      if (!v) return;

      v.loop = true;

      try {
        v.pause();
      } catch {}
      v.removeAttribute("src");
      v.load();

      if (canPlayHlsNatively) {
        v.src = src;
        v.load();
        v.play().catch(() => {});
        return;
      }

      const ok = await ensureHlsJsLoaded();
      if (!ok || !window.Hls) {
        v.src = src;
        v.load();
        return;
      }

      const Hls = window.Hls;
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsInstanceRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(v);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          v.play().catch(() => {});
        });
      } else {
        v.src = src;
        v.load();
      }
    }

    attach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTake?.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onEnded = () => {
      const s = watchSessionRef.current;
      if (s) s.completed = true;
      tickWatchSession();
      flushWatchSession("ended");
    };

    v.addEventListener("ended", onEnded);
    return () => v.removeEventListener("ended", onEnded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTake?.id]);

  /* ---------------- NAV (feed + thread) ---------------- */
  function nextRaw() {
    if (showingOriginal) return;

    if (showingThread) {
      setThreadIndex((i) => Math.min(i + 1, Math.max(0, threadTakes.length - 1)));
      return;
    }

    setActiveIndex((i) => Math.min(i + 1, Math.max(0, takes.length - 1)));
  }

  function prevRaw() {
    if (showingOriginal) return;

    if (showingThread) {
      setThreadIndex((i) => Math.max(i - 1, 0));
      return;
    }

    setActiveIndex((i) => Math.max(i - 1, 0));
  }

  function canGoNext() {
    if (showingOriginal) return false;
    if (showingThread) return threadIndex < threadTakes.length - 1;
    return activeIndex < takes.length - 1;
  }

  function canGoPrev() {
    if (showingOriginal) return false;
    if (showingThread) return threadIndex > 0;
    return activeIndex > 0;
  }

  async function animateToNext() {
    if (!canGoNext()) return;
    if (animatingRef.current) return;

    const el = cardRef.current;
    const h = el?.getBoundingClientRect().height || 600;

    animatingRef.current = true;
    setAnimating(true);
    setAnimateTransition("ease");
    setDragY(-h);

    window.setTimeout(() => {
      nextRaw();

      setAnimateTransition("none");
      setDragY(0);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateTransition("ease");
          setAnimating(false);
          animatingRef.current = false;
        });
      });
    }, 210);
  }

  async function animateToPrev() {
    if (!canGoPrev()) return;
    if (animatingRef.current) return;

    const el = cardRef.current;
    const h = el?.getBoundingClientRect().height || 600;

    animatingRef.current = true;
    setAnimating(true);
    setAnimateTransition("ease");
    setDragY(h);

    window.setTimeout(() => {
      prevRaw();

      setAnimateTransition("none");
      setDragY(0);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateTransition("ease");
          setAnimating(false);
          animatingRef.current = false;
        });
      });
    }, 210);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") animateToNext();
      if (e.key === "ArrowUp") animateToPrev();
      if (e.key === "Escape" && showingThread) backToEntryInThread();
      if (e.key === "Escape" && showingOriginal) backToThreadFromOriginal();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingThread, showingOriginal, takes.length, threadTakes.length, activeIndex, threadIndex]);

  /* ---------------- REACTIONS ---------------- */
  useEffect(() => {
    setLiked(false);
    setLikeCount(0);

    async function loadReactions() {
      if (!activeTake?.id) return;

      const { count } = await supabase.from("take_reactions").select("take_id", { count: "exact", head: true }).eq("take_id", activeTake.id);

      setLikeCount(count ?? 0);

      if (!userId) return;
      const { data } = await supabase.from("take_reactions").select("take_id").eq("take_id", activeTake.id).eq("user_id", userId).maybeSingle();

      setLiked(!!data);
    }

    loadReactions();
  }, [activeTake?.id, userId]);

  async function toggleLike() {
    if (!activeTake?.id) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please log in first.");
      return;
    }

    if (likingBusy) return;
    setLikingBusy(true);

    try {
      if (liked) {
        const { error } = await supabase.from("take_reactions").delete().eq("take_id", activeTake.id).eq("user_id", user.id);

        if (!error) {
          setLiked(false);
          setLikeCount((c) => Math.max(0, c - 1));
        }
      } else {
        const { error } = await supabase.from("take_reactions").insert({
          take_id: activeTake.id,
          user_id: user.id,
        });

        if (!error) {
          setLiked(true);
          setLikeCount((c) => c + 1);
        }
      }
    } finally {
      setLikingBusy(false);
    }
  }

  /* ---------------- FOLLOW USER (creator) ---------------- */
  useEffect(() => {
    (async () => {
      if (!userId || !activeCreatorId) {
        setIsFollowingCreator(false);
        return;
      }
      if (activeCreatorId === userId) {
        setIsFollowingCreator(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_follow_users")
        .select("following_id")
        .eq("follower_id", userId)
        .eq("following_id", activeCreatorId)
        .maybeSingle();

      if (error) {
        console.warn("follow status load error", error);
        setIsFollowingCreator(false);
        return;
      }

      setIsFollowingCreator(!!data);
    })();
  }, [userId, activeCreatorId]);

  async function toggleFollowUser(targetUserId: string) {
    if (!userId) {
      alert("Please log in first.");
      return;
    }
    if (targetUserId === userId) return;
    if (followUserBusy) return;

    setFollowUserBusy(true);
    try {
      if (isFollowingCreator) {
        const { error } = await supabase.from("user_follow_users").delete().eq("follower_id", userId).eq("following_id", targetUserId);
        if (!error) setIsFollowingCreator(false);
      } else {
        const { error } = await supabase.from("user_follow_users").insert({
          follower_id: userId,
          following_id: targetUserId,
        });
        if (!error) setIsFollowingCreator(true);
      }
    } finally {
      setFollowUserBusy(false);
    }
  }

  /* ---------------- THREAD BROWSING BUTTONS ---------------- */
  async function handleAgainst() {
    if (!activeTake?.id || !activeRootId) return;

    if (viewMode.kind === "thread" && viewMode.stance === "against") {
      setThreadIndex((i) => Math.min(i + 1, Math.max(0, threadTakes.length - 1)));
      return;
    }

    await openThread(activeRootId, "against", activeTake.id);
  }

  async function handleInFavor() {
    if (!activeTake?.id || !activeRootId) return;

    if (viewMode.kind === "thread" && viewMode.stance === "for") {
      setThreadIndex((i) => Math.min(i + 1, Math.max(0, threadTakes.length - 1)));
      return;
    }

    await openThread(activeRootId, "for", activeTake.id);
  }

  /* ---------------- JOIN TAKE ---------------- */
  function openJoinPicker() {
    if (!activeRootId) return;
    setJoinRootId(activeRootId);
    setJoinPickerOpen(true);
  }

  function joinTake(stance: "pro" | "against") {
    if (!joinRootId) return;
    setJoinPickerOpen(false);
    router.push(`/takes/record?parentTakeId=${joinRootId}&stance=${stance}`);
  }

  const showShowOriginalButton = !!activeTake?.parent_take_id && !showingOriginal;

  /* ---------------- SWIPE / SCROLL (feed only) ---------------- */
  function resetGesture() {
    setDragging(false);
    setGestureLock("none");
    setDragX(0);
    setDragY(0);
    swipeStartRef.current = null;
    pointerIdRef.current = null;
    capturedRef.current = false;
    pendingGestureRef.current = false;
  }

  function onCardPointerDown(e: React.PointerEvent) {
    if (viewMode.kind !== "feed") return;
    if (!activeTake?.id) return;
    if (animatingRef.current) return;

    if (isInteractiveTarget(e.target)) return;

    pointerIdRef.current = e.pointerId;
    swipeStartRef.current = { x: e.clientX, y: e.clientY };
    pendingGestureRef.current = true;
    capturedRef.current = false;

    setGestureLock("none");
    setDragging(false);
  }

  function onCardPointerMove(e: React.PointerEvent) {
    if (viewMode.kind !== "feed") return;
    if (animatingRef.current) return;
    if (!pendingGestureRef.current) return;

    const start = swipeStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (gestureLock === "none") {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (adx < 12 && ady < 12) return;

      const lock: GestureLock = adx > ady ? "horizontal" : "vertical";
      setGestureLock(lock);
      setDragging(true);

      const pid = pointerIdRef.current;
      if (pid != null && !capturedRef.current) {
        try {
          (e.currentTarget as HTMLDivElement).setPointerCapture(pid);
          capturedRef.current = true;
        } catch {}
      }
    }

    if (gestureLock === "horizontal") {
      setDragX(Math.min(0, dx));
      setDragY(0);
      return;
    }

    if (gestureLock === "vertical") {
      const clamped = Math.max(-420, Math.min(420, dy));
      setDragY(clamped);
      setDragX(0);
      return;
    }
  }

  async function dismissActiveTakeLeft() {
    if (!activeTake?.id) return;

    const el = cardRef.current;
    const width = el?.getBoundingClientRect().width || 800;

    animatingRef.current = true;
    setAnimating(true);
    setAnimateTransition("ease");
    setDragX(-width - 80);
    setDragY(0);

    window.setTimeout(async () => {
      const id = activeTake.id;
      resetGesture();
      setAnimateTransition("none");
      setAnimating(false);
      animatingRef.current = false;
      await markNotInterested(id);
    }, 210);
  }

  function onCardPointerUp(e: React.PointerEvent) {
    if (viewMode.kind !== "feed") return;

    const start = swipeStartRef.current;
    const pid = pointerIdRef.current;

    if (!start || gestureLock === "none") {
      swipeStartRef.current = null;
      pointerIdRef.current = null;
      pendingGestureRef.current = false;
      capturedRef.current = false;
      setDragging(false);
      setDragX(0);
      setDragY(0);
      setGestureLock("none");
      return;
    }

    swipeStartRef.current = null;
    pointerIdRef.current = null;
    pendingGestureRef.current = false;

    if (capturedRef.current && pid != null) {
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(pid);
      } catch {}
    }
    capturedRef.current = false;

    setDragging(false);

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (gestureLock === "horizontal") {
      if (dx < -140 && Math.abs(dy) < 120) {
        dismissActiveTakeLeft();
        return;
      }
      setDragX(0);
      setGestureLock("none");
      return;
    }

    if (gestureLock === "vertical") {
      if (dy < -120) {
        setDragX(0);
        setDragY(0);
        setGestureLock("none");
        animateToNext();
        return;
      }
      if (dy > 120) {
        setDragX(0);
        setDragY(0);
        setGestureLock("none");
        animateToPrev();
        return;
      }

      setDragY(0);
      setGestureLock("none");
      return;
    }

    setDragX(0);
    setDragY(0);
    setGestureLock("none");
  }

  function onCardWheel(e: React.WheelEvent) {
    if (viewMode.kind !== "feed") return;
    if (animatingRef.current) return;

    if (Math.abs(e.deltaY) < 12) return;
    if (wheelLockRef.current) return;

    e.preventDefault();

    wheelLockRef.current = true;
    if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);

    wheelTimerRef.current = window.setTimeout(() => {
      wheelLockRef.current = false;
    }, 450);

    if (e.deltaY > 0) animateToNext();
    else animateToPrev();
  }

  useEffect(() => {
    resetGesture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTake?.id]);

  /* ---------------- PROFILE NAV ---------------- */
  function goToCreatorProfile() {
    if (!activeCreatorId) return;
    if (userId && activeCreatorId === userId) router.push("/profile");
    else router.push(`/u/${activeCreatorId}`);
  }

  // Mobile “glass” style helpers
  const mobileOutlineStyle: React.CSSProperties = {
    textShadow:
      "0 1px 2px rgba(0,0,0,0.95), 0 -1px 2px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.95), -1px 0 2px rgba(0,0,0,0.95)",
  };

  // Position above Safari bottom bar / home indicator
  const mobileRailStyle: React.CSSProperties = {
    bottom: "calc(2.5rem + env(safe-area-inset-bottom))",
  };

  const mobileBtnBase =
    "w-12 h-12 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md text-white shadow-lg transition hover:bg-white/20 active:bg-white/25 active:scale-[0.98] disabled:opacity-50";
  const mobileBtnText = "text-[11px] leading-tight";

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <TakesTopicsRibbon />

      {/* LIVE INVITE MODAL */}
      {inviteOpen && activeTake && activeCreatorId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-300 bg-white p-4">
            <div className="text-lg font-semibold">Challenge to a live debate</div>

            <div className="mt-2 text-sm text-zinc-700 space-y-1">
              <div>
                <span className="font-medium">Opponent:</span> {opponentHandle ? `@${opponentHandle}` : activeCreatorId.slice(0, 8) + "…"}
              </div>
              <div>
                <span className="font-medium">Topic:</span> {activeTopicName}
              </div>
              <div>
                <span className="font-medium">Their stance:</span> {activeTake.stance ?? "neutral"}
              </div>

              {inviteQuestionText && (
                <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm text-zinc-800">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Question</div>
                  <div className="mt-1">{inviteQuestionText}</div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium">Your stance</label>
              <select
                className="mt-1 w-full border border-zinc-300 rounded p-2"
                value={challengerStance}
                onChange={(e) => setChallengerStance(e.target.value as any)}
                disabled={inviteBusy}
              >
                <option value="pro">In favor</option>
                <option value="against">Against</option>
              </select>

              <p className="mt-2 text-xs text-zinc-500">This sends a private invite. They’ll accept/decline from their Inbox.</p>
            </div>

            {inviteMsg && <div className="mt-3 text-sm text-zinc-800">{inviteMsg}</div>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setInviteOpen(false)}
                className="px-4 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50"
                disabled={inviteBusy}
              >
                Cancel
              </button>
              <button
                onClick={sendInvite}
                className="px-4 py-2 rounded bg-black text-white hover:opacity-90 disabled:opacity-60"
                disabled={inviteBusy}
              >
                {inviteBusy ? "Sending…" : "Send invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JOIN PICKER MODAL */}
      {joinPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-lg border border-zinc-300 bg-white p-4">
            <div className="text-lg font-semibold">Join this take</div>
            <p className="text-sm text-zinc-600 mt-1">Choose how you’re replying to the original take:</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button onClick={() => joinTake("pro")} className="px-4 py-3 rounded bg-black text-white text-sm hover:opacity-90">
                In favor
              </button>
              <button
                onClick={() => joinTake("against")}
                className="px-4 py-3 rounded border border-zinc-300 bg-white text-sm hover:bg-zinc-50"
              >
                Against
              </button>
            </div>

            <button
              onClick={() => setJoinPickerOpen(false)}
              className="mt-4 w-full px-4 py-2 rounded border border-zinc-300 bg-white text-sm hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* FEED AREA */}
      <div className="mt-6 relative">
        {loadingFeed ? (
          <div className="flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
            <div className="text-center">
              <div className="text-2xl font-semibold mb-2">Loading…</div>
              <p className="text-sm text-zinc-600">{isFollowingTab ? "Pulling takes from users you follow" : "Exploring all takes"}</p>
            </div>
          </div>
        ) : feedError ? (
          <div className="flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
            <div className="text-center">
              <div className="text-xl font-semibold mb-2">Couldn’t load</div>
              <p className="text-sm text-zinc-600">{feedError}</p>
              <button
                onClick={() => loadFeedFirstPage()}
                className="mt-4 px-4 py-2 rounded border border-zinc-400 bg-white hover:bg-zinc-50 text-sm"
              >
                Retry
              </button>
            </div>
          </div>
        ) : visibleList.length === 0 ? (
          <div className="flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
            <div className="text-center">
              <div className="text-2xl font-semibold mb-2">No takes yet</div>
              <p className="text-sm text-zinc-600">{isFollowingTab ? "Follow some users to see their takes here." : "Record the first take for any topic."}</p>
              <button onClick={() => router.push("/takes/record")} className="mt-4 px-4 py-2 rounded bg-black text-white text-sm hover:opacity-90">
                Record a take
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={cardRef}
            className="h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100 overflow-hidden relative touch-none"
            onPointerDown={onCardPointerDown}
            onPointerMove={onCardPointerMove}
            onPointerUp={onCardPointerUp}
            onWheel={onCardWheel}
            style={{ overscrollBehavior: "contain" }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: `translate3d(${dragX}px, ${dragY}px, 0)`,
                transition: animateTransition === "none" ? "none" : dragging ? "none" : "transform 200ms ease",
                willChange: "transform",
              }}
            >
              <video
                key={activeTake?.id}
                ref={videoRef}
                loop
                className={`w-full h-full object-contain bg-black transition-opacity ${videoLoading ? "opacity-0" : "opacity-100"}`}
                playsInline
                controls
                onLoadedData={() => setVideoLoading(false)}
                onCanPlay={() => setVideoLoading(false)}
              />

              {videoLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <div className="text-white/90 text-sm">Loading video…</div>
                </div>
              )}

              <div className="absolute left-4 top-4 bg-black/60 text-white px-3 py-2 rounded-lg text-sm">
                <div className="font-medium flex items-center gap-2">
                  {activeTopicId ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFollowTopic(activeTopicId);
                      }}
                      className={`px-2 py-1 rounded-full text-xs border transition ${
                        isTopicFollowed ? "bg-white text-black border-white" : "bg-transparent text-white border-white/60 hover:border-white"
                      }`}
                      title={isTopicFollowed ? "Unfollow topic" : "Follow topic"}
                      data-no-gesture="true"
                    >
                      {activeTopicName}
                      {isTopicFollowed ? <span className="ml-1">✓</span> : null}
                    </button>
                  ) : (
                    <span>{activeTopicName}</span>
                  )}

                  {showingThread ? <span className="text-xs opacity-80">(thread)</span> : null}
                  {showingOriginal ? <span className="text-xs opacity-80">(original)</span> : null}
                </div>

                <div className="text-xs opacity-80">
                  {visibleIndex + 1} / {visibleList.length}
                </div>

                {showShowOriginalButton && (
                  <button onClick={showOriginal} className="mt-2 text-xs underline opacity-90 hover:opacity-100" data-no-gesture="true">
                    {loadingOriginal ? "Loading original…" : "Show original"}
                  </button>
                )}

                {showingOriginal && viewMode.kind === "original" && (
                  <button
                    onClick={backToThreadFromOriginal}
                    className="mt-2 text-xs underline opacity-90 hover:opacity-100"
                    data-no-gesture="true"
                  >
                    ← Back to thread
                  </button>
                )}
              </div>

              {showingThread && (
                <button
                  onClick={backToEntryInThread}
                  className="absolute left-4 top-1/2 -translate-y-1/2 px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm"
                  title="Back to the take you started from"
                  data-no-gesture="true"
                >
                  Back
                </button>
              )}

              {!showingOriginal && (
                <div className="absolute left-4 bottom-4 flex gap-2">
                  <button
                    onClick={animateToPrev}
                    disabled={!canGoPrev() || animating}
                    className="px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm disabled:opacity-50"
                    data-no-gesture="true"
                  >
                    ↑ Prev
                  </button>
                  <button
                    onClick={animateToNext}
                    disabled={!canGoNext() || animating}
                    className="px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm disabled:opacity-50"
                    data-no-gesture="true"
                  >
                    ↓ Next
                  </button>
                </div>
              )}

              {viewMode.kind === "feed" && feedLoadingMore && (
                <div className="absolute right-4 bottom-4 bg-black/60 text-white px-3 py-2 rounded text-xs">Loading more…</div>
              )}
            </div>

            {viewMode.kind === "feed" && (
              <div className="absolute inset-0 flex items-center justify-end pr-6 pointer-events-none">
                <div className="bg-black/60 text-white px-4 py-2 rounded-lg text-sm">Not interested</div>
              </div>
            )}
          </div>
        )}
      </div>

      {!isFollowingTab && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-4">Discover Topics</h2>

          {loadingTopics ? (
            <p className="text-sm text-zinc-600">Loading topics…</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {allTopics.map((topic) => {
                const isFollowed = followed.has(topic.id);

                return (
                  <button
                    key={topic.id}
                    onClick={() => toggleFollowTopic(topic.id)}
                    className={`px-4 py-3 rounded-lg border text-sm transition ${
                      isFollowed ? "bg-black text-white border-black" : "bg-zinc-100 border-zinc-400 hover:bg-zinc-50"
                    }`}
                  >
                    {topic.name}
                    {isFollowed && <span className="ml-2 text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Desktop rail (hidden on mobile) */}
      <div className="fixed right-6 top-1/2 -translate-y-1/2 hidden md:flex flex-col gap-3">
        <button
          onClick={() => {
            if (showingOriginal) backToThreadFromOriginal();
            if (showingThread) backToEntryInThread();
          }}
          className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs"
          title={showingOriginal ? "Back to thread" : showingThread ? "Back" : "Topic"}
          data-no-gesture="true"
        >
          {showingOriginal ? "Back" : showingThread ? "Back" : "Topic"}
        </button>

        <div className="relative w-14 h-14">
          <button onClick={goToCreatorProfile} className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs" data-no-gesture="true">
            Profile
          </button>

          {userId && activeCreatorId && activeCreatorId !== userId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFollowUser(activeCreatorId);
              }}
              disabled={followUserBusy}
              className={`absolute -right-1 -bottom-1 w-6 h-6 rounded-full border text-[12px] flex items-center justify-center shadow ${
                isFollowingCreator ? "bg-emerald-500 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-300"
              } ${followUserBusy ? "opacity-60" : ""}`}
              title={isFollowingCreator ? "Unfollow user" : "Follow user"}
              aria-label={isFollowingCreator ? "Unfollow user" : "Follow user"}
              data-no-gesture="true"
            >
              ✓
            </button>
          )}
        </div>

        <button
          onClick={handleAgainst}
          disabled={!activeTake?.id || !activeRootId}
          className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs disabled:opacity-50"
          title="Browse against replies (latest → next)"
          data-no-gesture="true"
        >
          Against
        </button>

        <button
          onClick={toggleLike}
          disabled={!activeTake?.id || likingBusy}
          className={`w-14 h-14 rounded border border-zinc-400 text-xs disabled:opacity-50 ${liked ? "bg-black text-white" : "bg-zinc-100"}`}
          title="React"
          data-no-gesture="true"
        >
          👍
          <div className="text-[10px] opacity-80 mt-1">{likeCount}</div>
        </button>

        <button
          onClick={openJoinPicker}
          disabled={!activeRootId}
          className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs disabled:opacity-50"
          title="Reply to the original take"
          data-no-gesture="true"
        >
          Join
          <div className="text-[10px] opacity-80 mt-1">take</div>
        </button>

        {activeTake?.is_challengeable ? (
          <button
            onClick={openInviteModal}
            className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-[11px]"
            title="Challenge to a live debate"
            data-no-gesture="true"
          >
            Live
            <div className="text-[10px] opacity-80 mt-1">debate</div>
          </button>
        ) : (
          <div className="w-14 h-14 rounded border border-transparent bg-transparent" />
        )}

        <button
          onClick={handleInFavor}
          disabled={!activeTake?.id || !activeRootId}
          className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs disabled:opacity-50"
          title="Browse in-favor replies (latest → next)"
          data-no-gesture="true"
        >
          In favor
        </button>

        <button
          onClick={() => router.push("/takes/record")}
          className="w-20 h-20 rounded border border-zinc-400 bg-black text-white text-xs hover:opacity-90"
          data-no-gesture="true"
        >
          Record
          <br />
          take
        </button>
      </div>

      {/* Mobile glass rail (over video) */}
      <div className="fixed right-3 z-40 md:hidden flex flex-col gap-2" style={mobileRailStyle}>
        <button
          onClick={() => {
            if (showingOriginal) backToThreadFromOriginal();
            if (showingThread) backToEntryInThread();
          }}
          className={`${mobileBtnBase} ${mobileBtnText}`}
          title={showingOriginal ? "Back to thread" : showingThread ? "Back" : "Topic"}
          data-no-gesture="true"
        >
          <span style={mobileOutlineStyle}>{showingOriginal ? "Back" : showingThread ? "Back" : "Topic"}</span>
        </button>

        <button onClick={goToCreatorProfile} className={`${mobileBtnBase} ${mobileBtnText} relative`} data-no-gesture="true" title="Profile">
          <span style={mobileOutlineStyle}>Profile</span>

          {userId && activeCreatorId && activeCreatorId !== userId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFollowUser(activeCreatorId);
              }}
              disabled={followUserBusy}
              className={`absolute -right-1 -bottom-1 w-6 h-6 rounded-full border text-[12px] flex items-center justify-center shadow ${
                isFollowingCreator ? "bg-emerald-500/90 text-white border-emerald-200/60" : "bg-white/80 text-emerald-800 border-emerald-200/60"
              } ${followUserBusy ? "opacity-60" : ""}`}
              title={isFollowingCreator ? "Unfollow user" : "Follow user"}
              aria-label={isFollowingCreator ? "Unfollow user" : "Follow user"}
              data-no-gesture="true"
            >
              <span style={mobileOutlineStyle}>✓</span>
            </button>
          )}
        </button>

        <button
          onClick={handleAgainst}
          disabled={!activeTake?.id || !activeRootId}
          className={`${mobileBtnBase} ${mobileBtnText}`}
          title="Browse against replies"
          data-no-gesture="true"
        >
          <span style={mobileOutlineStyle}>Against</span>
        </button>

        <button
          onClick={toggleLike}
          disabled={!activeTake?.id || likingBusy}
          className={`${mobileBtnBase} ${mobileBtnText} ${liked ? "bg-white/25" : ""}`}
          title="React"
          data-no-gesture="true"
        >
          <div className="flex flex-col items-center justify-center">
            <span style={mobileOutlineStyle}>👍</span>
            <span className="text-[10px] opacity-90" style={mobileOutlineStyle}>
              {likeCount}
            </span>
          </div>
        </button>

        <button
          onClick={openJoinPicker}
          disabled={!activeRootId}
          className={`${mobileBtnBase} ${mobileBtnText}`}
          title="Reply to the original take"
          data-no-gesture="true"
        >
          <div className="flex flex-col items-center justify-center">
            <span style={mobileOutlineStyle}>Join</span>
            <span className="text-[10px] opacity-90" style={mobileOutlineStyle}>
              take
            </span>
          </div>
        </button>

        {activeTake?.is_challengeable ? (
          <button onClick={openInviteModal} className={`${mobileBtnBase} ${mobileBtnText}`} title="Challenge to a live debate" data-no-gesture="true">
            <div className="flex flex-col items-center justify-center">
              <span style={mobileOutlineStyle}>Live</span>
              <span className="text-[10px] opacity-90" style={mobileOutlineStyle}>
                debate
              </span>
            </div>
          </button>
        ) : (
          <div className="w-12 h-12" />
        )}

        <button
          onClick={handleInFavor}
          disabled={!activeTake?.id || !activeRootId}
          className={`${mobileBtnBase} ${mobileBtnText}`}
          title="Browse in-favor replies"
          data-no-gesture="true"
        >
          <span style={mobileOutlineStyle}>In favor</span>
        </button>

        <button
          onClick={() => router.push("/takes/record")}
          className="w-16 h-16 rounded-3xl border border-white/25 bg-white/10 backdrop-blur-md text-white shadow-lg transition hover:bg-white/20 active:bg-white/25 active:scale-[0.98]"
          data-no-gesture="true"
          title="Record take"
        >
          <div className="flex flex-col items-center justify-center text-[11px] leading-tight" style={mobileOutlineStyle}>
            <div>Record</div>
            <div>take</div>
          </div>
        </button>
      </div>
    </div>
  );
}