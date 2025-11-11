"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Topic = {
  id: string;
  name: string;
};

export default function TopicSelector() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Fetch all topics and this user's topics
  useEffect(() => {
    async function load() {
      const { data: topicsData } = await supabase
        .from("topics")
        .select("*")
        .order("name");
      setTopics(topicsData || []);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: ut } = await supabase
          .from("user_topics")
          .select("topic_id")
          .eq("user_id", user.id);
        setSelected(ut?.map((r: any) => r.topic_id) || []);
      }
    }
    load();
  }, []);

  function toggle(topicId: string) {
    setSelected((prev) =>
      prev.includes(topicId)
        ? prev.filter((t) => t !== topicId)
        : [...prev, topicId]
    );
  }

  async function save() {
    setLoading(true);
    setMessage(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setMessage("Please sign in.");
      setLoading(false);
      return;
    }
    // Delete existing user_topics rows
    await supabase.from("user_topics").delete().eq("user_id", user.id);
    // Insert new rows
    const inserts = selected.map((topic_id) => ({
      user_id: user.id,
      topic_id,
    }));
    const { error } = await supabase.from("user_topics").insert(inserts);
    if (error) setMessage(error.message);
    else setMessage("Topics saved!");
    setLoading(false);
  }

  return (
    <div className="mt-6 space-y-3">
      <h2 className="text-lg font-semibold">Select your topics</h2>
      <div className="flex flex-wrap gap-2">
        {topics.map((topic) => (
          <label
            key={topic.id}
            className="flex items-center gap-2 bg-zinc-800 px-3 py-2 rounded-lg cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(topic.id)}
              onChange={() => toggle(topic.id)}
            />
            {topic.name}
          </label>
        ))}
      </div>
      <button
        onClick={save}
        disabled={loading}
        className="rounded bg-white/10 hover:bg-white/15 text-white px-4 py-2"
      >
        {loading ? "Saving…" : "Save Topics"}
      </button>
      {message && <p className="text-sm text-zinc-400">{message}</p>}
    </div>
  );
}
