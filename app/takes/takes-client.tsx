"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-hls="true"]'
    );
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

export default function TakesClient() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") || "following";
  const isFollowing = useMemo(() => tab !== "explore", [tab]);

  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [followed, setFollowed] = useState<Set<number>>(new Set());
  const [loadingTopics, setLoadingTopics] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);

  // Feed takes (root + responses)
  const [takes, setTakes] = useState<TakeRow[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Infinite loading state
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedCursorCreatedAt, setFeedCursorCreatedAt] = useState<string | null>(null);

  // Not interested IDs (cached client-side)
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

  // Swipe detection
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

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

    // Keep it bounded (MVP). We can switch to a server-side view/RPC later.
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

    const s = new Set<string>((data ?? []).map((r: any) => String(r.take_id)));
    setNotInterestedIds(s);
  }

  /* ---------------- LOAD TOPICS (Explore grid) ---------------- */
  useEffect(() => {
    if (!isFollowing) {
      loadExploreTopics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFollowing]);

  async function loadExploreTopics() {
    setLoadingTopics(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoadingTopics(false);
      return;
    }

    const { data: topicsData } = await supabase
      .from("topics")
      .select("id, name")
      .order("name");

    const { data: followedData } = await supabase
      .from("user_topics")
      .select("topic_id")
      .eq("user_id", user.id);

    if (topicsData) {
      setAllTopics(
        topicsData.map((t: any) => ({
          id: Number(t.id),
          name: t.name,
        }))
      );
    }

    if (followedData) {
      setFollowed(new Set(followedData.map((r: any) => r.topic_id)));
    }

    setLoadingTopics(false);
  }

  async function toggleFollow(topicId: number) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    if (followed.has(topicId)) {
      await supabase
        .from("user_topics")
        .delete()
        .eq("user_id", user.id)
        .eq("topic_id", topicId);

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
      await loadFeedFirstPage();

      if (isFollowing) {
        channel = supabase
          .channel("takes-following-user-topics")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "user_topics" },
            async () => {
              setViewMode({ kind: "feed" });
              setThreadTakes([]);
              setThreadIndex(0);
              setOriginalTake(null);

              setActiveIndex(0);
              setFeedCursorCreatedAt(null);
              setFeedHasMore(true);

              await loadNotInterested();
              await loadFeedFirstPage();
            }
          )
          .subscribe();
      }
    }

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFollowing]);

  function normalizeTopicsField(r: any): TakeRow {
    return {
      ...(r as TakeRow),
      topics: Array.isArray(r.topics) ? r.topics : r.topics ? [r.topics] : null,
    };
  }

  async function buildFeedBaseQuery(topicIds: number[] | null) {
    let q = supabase
      .from("takes")
      .select(
        "id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)"
      )
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(50);

    if (topicIds && topicIds.length > 0) {
      q = q.in("topic_id", topicIds);
    }

    // Exclude not-interested (client-side cached IDs).
    // Supabase .not('id','in', ...) expects a string like "(...)".
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
      setFollowed(new Set());
      setLoadingFeed(false);
      return;
    }

    // Figure topicIds for following
    let topicIds: number[] | null = null;

    if (isFollowing) {
      const { data: followedData, error: fErr } = await supabase
        .from("user_topics")
        .select("topic_id")
        .eq("user_id", user.id);

      if (fErr) {
        setFeedError("Could not load your topics.");
        setLoadingFeed(false);
        return;
      }

      topicIds = (followedData ?? [])
        .map((r: any) => r.topic_id)
        .filter((x: any) => typeof x === "number");

      setFollowed(new Set<number>(topicIds));

      if (topicIds.length === 0) {
        setTakes([]);
        setLoadingFeed(false);
        return;
      }
    }

    const q = await buildFeedBaseQuery(topicIds);

    const { data, error } = await q;

    if (error) {
      setFeedError(isFollowing ? "Could not load takes feed." : "Could not load explore feed.");
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

    let topicIds: number[] | null = null;

    if (isFollowing) {
      const { data: followedData } = await supabase
        .from("user_topics")
        .select("topic_id")
        .eq("user_id", user.id);

      topicIds = (followedData ?? [])
        .map((r: any) => r.topic_id)
        .filter((x: any) => typeof x === "number");

      if (topicIds.length === 0) {
        setFeedHasMore(false);
        setFeedLoadingMore(false);
        return;
      }
    }

    // Same base query but paginate by created_at
    let q = supabase
      .from("takes")
      .select(
        "id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)"
      )
      .eq("status", "ready")
      .lt("created_at", feedCursorCreatedAt)
      .order("created_at", { ascending: false })
      .limit(50);

    if (topicIds && topicIds.length > 0) {
      q = q.in("topic_id", topicIds);
    }

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
      for (const r of rows) {
        if (!seen.has(r.id)) merged.push(r);
      }
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
    if (remaining <= 5) {
      loadFeedMore();
    }
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

    // Insert (ignore duplicates)
    const { error } = await supabase.from("take_not_interested").insert({
      user_id: user.id,
      take_id: takeId,
    });

    if (error) {
      // If it's a unique violation, it’s still fine; just proceed.
      console.warn("not interested insert error", error);
    }

    setNotInterestedIds((prev) => {
      const next = new Set(prev);
      next.add(takeId);
      return next;
    });

    // Remove locally from feed list (only in feed mode)
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
      .select(
        "id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)"
      )
      .eq("status", "ready")
      .eq("parent_take_id", rootTakeId)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data, error } =
      stance === "against"
        ? await query.eq("stance", "against")
        : await query.or("stance.is.null,stance.neq.against");

    if (error) {
      setThreadError("Could not load replies.");
      setThreadTakes([]);
      setLoadingThread(false);
      return;
    }

    const rows = ((data ?? []) as any[]).map(normalizeTopicsField);

    setThreadTakes(rows);
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
      .select(
        "id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)"
      )
      .eq("id", rootId)
      .maybeSingle();

    if (error || !data) {
      setLoadingOriginal(false);
      alert("Could not load original take.");
      return;
    }

    const rootRow = normalizeTopicsField(data);

    setOriginalTake(rootRow);
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
    const canPlayHlsNatively =
      videoEl.canPlayType("application/vnd.apple.mpegurl") !== "";

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
  function next() {
    if (showingOriginal) return;

    if (showingThread) {
      setThreadIndex((i) => Math.min(i + 1, Math.max(0, threadTakes.length - 1)));
      return;
    }

    setActiveIndex((i) => Math.min(i + 1, Math.max(0, takes.length - 1)));
  }

  function prev() {
    if (showingOriginal) return;

    if (showingThread) {
      setThreadIndex((i) => Math.max(i - 1, 0));
      return;
    }

    setActiveIndex((i) => Math.max(i - 1, 0));
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") next();
      if (e.key === "ArrowUp") prev();
      if (e.key === "Escape" && showingThread) backToEntryInThread();
      if (e.key === "Escape" && showingOriginal) backToThreadFromOriginal();
      if (e.key === "ArrowLeft" && viewMode.kind === "feed" && activeTake?.id) {
        markNotInterested(activeTake.id);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingThread, showingOriginal, takes.length, threadTakes.length, viewMode.kind, activeTake?.id]);

  const activeTopicName = activeTake?.topics?.[0]?.name ?? "Topic";

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
        const { error } = await supabase
          .from("take_reactions")
          .delete()
          .eq("take_id", activeTake.id)
          .eq("user_id", user.id);

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

  /* ---------------- SWIPE HANDLERS (feed only) ---------------- */
  function onPointerDown(e: React.PointerEvent) {
    if (viewMode.kind !== "feed") return;
    swipeStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }

  function onPointerUp(e: React.PointerEvent) {
    if (viewMode.kind !== "feed") return;
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || !activeTake?.id) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    // Swipe left threshold
    if (dx < -90 && Math.abs(dy) < 80) {
      markNotInterested(activeTake.id);
    }
  }

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <TakesTopicsRibbon />

      {/* JOIN PICKER MODAL */}
      {joinPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-lg border border-zinc-300 bg-white p-4">
            <div className="text-lg font-semibold">Join this take</div>
            <p className="text-sm text-zinc-600 mt-1">
              Choose how you’re replying to the original take:
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => joinTake("pro")}
                className="px-4 py-3 rounded bg-black text-white text-sm hover:opacity-90"
              >
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
              <p className="text-sm text-zinc-600">
                {isFollowing ? "Pulling takes from your topics" : "Exploring all takes"}
              </p>
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
              <p className="text-sm text-zinc-600">Record the first take for one of your topics.</p>
              <button
                onClick={() => router.push("/takes/record")}
                className="mt-4 px-4 py-2 rounded bg-black text-white text-sm hover:opacity-90"
              >
                Record a take
              </button>
            </div>
          </div>
        ) : (
          <div
            className="h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100 overflow-hidden relative"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
          >
            <video
              key={activeTake?.id}
              ref={videoRef}
              className={`w-full h-full object-contain bg-black transition-opacity ${
                videoLoading ? "opacity-0" : "opacity-100"
              }`}
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
              <div className="font-medium">
                {activeTopicName}
                {showingThread ? <span className="ml-2 text-xs opacity-80">(thread)</span> : null}
                {showingOriginal ? <span className="ml-2 text-xs opacity-80">(original)</span> : null}
              </div>

              <div className="text-xs opacity-80">
                {visibleIndex + 1} / {visibleList.length}
              </div>

              {showShowOriginalButton && (
                <button
                  onClick={showOriginal}
                  className="mt-2 text-xs underline opacity-90 hover:opacity-100"
                >
                  {loadingOriginal ? "Loading original…" : "Show original"}
                </button>
              )}

              {showingOriginal && viewMode.kind === "original" && (
                <button
                  onClick={backToThreadFromOriginal}
                  className="mt-2 text-xs underline opacity-90 hover:opacity-100"
                >
                  ← Back to thread
                </button>
              )}
            </div>

            {/* Thread empty / loading / error overlays */}
            {showingThread && !loadingThread && threadTakes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 text-white px-4 py-3 rounded-lg text-sm">
                  No replies on this side yet.
                </div>
              </div>
            )}

            {showingThread && loadingThread && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 text-white px-4 py-3 rounded-lg text-sm">
                  Loading thread…
                </div>
              </div>
            )}

            {showingThread && threadError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-black/60 text-white px-4 py-3 rounded-lg text-sm text-center">
                  {threadError}
                  <div className="mt-2">
                    <button
                      onClick={() => {
                        if (viewMode.kind === "thread") {
                          openThread(viewMode.rootTakeId, viewMode.stance, viewMode.entryTakeId);
                        }
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

            {/* Prev/Next */}
            {!showingOriginal && (
              <div className="absolute left-4 bottom-4 flex gap-2">
                <button
                  onClick={prev}
                  disabled={visibleIndex === 0}
                  className="px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm disabled:opacity-50"
                >
                  ↑ Prev
                </button>
                <button
                  onClick={next}
                  disabled={visibleIndex >= visibleList.length - 1}
                  className="px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm disabled:opacity-50"
                >
                  ↓ Next
                </button>

                {/* Not interested button (MVP + debug friendly) */}
                {viewMode.kind === "feed" && activeTake?.id && (
                  <button
                    onClick={() => markNotInterested(activeTake.id)}
                    className="ml-2 px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm"
                    title="Not interested (also: swipe left)"
                  >
                    ← Not interested
                  </button>
                )}
              </div>
            )}

            {/* Subtle “loading more” */}
            {viewMode.kind === "feed" && feedLoadingMore && (
              <div className="absolute right-4 bottom-4 bg-black/60 text-white px-3 py-2 rounded text-xs">
                Loading more…
              </div>
            )}
          </div>
        )}
      </div>

      {/* EXPLORE: topic discovery grid */}
      {!isFollowing && (
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
                    onClick={() => toggleFollow(topic.id)}
                    className={`px-4 py-3 rounded-lg border text-sm transition ${
                      isFollowed
                        ? "bg-black text-white border-black"
                        : "bg-zinc-100 border-zinc-400 hover:bg-zinc-50"
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

        <button
          onClick={() => router.push("/profile")}
          className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs"
        >
          Profile
        </button>

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
          className={`w-14 h-14 rounded border border-zinc-400 text-xs disabled:opacity-50 ${
            liked ? "bg-black text-white" : "bg-zinc-100"
          }`}
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

        <button
          onClick={() => router.push("/takes/record")}
          className="w-20 h-20 rounded border border-zinc-400 bg-black text-white text-xs hover:opacity-90"
        >
          Record
          <br />
          take
        </button>
      </div>
    </div>
  );
}