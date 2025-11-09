"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [handle, setHandle] = useState("");

  useEffect(() => {
    // Load auth + existing profile handle if any
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      setEmail(u?.email ?? null);
      setUserId(u?.id ?? null);

      if (u?.id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("handle")
          .eq("user_id", u.id)
          .maybeSingle();
        if (prof?.handle) setHandle(prof.handle);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function saveHandle() {
    if (!userId) return alert("Please sign in first.");
    if (!handle.trim()) return alert("Enter a display name.");
    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, handle: handle.trim() });
    if (error) alert(error.message);
    else alert("Saved!");
  }

  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold">Welcome to Debate.Me</h1>

      <div className="mt-4 p-4 border rounded">
        {email ? (
          <div className="space-x-3">
            <span>
              Signed in as <b>{email}</b>
            </span>
            <button
             onClick={signOut}
             className="rounded px-3 py-1 bg-[var(--brand)] text-black hover:opacity-90"
            >
              Sign out
            </button>
          </div>
        ) : (
          <a
           href="/login"
           className="inline-block rounded px-3 py-1 bg-[var(--brand)] text-black hover:opacity-90"
          >
           Sign in
          </a>
        )}

        {/* Display name editor (only when signed in) */}
        {email && (
  <div className="mt-4">
    <label className="block text-sm mb-1">Display name</label>
    <div className="flex gap-2">
      <input
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        placeholder="e.g., MoesLuis"
        className="border rounded p-2 flex-1"
      />
      <button onClick={saveHandle} className="rounded bg-zinc-800 text-white px-4 py-2">
        Save
      </button>
    </div>
    <p className="text-xs text-zinc-500 mt-1">This name will appear in the video room.</p>
  </div>
)}

        {/* Join the test room */}
        <div className="mt-6">
          <a
            href="/room/deb-test-123"
            className="inline-block rounded bg-zinc-800 text-white px-4 py-2"
          >
            Join test room
          </a>
          <p className="text-sm text-[var(--muted)] mt-2">
           Open this link in two different browsers (or devices) to see both participants.
          </p>
        </div>
      </div>
    </main>
  );
}
