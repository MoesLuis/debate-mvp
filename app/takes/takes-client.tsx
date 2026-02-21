"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TakesTopicsRibbon from "@/components/TakesTopicsRibbon";

type Topic = {
  id: number;
  name: string;
};

export default function TakesClient() {
  const params = useSearchParams();
  const tab = params.get("tab") || "following";
  const isFollowing = useMemo(() => tab !== "explore", [tab]);

  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [followed, setFollowed] = useState<Set<number>>(new Set());
  const [loadingTopics, setLoadingTopics] = useState(false);

  /* ---------------- LOAD ALL TOPICS ---------------- */
  useEffect(() => {
    if (!isFollowing) {
      loadExploreData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFollowing]);

  async function loadExploreData() {
    setLoadingTopics(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

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

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      {/* Ribbon always visible */}
      <TakesTopicsRibbon />

      {/* FOLLOWING TAB */}
      {isFollowing && (
        <div className="mt-6 flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
          <div className="text-center">
            <div className="text-4xl font-semibold mb-2">Video</div>
            <p className="text-sm text-zinc-600">
              Following feed (uses your selected topics)
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              Phase 3+ will load real takes here.
            </p>
          </div>
        </div>
      )}

      {/* EXPLORE TAB */}
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
                    {isFollowed && (
                      <span className="ml-2 text-xs">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Right action rail (unchanged placeholder) */}
      <div className="fixed right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3">
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Topic
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Profile
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Against
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          👍
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Challenge
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          In favor
        </button>
        <button className="w-20 h-20 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Record
          <br />
          take
        </button>
      </div>
    </div>
  );
}