"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SiteHeader() {
  const pathname = usePathname();

  const inRoom = pathname?.startsWith("/room/");
  const inTakes = pathname?.startsWith("/takes");
  const inLive = !inTakes; // default mode

  const [sr, setSr] = useState<number | null>(null);
  const [cr, setCr] = useState<number | null>(null);

  useEffect(() => {
    if (inRoom) return;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("skill_rating, collab_rating")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        setSr(data.skill_rating);
        setCr(data.collab_rating);
      }
    })();
  }, [inRoom]);

  const headerClass = useMemo(() => {
    if (inRoom) return "bg-zinc-950/80 border-zinc-800";
    if (inTakes) return "bg-zinc-200/80 border-zinc-300 text-zinc-900";
    return "bg-zinc-950/80 border-zinc-800 text-zinc-100";
  }, [inRoom, inTakes]);

  const linkHover = inTakes ? "hover:text-black" : "hover:text-[var(--brand)]";

  return (
    <header
      className={`sticky top-0 z-50 border-b backdrop-blur ${headerClass}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        {/* Left: Brand (not clickable in room) */}
        {inRoom ? (
          <span className="font-semibold cursor-default select-none">
            Debate.Me
          </span>
        ) : (
          <a href="/" className={`font-semibold ${linkHover}`}>
            Debate.Me
          </a>
        )}

        {/* Center: Mode switch */}
        {!inRoom && (
          <div className="flex items-center gap-3 text-sm">
            <a
              href="/"
              className={`px-3 py-1 rounded ${
                inLive
                  ? inTakes
                    ? "bg-black text-white"
                    : "bg-zinc-900 text-white"
                  : inTakes
                  ? "text-zinc-700 hover:text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
              aria-label="Live Debates"
            >
              Live Debates
            </a>

            <span className={inTakes ? "text-zinc-500" : "text-zinc-600"}>
              |
            </span>

            <a
              href="/takes"
              className={`px-3 py-1 rounded ${
                inTakes
                  ? "bg-white text-zinc-900 border border-zinc-300"
                  : "text-zinc-400 hover:text-white"
              }`}
              aria-label="Takes Feed"
            >
              Takes Feed
            </a>
          </div>
        )}

        {/* Right: SR/CR + Profile */}
        <nav className="text-sm flex items-center gap-4">
          {!inRoom && sr !== null && cr !== null && (
            <span className={inTakes ? "text-zinc-700" : "text-zinc-400"}>
              SR <strong className={inTakes ? "text-zinc-900" : ""}>{sr}</strong>{" "}
              · CR{" "}
              <strong className={inTakes ? "text-zinc-900" : ""}>{cr}</strong>
            </span>
          )}

          {inRoom ? (
            <span className="text-zinc-600 cursor-not-allowed select-none">
              Profile
            </span>
          ) : (
            <a
              className={inTakes ? "text-zinc-800 hover:text-black" : "text-zinc-300 hover:text-white"}
              href="/profile"
              aria-label="Profile"
            >
              Profile
            </a>
          )}
        </nav>
      </div>

      {/* Takes Feed sub-tabs header line (only on /takes) */}
      {!inRoom && inTakes && (
        <div className="mx-auto max-w-6xl px-4 pb-2">
          <div className="flex items-center gap-8 text-sm">
            <a
              href="/takes?tab=following"
              className="relative pb-2"
            >
              <span className="text-zinc-900 font-medium">Following</span>
              <span className="absolute left-0 right-0 -bottom-[2px] h-[2px] bg-black" />
            </a>

            <a
              href="/takes?tab=explore"
              className="relative pb-2 text-zinc-600 hover:text-zinc-900"
            >
              Explore
            </a>
          </div>
        </div>
      )}
    </header>
  );
}