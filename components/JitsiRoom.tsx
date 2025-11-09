"use client";
import { useMemo } from "react";

export default function JitsiRoom({ room, name }: { room: string; name: string }) {
  const src = useMemo(() => {
    // Choose ONE base:
    // const base = `https://meet.jit.si/${encodeURIComponent(room)}`;
    const base = `https://8x8.vc/debateme/${encodeURIComponent(room)}`; // optional alternative

    const query = [
      "config.disableDeepLinking=true",    // keep users in the web app on mobile
      "config.prejoinConfig.enabled=true", // prejoin device check
      "config.startWithAudioMuted=true",
      "config.startWithVideoMuted=false",
      "interfaceConfig.TOOLBAR_ALWAYS_VISIBLE=true",
    ].join("&");

    const hash = `#userInfo.displayName=${encodeURIComponent(name || "Guest")}`;
    return `${base}?${query}${hash}`;
  }, [room, name]);

  // Use dynamic viewport height to avoid mobile toolbar cropping
  return (
    <div className="w-full" style={{ height: "calc(100dvh - 140px)" }}>
      <iframe
        title="Jitsi Room"
        src={src}
        className="w-full h-full rounded-xl border border-zinc-800"
        allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write; speaker-selection"
      />
    </div>
  );
}
