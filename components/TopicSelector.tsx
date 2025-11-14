"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// NOTE: topics.id is BIGINT in the DB, so we model it as number here.
type Topic = {
  id: number;
  name: string;
};

export default function TopicSelector() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setMessage(null);

      // Load all topics
      const { data: topicsData, error: topicsErr } = await supabase
        .from("topics")
        .select("id, name")
        .order("name");

      if (topicsErr) {
        setMessage(`Error loading topics: ${topicsErr.message}`);
        return;
      }
      // Coerce ids to numbers (in case they arrive as strings)
      const normalized =
        (topicsData || []).map((t: any) => ({ id: Number(t.id), name: t.name })) as Topic[];
      setTopics(normalized);

      // Load current user's selected topics
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: ut, error: utErr } = await supabase
          .from("user_topics")
          .select("topic_id")
          .eq("user_id", user.id);

        if (utErr) {
          setMessage(`Error loading selections: ${utErr.message}`);
          return;
        }
        setSelected((ut || []).map((r: any) => Number(r.topic_id)));
      }
    }
    load();
  }, []);

  function toggle(topicId: number) {
    setSelected(prev =>
      prev.includes(topicId)
        ? prev.filter(id => id !== topicId)
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

    // Remove all rows for this user first
    const { error: delErr } = await supabase
      .from("user_topics")
      .delete()
      .eq("user_id", user.id);

    if (delErr) {
      setMessage(`Error clearing rows: ${delErr.message}`);
      setLoading(false);
      return;
    }

    if (selected.length === 0) {
      setMessage("Topics saved!");
      setLoading(false);
      return;
    }

    // Insert new rows (ensure topic_id is number for BIGINT)
    const rows = selected.map(topic_id => ({
      user_id: user.id,
      topic_id: Number(topic_id),
    }));

    const { error: insErr } = await supabase.from("user_topics").insert(rows);
    if (insErr) setMessage(`Error saving topics: ${insErr.message}`);
    else setMessage("Topics saved!");

    setLoading(false);
  }

  return (
    <div className="mt-6 space-y-3">
      <h2 className="text-lg font-semibold">Select your topics</h2>

      <div className="flex flex-wrap gap-2">
        {topics.map(topic => (
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
        className="rounded bg-white/10 hover:bg-white/15 text-white px-4 py-2 disabled:opacity-50"
      >
        {loading ? "Saving…" : "Save Topics"}
      </button>

      {message && <p className="text-sm text-zinc-400">{message}</p>}
    </div>
  );
}
