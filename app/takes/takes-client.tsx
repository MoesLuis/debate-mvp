"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

export default function TakesClient() {
  const params = useSearchParams();
  const tab = params.get("tab") || "following";
  const isFollowing = useMemo(() => tab !== "explore", [tab]);

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      {/* Topic ribbon placeholder */}
      <div className="flex items-center gap-3 overflow-x-auto pb-3">
        <button className="px-4 py-2 rounded-full border border-zinc-400 bg-zinc-300 text-sm">
          Topics
        </button>

        {/* Placeholders; Phase 2 will render user-selected topics */}
        <button className="px-4 py-2 rounded-full border border-zinc-400 bg-zinc-100 text-sm">
          AI Ethics
        </button>
        <button className="px-4 py-2 rounded-full border border-zinc-400 bg-zinc-100 text-sm">
          Economics
        </button>
        <button className="px-4 py-2 rounded-full border border-zinc-400 bg-zinc-100 text-sm">
          Philosophy
        </button>
      </div>

      {/* Feed area placeholder */}
      <div className="mt-6 flex items-center justify-center h-[70vh] rounded-lg border border-zinc-300 bg-zinc-100">
        <div className="text-center">
          <div className="text-4xl font-semibold mb-2">Video</div>
          <p className="text-sm text-zinc-600">
            {isFollowing ? "Following feed (80/20 later)" : "Explore feed"}
          </p>
        </div>
      </div>

      {/* Right-side action rail placeholder */}
      <div className="fixed right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3">
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Topic
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Profile
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Against
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          👍
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Challenge
        </button>
        <button className="w-14 h-14 rounded border border-zinc-400 bg-zinc-100 text-xs">
          In favor
        </button>
        <button className="w-20 h-20 rounded border border-zinc-400 bg-zinc-100 text-xs">
          Record
          <br />
          take
        </button>
      </div>
    </div>
  );
}