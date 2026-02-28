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

export default function TakesClient() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") || "following";
  const isFollowingTab = useMemo(() => tab !== "explore", [tab]);

  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [followed, setFollowed] = useState<Set<number>>(new Set());
  const [loadingTopics, setLoadingTopics] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  // Who I follow (for Following tab feed filtering)
  const [followingUserIds, setFollowingUserIds] = useState<string[]>([]);

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
  const [gestureLock, setGestureLock] = useState<GestureLock>("none");

  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // slide animation when switching videos
  const animatingRef = useRef(false);
  const [animating, setAnimating] = useState(false);
  const [animateTransition, setAnimateTransition] = useState<"none" | "ease">("ease");

  // wheel cooldown (desktop)
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

  const activeTopicName = activeTake?.topics?.[0]?.name ?? "Topic";
  const activeTopicId = activeTake?.topic_id ?? null;
  const activeCreatorId = activeTake?.user_id ?? null;

  const isTopicFollowed = useMemo(() => {
    if (!activeTopicId) return false;
    return followed.has(activeTopicId);
  }, [followed, activeTopicId]);

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

  /* ---------------- FOLLOWING USERS (for Following tab feed) ---------------- */
  async function loadFollowingUsers() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setFollowingUserIds([]);
      return [];
    }

    const { data, error } = await supabase
      .from("user_follow_users")
      .select("following_id")
      .eq("follower_id", user.id);

    if (error) {
      console.warn("Failed to load following users", error);
      setFollowingUserIds([user.id]); // fallback: show self only
      return [user.id];
    }

    const ids = (data ?? []).map((r: any) => String(r.following_id)).filter(Boolean);
    // include self so you see your own takes too
    const finalIds = Array.from(new Set([user.id, ...ids]));
    setFollowingUserIds(finalIds);
    return finalIds;
  }

  /* ---------------- FEED LOADERS ---------------- */
  useEffect(() => {
    let channel: any;

    async function init() {
      // Reset modes
      setViewMode({ kind: "feed" });
      setThreadTakes([]);
      setThreadIndex(0);
      setOriginalTake(null);

      setActiveIndex(0);
      setFeedCursorCreatedAt(null);
      setFeedHasMore(true);

      await loadNotInterested();

      // keep followed topics set fresh for topic bubble visuals
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: followedData } = await supabase.from("user_topics").select("topic_id").eq("user_id", user.id);
        setFollowed(new Set<number>((followedData ?? []).map((r: any) => Number(r.topic_id))));
      }

      await loadFeedFirstPage();

      // Realtime reload triggers:
      // - Following tab should react to follow/unfollow users
      // - Topic bubble uses user_topics; not required for feed content but fine to keep UI consistent
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
    return {
      ...(r as TakeRow),
      topics: Array.isArray(r.topics) ? r.topics : r.topics ? [r.topics] : null,
    };
  }

  async function buildFeedBaseQuery(filterUserIds: string[] | null) {
    let q = supabase
      .from("takes")
      .select("id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(50);

    if (filterUserIds && filterUserIds.length > 0) {
      q = q.in("user_id", filterUserIds);
    }

    if (notInterestedIds.size > 0) {
      const ids = Array.from(notInterestedIds)
        .slice(0, 1000)
        .map((id) => `"${id}"`)
        .join(",");
      q = q.not("id", "in", `(${ids})`);
    }

    return q;
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

    // Refresh followed topics set so topic bubble state is accurate
    const { data: followedTopicsData } = await supabase.from("user_topics").select("topic_id").eq("user_id", user.id);
    setFollowed(new Set<number>((followedTopicsData ?? []).map((r: any) => Number(r.topic_id))));

    // Following tab: only creators you follow (plus yourself)
    let filterUserIds: string[] | null = null;
    if (isFollowingTab) {
      filterUserIds = await loadFollowingUsers();
      if (!filterUserIds || filterUserIds.length === 0) {
        setTakes([]);
        setLoadingFeed(false);
        return;
      }
    } else {
      // Explore: no user filter
      filterUserIds = null;
      setFollowingUserIds([]); // not needed, but keeps state clean
    }

    const q = await buildFeedBaseQuery(filterUserIds);
    const { data, error } = await q;

    if (error) {
      setFeedError(isFollowingTab ? "Could not load following feed." : "Could not load explore feed.");
      setTakes([]);
      setLoadingFeed(false);
      return;
    }

    const rows = ((data ?? []) as any[]).map(normalizeTopicsField);

    setTakes(rows);
    setActiveIndex(0);

    const last = rows[rows.length - 1];
    setFeedCursorCreatedAt(last?.created_at ?? null);
    setFeedHasMore(rows.length >= 50);
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

    let filterUserIds: string[] | null = null;

    if (isFollowingTab) {
      // use cached if available; otherwise reload
      const ids = followingUserIds.length > 0 ? followingUserIds : await loadFollowingUsers();
      filterUserIds = ids;
      if (!filterUserIds || filterUserIds.length === 0) {
        setFeedHasMore(false);
        setFeedLoadingMore(false);
        return;
      }
    }

    let q = supabase
      .from("takes")
      .select("id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)")
      .eq("status", "ready")
      .lt("created_at", feedCursorCreatedAt)
      .order("created_at", { ascending: false })
      .limit(50);

    if (filterUserIds && filterUserIds.length > 0) q = q.in("user_id", filterUserIds);

    if (notInterestedIds.size > 0) {
      const ids = Array.from(notInterestedIds)
        .slice(0, 1000)
        .map((id) => `"${id}"`)
        .join(",");
      q = q.not("id", "in", `(${ids})`);
    }

    const { data, error } = await q;

    if (error) {
      console.error("load more error", error);
      setFeedLoadingMore(false);
      return;
    }

    const rows = ((data ?? []) as any[]).map(normalizeTopicsField);

    setTakes((prev) => {
      const seen = new Set(prev.map((t) => t.id));
      const merged = [...prev];
      for (const r of rows) if (!seen.has(r.id)) merged.push(r);
      return merged;
    });

    const last = rows[rows.length - 1];
    setFeedCursorCreatedAt(last?.created_at ?? feedCursorCreatedAt);
    setFeedHasMore(rows.length >= 50);
    setFeedLoadingMore(false);
  }

  // Auto-load more when near the end (feed only)
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

    // Remove locally from feed list
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
      // switch index while offscreen
      nextRaw();

      // snap back without showing it
      setAnimateTransition("none");
      setDragY(0);

      // restore transitions next tick
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

      const { count } = await supabase
        .from("take_reactions")
        .select("take_id", { count: "exact", head: true })
        .eq("take_id", activeTake.id);

      setLikeCount(count ?? 0);

      if (!userId) return;
      const { data } = await supabase
        .from("take_reactions")
        .select("take_id")
        .eq("take_id", activeTake.id)
        .eq("user_id", userId)
        .maybeSingle();

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

  function handleLiveDebate() {
    alert("Live debate requests are coming next");
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
  }

  function onCardPointerDown(e: React.PointerEvent) {
    if (viewMode.kind !== "feed") return;
    if (!activeTake?.id) return;
    if (animatingRef.current) return;

    pointerIdRef.current = e.pointerId;
    swipeStartRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    setGestureLock("none");

    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {}
  }

  function onCardPointerMove(e: React.PointerEvent) {
    if (viewMode.kind !== "feed") return;
    if (!dragging) return;
    if (animatingRef.current) return;

    const start = swipeStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    // decide lock
    if (gestureLock === "none") {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // require a small movement before locking
      if (adx < 8 && ady < 8) return;

      if (adx > ady) setGestureLock("horizontal");
      else setGestureLock("vertical");
    }

    if (gestureLock === "horizontal") {
      // Only allow dragging left
      setDragX(Math.min(0, dx));
      setDragY(0);
      return;
    }

    if (gestureLock === "vertical") {
      // Only allow dragging up/down for navigation
      // clamp a bit so you don't pull too far
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
    if (!dragging) return;

    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    setDragging(false);

    const pid = pointerIdRef.current;
    pointerIdRef.current = null;
    if (pid != null) {
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(pid);
      } catch {}
    }

    if (!start) {
      setDragX(0);
      setDragY(0);
      setGestureLock("none");
      return;
    }

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    // Horizontal swipe left => not interested
    if (gestureLock === "horizontal") {
      if (dx < -140 && Math.abs(dy) < 120) {
        dismissActiveTakeLeft();
        return;
      }
      setDragX(0);
      setGestureLock("none");
      return;
    }

    // Vertical swipe up/down => next/prev
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

      // snap back
      setDragY(0);
      setGestureLock("none");
      return;
    }

    // fallback snap
    setDragX(0);
    setDragY(0);
    setGestureLock("none");
  }

  // Mouse wheel scroll (desktop) -> next/prev
  function onCardWheel(e: React.WheelEvent) {
    if (viewMode.kind !== "feed") return;
    if (animatingRef.current) return;

    // avoid fighting with horizontal scroll gestures
    if (Math.abs(e.deltaY) < 12) return;

    // lock to prevent rapid skipping
    if (wheelLockRef.current) return;

    // we do want to prevent page scroll while interacting with feed card
    e.preventDefault();

    wheelLockRef.current = true;
    if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);

    wheelTimerRef.current = window.setTimeout(() => {
      wheelLockRef.current = false;
    }, 450);

    if (e.deltaY > 0) animateToNext();
    else animateToPrev();
  }

  // Reset swipe state when take changes
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

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <TakesTopicsRibbon />

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
              <button onClick={() => loadFeedFirstPage()} className="mt-4 px-4 py-2 rounded border border-zinc-400 bg-white hover:bg-zinc-50 text-sm">
                Retry
              </button>
            </div>
          </div>
        ) : visibleList.length === 0 ? (
          <div className="flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
            <div className="text-center">
              <div className="text-2xl font-semibold mb-2">No takes yet</div>
              <p className="text-sm text-zinc-600">
                {isFollowingTab ? "Follow some users to see their takes here." : "Record the first take for any topic."}
              </p>
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
            // needed so preventDefault works in onWheel in React
            style={{ overscrollBehavior: "contain" }}
          >
            {/* Sliding layer */}
            <div
              className="absolute inset-0"
              style={{
                transform: `translate3d(${dragX}px, ${dragY}px, 0)`,
                transition:
                  animateTransition === "none"
                    ? "none"
                    : dragging
                      ? "none"
                      : "transform 200ms ease",
                willChange: "transform",
              }}
            >
              <video
                key={activeTake?.id}
                ref={videoRef}
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

              {/* Top-left overlay */}
              <div className="absolute left-4 top-4 bg-black/60 text-white px-3 py-2 rounded-lg text-sm">
                <div className="font-medium flex items-center gap-2">
                  {/* Topic bubble */}
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
                  <button onClick={showOriginal} className="mt-2 text-xs underline opacity-90 hover:opacity-100">
                    {loadingOriginal ? "Loading original…" : "Show original"}
                  </button>
                )}

                {showingOriginal && viewMode.kind === "original" && (
                  <button onClick={backToThreadFromOriginal} className="mt-2 text-xs underline opacity-90 hover:opacity-100">
                    ← Back to thread
                  </button>
                )}
              </div>

              {/* Thread empty / loading / error overlays */}
              {showingThread && !loadingThread && threadTakes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/60 text-white px-4 py-3 rounded-lg text-sm">No replies on this side yet.</div>
                </div>
              )}

              {showingThread && loadingThread && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/60 text-white px-4 py-3 rounded-lg text-sm">Loading thread…</div>
                </div>
              )}

              {showingThread && threadError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-black/60 text-white px-4 py-3 rounded-lg text-sm text-center">
                    {threadError}
                    <div className="mt-2">
                      <button
                        onClick={() => {
                          if (viewMode.kind === "thread") openThread(viewMode.rootTakeId, viewMode.stance, viewMode.entryTakeId);
                        }}
                        className="px-3 py-1 rounded bg-white/90 text-black text-xs"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Center-left Back button while browsing thread */}
              {showingThread && (
                <button
                  onClick={backToEntryInThread}
                  className="absolute left-4 top-1/2 -translate-y-1/2 px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm"
                  title="Back to the take you started from"
                >
                  Back
                </button>
              )}

              {/* Prev/Next (desktop affordance; swipe/scroll also works now) */}
              {!showingOriginal && (
                <div className="absolute left-4 bottom-4 flex gap-2">
                  <button
                    onClick={animateToPrev}
                    disabled={!canGoPrev() || animating}
                    className="px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm disabled:opacity-50"
                  >
                    ↑ Prev
                  </button>
                  <button
                    onClick={animateToNext}
                    disabled={!canGoNext() || animating}
                    className="px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm disabled:opacity-50"
                  >
                    ↓ Next
                  </button>
                </div>
              )}

              {/* Subtle “loading more” */}
              {viewMode.kind === "feed" && feedLoadingMore && (
                <div className="absolute right-4 bottom-4 bg-black/60 text-white px-3 py-2 rounded text-xs">Loading more…</div>
              )}
            </div>

            {/* Background hint revealed while dragging left */}
            {viewMode.kind === "feed" && (
              <div className="absolute inset-0 flex items-center justify-end pr-6 pointer-events-none">
                <div className="bg-black/60 text-white px-4 py-2 rounded-lg text-sm">Not interested</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* EXPLORE: topic discovery grid */}
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

      {/* Right action rail */}
      <div className="fixed right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3">
        <button
          onClick={() => {
            if (showingOriginal) backToThreadFromOriginal();
            if (showingThread) backToEntryInThread();
          }}
          className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs"
          title={showingOriginal ? "Back to thread" : showingThread ? "Back" : "Topic"}
        >
          {showingOriginal ? "Back" : showingThread ? "Back" : "Topic"}
        </button>

        {/* Profile button -> goes to creator profile; with green follow check */}
        <div className="relative w-14 h-14">
          <button onClick={goToCreatorProfile} className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
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
        >
          Against
        </button>

        <button
          onClick={toggleLike}
          disabled={!activeTake?.id || likingBusy}
          className={`w-14 h-14 rounded border border-zinc-400 text-xs disabled:opacity-50 ${liked ? "bg-black text-white" : "bg-zinc-100"}`}
          title="React"
        >
          👍
          <div className="text-[10px] opacity-80 mt-1">{likeCount}</div>
        </button>

        <button
          onClick={openJoinPicker}
          disabled={!activeRootId}
          className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs disabled:opacity-50"
          title="Reply to the original take"
        >
          Join
          <div className="text-[10px] opacity-80 mt-1">take</div>
        </button>

        {activeTake?.is_challengeable ? (
          <button
            onClick={handleLiveDebate}
            className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-[11px]"
            title="Request a live debate (coming next)"
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
        >
          In favor
        </button>

        <button onClick={() => router.push("/takes/record")} className="w-20 h-20 rounded border border-zinc-400 bg-black text-white text-xs hover:opacity-90">
          Record
          <br />
          take
        </button>
      </div>
    </div>
  );
}