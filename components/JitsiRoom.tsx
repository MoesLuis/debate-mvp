"use client";
import { useMemo } from "react";

export default function JitsiRoom({ room, name }: { room: string; name: string }) {
  // Pass your display name to Jitsi via URL hash params
  const src = useMemo(() => {
    const base = `https://meet.jit.si/${encodeURIComponent(room)}`;
    const hash = `#userInfo.displayName=${encodeURIComponent(name || "Guest")}`;
    return base + hash;
  }, [room, name]);

  return (
    <iframe
      title="Jitsi Room"
      src={src}
      style={{ width: "100%", height: "80vh", border: 0, borderRadius: 12 }}
      allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write; speaker-selection"
    />
  );
}
