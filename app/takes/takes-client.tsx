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

  // Current user
  const [userId, setUserId] = useState<string | null>(null);

  // Feed takes (root + responses)
  const [takes, setTakes] = useState<TakeRow[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Thread browsing
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: "feed" });
  const [threadTakes, setThreadTakes] = useState<TakeRow[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadIndex, setThreadIndex] = useState(0);

  // Show original (root take)
  const [originalTake, setOriginalTake] = useState<TakeRow | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);

  // Reaction state
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState<number>(0);
  const [likingBusy, setLikingBusy] = useState(false);

  // Join take stance picker
  const [joinPickerOpen, setJoinPickerOpen] = useState(false);
  const [joinRootId, setJoinRootId] = useState<string | null>(null);

  // Video playback refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsInstanceRef = useRef<any>(null);

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
      setViewMode({ kind: "feed" });
      setThreadTakes([]);
      setThreadIndex(0);
      setOriginalTake(null);

      await loadFeed();

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
              await loadFeed();
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

  async function loadFeed() {
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

    if (!isFollowing) {
      const { data, error } = await supabase
        .from("takes")
        .select(
          "id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)"
        )
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        setFeedError("Could not load explore feed.");
        setTakes([]);
        setLoadingFeed(false);
        return;
      }

      const rows = ((data ?? []) as unknown as TakeRow[]).map((r) => ({
        ...r,
        topics: Array.isArray(r.topics) ? r.topics : r.topics ? [r.topics as any] : null,
      }));

      setTakes(rows);
      setActiveIndex(0);
      setLoadingFeed(false);
      return;
    }

    const { data: followedData, error: fErr } = await supabase
      .from("user_topics")
      .select("topic_id")
      .eq("user_id", user.id);

    if (fErr) {
      setFeedError("Could not load your topics.");
      setLoadingFeed(false);
      return;
    }

    const topicIds = (followedData ?? [])
      .map((r: any) => r.topic_id)
      .filter((x: any) => typeof x === "number");

    setFollowed(new Set<number>(topicIds));

    if (topicIds.length === 0) {
      setTakes([]);
      setActiveIndex(0);
      setLoadingFeed(false);
      return;
    }

    const { data: takesData, error: tErr } = await supabase
      .from("takes")
      .select(
        "id, user_id, topic_id, stance, playback_id, created_at, parent_take_id, is_challengeable, topics(name)"
      )
      .eq("status", "ready")
      .in("topic_id", topicIds)
      .order("created_at", { ascending: false })
      .limit(50);

    if (tErr) {
      setFeedError("Could not load takes feed.");
      setLoadingFeed(false);
      return;
    }

    const rows = ((takesData ?? []) as unknown as TakeRow[]).map((r) => ({
      ...r,
      topics: Array.isArray(r.topics) ? r.topics : r.topics ? [r.topics as any] : null,
    }));

    setTakes(rows);
    setActiveIndex(0);
    setLoadingFeed(false);
  }

  /* ---------------- THREAD LOADERS ---------------- */
  async function openThread(rootTakeId: string, stance: "against" | "for", entryTakeId: string) {
    setViewMode({ kind: "thread", rootTakeId, stance, entryTakeId });
    setThreadError(null);
    setLoadingThread(true);
    setThreadIndex(0);

    const forStances = ["pro", "for", "in_favor"];

    const query = supabase
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
        : await query.in("stance", forStances);

    if (error) {
      setThreadError("Could not load replies.");
      setThreadTakes([]);
      setLoadingThread(false);
      return;
    }

    const rows = ((data ?? []) as unknown as TakeRow[]).map((r) => ({
      ...r,
      topics: Array.isArray(r.topics) ? r.topics : r.topics ? [r.topics as any] : null,
    }));

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

    const rootRow = {
      ...(data as unknown as TakeRow),
      topics: Array.isArray((data as any).topics)
        ? (data as any).topics
        : (data as any).topics
        ? [(data as any).topics]
        : null,
    };

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
    // destroy old HLS instance
    if (hlsInstanceRef.current) {
      try {
        hlsInstanceRef.current.destroy();
      } catch {}
      hlsInstanceRef.current = null;
    }

    const videoEl = videoRef.current;

    // If no active take or no playback yet, CLEAR the element so it can't show a previous frame.
    if (!videoEl || !activeTake?.playback_id) {
      if (videoEl) {
        try {
          videoEl.pause();
        } catch {}
        try {
          videoEl.removeAttribute("src");
          // also reset poster just in case
          (videoEl as any).poster = "";
          videoEl.load();
        } catch {}
      }
      return;
    }

    const src = muxHlsUrl(activeTake.playback_id);
    const canPlayHlsNatively =
      videoEl.canPlayType("application/vnd.apple.mpegurl") !== "";

    async function attach() {
      const v = videoRef.current;
      if (!v) return;

      // Hard reset so we never show the previous video's frozen frame
      try {
        v.pause();
      } catch {}
      try {
        (v as any).poster = "";
        v.removeAttribute("src");
        v.load();
      } catch {}

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
    // IMPORTANT: include playback_id so we don't miss a re-attach
  }, [activeTake?.id, activeTake?.playback_id]);

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
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingThread, showingOriginal, takes.length, threadTakes.length]);

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
          setLikeCount((c) => c + 1); // ✅ fixed
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
    alert("Live debate requests are coming next 😈");
  }

  const showShowOriginalButton = !!activeTake?.parent_take_id && !showingOriginal;

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <TakesTopicsRibbon />

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
                onClick={() => loadFeed()}
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
              <p className="text-sm text-zinc-600">
                Record the first take for one of your topics.
              </p>
              <button
                onClick={() => router.push("/takes/record")}
                className="mt-4 px-4 py-2 rounded bg-black text-white text-sm hover:opacity-90"
              >
                Record a take
              </button>
            </div>
          </div>
        ) : (
          <div className="h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100 overflow-hidden relative">
            <video
              key={activeTake?.id ?? "video"} // ✅ forces remount to prevent old frame flash
              ref={videoRef}
              className="w-full h-full object-contain bg-black"
              playsInline
              controls
            />

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

            {showingThread && (
              <button
                onClick={backToEntryInThread}
                className="absolute left-4 top-1/2 -translate-y-1/2 px-3 py-2 rounded bg-white/90 border border-zinc-300 text-sm"
                title="Back to the take you started from"
              >
                Back
              </button>
            )}

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
              </div>
            )}
          </div>
        )}
      </div>

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