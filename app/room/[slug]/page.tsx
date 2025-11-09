"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import JitsiRoom from "@/components/JitsiRoom";

export default function RoomPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const [name, setName] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
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

  const room = typeof slug === "string" ? slug : "deb-test-123";

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
