"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Profile() {
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
      <h1 className="text-2xl font-bold">Profile</h1>
      <input
        className="w-full border rounded p-2"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        placeholder="Your handle"
      />

      {/* Add this muted caption line here */}
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
    </main>
  );
}
