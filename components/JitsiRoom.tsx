"use client";
import { useMemo } from "react";

export default function JitsiRoom({ room, name }: { room: string; name: string }) {
  const src = useMemo(() => {
    const base = `https://8x8.vc/debateme/${encodeURIComponent(room)}`;
    // Useful lightweight flags for public meet.jit.si
    const query = [
      "config.disableDeepLinking=true",           // don’t push to native mobile app
      "config.prejoinConfig.enabled=true",        // show prejoin (device check)
      "config.startWithAudioMuted=true",
      "config.startWithVideoMuted=false",
      "interfaceConfig.TOOLBAR_ALWAYS_VISIBLE=true",
    ].join("&");

    const hash = `#userInfo.displayName=${encodeURIComponent(name || "Guest")}`;
    return `${base}?${query}${hash}`;
  }, [room, name]);

  return (
    <div className="w-full" style={{ height: "calc(100dvh - 140px)" }}>
      <iframe
        title="Jitsi Room"
        src={src}
        className="w-full h-full rounded-xl border border-zinc-800 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
        allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write; speaker-selection"
      />
    </div>
  );
}
