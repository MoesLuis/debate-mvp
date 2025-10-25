"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Image from "next/image";

export default function Home() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold">Welcome to Debate.Me</h1>

      <div className="mt-4 p-4 border rounded">
        {email ? (
          <div className="space-x-3">
            <span>Signed in as <b>{email}</b></span>
            <button onClick={signOut} className="rounded bg-black text-white px-3 py-1">
              Sign out
            </button>
          </div>
        ) : (
          <a href="/login" className="inline-block rounded bg-black text-white px-3 py-1">
            Sign in
          </a>
        )}
      </div>
    </main>
  );
}
