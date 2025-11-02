"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import JitsiRoom from "@/components/JitsiRoom";

export default function RoomPage({ params }: { params: { slug: string } }) {
  const roomName = params.slug;
  const [displayName, setDisplayName] = useState("Guest");

  useEffect(() => {
    async function loadName() {
      const { data: userData } = await supabase.auth.getUser();
      const u = userData.user;
      if (!u) {
        setDisplayName("Guest");
        return;
      }
      // prefer profile handle; else email; else Guest
      const { data: prof } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", u.id)
        .maybeSingle();
      setDisplayName(prof?.handle || u.email || "Guest");
    }
    loadName();
  }, []);

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Room: {roomName}</h1>
      <JitsiRoom roomName={roomName} displayName={displayName} />
    </main>
  );
}
