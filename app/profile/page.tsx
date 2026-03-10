"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TopicSelector from "@/components/TopicSelector";

export default function Profile() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sr, setSr] = useState<number | null>(null);
  const [cr, setCr] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("handle, skill_rating, collab_rating")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data?.handle) setHandle(data.handle);
      if (typeof data?.skill_rating === "number") setSr(data.skill_rating);
      if (typeof data?.collab_rating === "number") setCr(data.collab_rating);
    })();
  }, []);

  async function saveHandle() {
    setMsg(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("profiles")
      .update({ handle })
      .eq("user_id", user.id);

    setMsg(error ? `Error: ${error.message}` : "Saved!");
  }

  return (
    <main className="p-6 max-w-md mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Profile</h1>

        <button
          onClick={() => router.push("/inbox")}
          className="px-3 py-2 rounded-full border border-emerald-600/40 bg-emerald-700/20 hover:bg-emerald-700/30 text-sm text-white backdrop-blur"
        >
          Inbox
        </button>
      </div>

      <input
        className="w-full border rounded p-2"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        placeholder="Your handle"
      />

      <p className="text-xs text-[var(--muted)] mt-1">
        This name will appear in the video room.
      </p>

      <button
        onClick={saveHandle}
        className="rounded bg-white/10 hover:bg-white/15 text-white px-4 py-2 disabled:opacity-50"
        disabled={!handle.trim()}
      >
        Save
      </button>

      {msg && <p>{msg}</p>}

      <TopicSelector />

      <section className="pt-2">
        <h2 className="text-lg font-semibold mb-2">Your Scores</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Skill Rating</p>
            <p className="mt-1 text-2xl font-semibold">{sr ?? "—"}</p>
            <p className="mt-1 text-xs text-zinc-500">SR</p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Collab Rating</p>
            <p className="mt-1 text-2xl font-semibold">{cr ?? "—"}</p>
            <p className="mt-1 text-xs text-zinc-500">CR</p>
          </div>
        </div>
      </section>
    </main>
  );
}