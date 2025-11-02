"use client";
import { useEffect, useRef } from "react";

type Props = {
  roomName: string;
  displayName: string;
};

declare global {
  interface Window { JitsiMeetExternalAPI: any }
}

export default function JitsiRoom({ roomName, displayName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://meet.jit.si/external_api.js";
    script.async = true;
    script.onload = () => {
      const domain = "meet.jit.si"; // free hosted Jitsi
      const api = new window.JitsiMeetExternalAPI(domain, {
        parentNode: containerRef.current!,
        roomName,
        userInfo: { displayName },
        configOverwrite: {
          startWithAudioMuted: true,
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
        },
      });
      // Cleanup when leaving page
      return () => api.dispose?.();
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, [roomName, displayName]);

  return <div ref={containerRef} style={{ height: "80vh", width: "100%" }} />;
}
