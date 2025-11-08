"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";   // ⟵ add this
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();                   // ⟵ add this
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // NOTE: no emailRedirectTo => Supabase sends a 6-digit code instead of a magic link
      options: { shouldCreateUser: true },
    });
    if (error) setMsg(error.message);
    else setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error) setMsg(error.message);
    else 
      setMsg("✅ Signed in!");
      router.replace("/");      // ⟵ go to home
      router.refresh();         // ⟵ ensures UI picks up the new session
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">Sign in</h1>

        {!sent ? (
          <form onSubmit={sendCode} className="space-y-3">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded p-2"
              required
            />
            <button className="w-full rounded bg-black text-white py-2">
              Send code
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <input
              inputMode="numeric"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border rounded p-2"
              maxLength={10}
              required
            />
            <button className="w-full rounded bg-black text-white py-2">
              Verify & Sign in
            </button>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="w-full rounded border py-2"
            >
              Back
            </button>
          </form>
        )}

        {msg && <p className="text-center text-sm">{msg}</p>}
      </div>
    </main>
  );
}
