"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TopicRow = {
  id: number;
  name: string;
};

function isTopicRow(x: any): x is TopicRow {
  return (
    x &&
    typeof x === "object" &&
    typeof x.id === "number" &&
    typeof x.name === "string"
  );
}

export default function TakesTopicsRibbon() {
  const router = useRouter();

  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadTopics() {
  setLoading(true);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 🔥 IF NOT LOGGED IN → LOAD ALL TOPICS
  if (!user) {
    const { data, error } = await supabase
      .from("topics")
      .select("id, name");

    if (error) {
      console.error("Failed to load all topics", error);
      setTopics([]);
      setLoading(false);
      return;
    }

    const mapped = (data ?? [])
      .map((row: any) => {
        if (typeof row.id !== "number" || typeof row.name !== "string") return null;
        return { id: row.id, name: row.name };
      })
      .filter(isTopicRow);

    mapped.sort((a, b) => a.name.localeCompare(b.name));

    setTopics(mapped);
    setLoading(false);
    return;
  }

  // ✅ EXISTING LOGIC (unchanged)
  const { data, error } = await supabase
    .from("user_topics")
    .select("topic_id, topics(name)")
    .eq("user_id", user.id);

  if (error) {
    console.error("Failed to load user topics", error);
    setTopics([]);
    setLoading(false);
    return;
  }

  const mapped = (data ?? [])
    .map((row: any) => {
      const id = row?.topic_id;
      const name = row?.topics?.name;
      if (typeof id !== "number" || typeof name !== "string") return null;
      return { id, name };
    })
    .filter(isTopicRow);

  mapped.sort((a, b) => a.name.localeCompare(b.name));

  setTopics(mapped);
  setLoading(false);
}

  useEffect(() => {
    loadTopics();

    const channel = supabase
      .channel("user-topics-ribbon")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_topics" },
        () => loadTopics()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function removeTopic(topicId: number) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("user_topics")
      .delete()
      .eq("user_id", user.id)
      .eq("topic_id", topicId);

    if (error) {
      console.error("Failed to remove topic", error);
      return;
    }

    setTopics((prev) => prev.filter((t) => t.id !== topicId));
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-3">
      <button
        onClick={() => router.push("/profile")}
        className="px-4 py-2 rounded-full border border-yellow-500/40 bg-yellow-600/20 hover:bg-yellow-600/25 text-sm shrink-0 transition"
        aria-label="Edit topics"
      >
        Topics
      </button>

      {loading ? (
        <div className="text-sm text-zinc-600">Loading topics…</div>
      ) : topics.length === 0 ? (
        <button
          onClick={() => router.push("/profile")}
          className="px-4 py-2 rounded-full border border-zinc-400 bg-zinc-100 text-sm shrink-0 text-zinc-700"
        >
          Add topics →
        </button>
      ) : (
        topics.map((t) => (
          <button
            key={t.id}
            onClick={() => removeTopic(t.id)}
            className="px-4 py-2 rounded-full border border-emerald-800/40 bg-emerald-800/50 hover:bg-emerald-900/30 text-sm shrink-0 transition text-white" //This sets the color for the individual topics bubbles
            title="Click to remove from your topics"
          >
            {t.name}
          </button>
        ))
      )}
    </div>
  );
}