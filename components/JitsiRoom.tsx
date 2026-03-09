"use client";

import { useEffect, useState } from "react";
import {
  ConnectionStateToast,
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { supabase } from "@/lib/supabase";

function DebateStage() {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-400">
        <span>Live debate</span>
        <span>Inside Debate.Me</span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
        <GridLayout tracks={tracks} className="h-full">
          <ParticipantTile />
        </GridLayout>
      </div>

      <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/90 p-2">
        <ControlBar
          variation="minimal"
          controls={{
            microphone: true,
            camera: true,
            screenShare: false,
            chat: false,
            leave: false,
          }}
        />
      </div>

      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}

export default function JitsiRoom({
  room,
  name,
}: {
  room: string;
  name: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadToken() {
      setError(null);
      setToken(null);
      setServerUrl(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        if (!cancelled) setError("Not authenticated.");
        return;
      }

      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomSlug: room, name }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (!cancelled) {
          setError(body?.error || "Could not connect to the debate room.");
        }
        return;
      }

      if (!cancelled) {
        setToken(body?.token ?? null);
        setServerUrl(body?.url ?? null);
      }
    }

    loadToken();

    return () => {
      cancelled = true;
    };
  }, [room, name]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-red-800 bg-red-900/20 px-4 text-sm text-red-200"
        style={{ height: "calc(100dvh - 140px)" }}
      >
        {error}
      </div>
    );
  }

  if (!token || !serverUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 text-sm text-zinc-400"
        style={{ height: "calc(100dvh - 140px)" }}
      >
        Joining room…
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height: "calc(100dvh - 140px)" }}>
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        audio={true}
        video={true}
        data-lk-theme="default"
        className="h-full"
      >
        <DebateStage />
      </LiveKitRoom>
    </div>
  );
}