"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TopicSelector from "@/components/TopicSelector";

export default function Profile() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.handle) setHandle(data.handle);
    })();
  }, []);

  async function saveHandle() {
    setMsg(null);
    const { data: { user } } = await supabase.auth.getUser();
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
          className="px-3 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-sm"
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
    </main>
  );
}