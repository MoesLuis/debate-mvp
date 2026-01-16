"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import JitsiRoom from "@/components/JitsiRoom";

export default function RoomPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const [name, setName] = useState<string>("");

  const room = typeof slug === "string" ? slug : "deb-test-123";

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      // load saved handle for display name
      const { data } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", user.id)
        .maybeSingle();

      setName(data?.handle || user.email || "Guest");
    })();
  }, [router]);

  // 🔥 HEARTBEAT: ping server while user is in the room
  useEffect(() => {
    let intervalId: number | null = null;
    let cancelled = false;

    async function sendHeartbeat() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;

        await fetch("/api/heartbeat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roomSlug: room }),
          // helps when navigating away (best effort)
          keepalive: true,
        });
      } catch {
        // ignore heartbeat errors (network hiccups etc.)
      }
    }

    // fire immediately + then every 15s
    sendHeartbeat();
    intervalId = window.setInterval(() => {
      if (!cancelled) sendHeartbeat();
    }, 15000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [room]);

  if (!name) {
    return <p className="text-sm text-zinc-400">Loading room…</p>;
  }

  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold mb-3">Room: {room}</h1>
      <JitsiRoom room={room} name={name} />
      <p className="text-sm text-zinc-500 mt-2">
        Tip: open this URL in another browser/device to simulate the second participant.
      </p>
    </main>
  );
}
