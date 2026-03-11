"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

export default function SiteHeader() {
  const pathname = usePathname();

  const inRoom = pathname?.startsWith("/room/");
  const inTakes = pathname?.startsWith("/takes");
  const inLive = !inTakes;

  const [takesTab, setTakesTab] = useState<"following" | "explore">("following");

  useEffect(() => {
    if (!inTakes) return;

    const readTab = () => {
      const sp = new URLSearchParams(window.location.search);
      const tab = sp.get("tab");
      setTakesTab(tab === "explore" ? "explore" : "following");
    };

    readTab();
    window.addEventListener("popstate", readTab);

    return () => window.removeEventListener("popstate", readTab);
  }, [inTakes]);

  const headerClass = useMemo(() => {
    if (inRoom) return "bg-zinc-950/80 border-zinc-800 text-zinc-100";
    if (inTakes) return "bg-black/82 border-white/10 text-white";
    return "bg-zinc-950/80 border-zinc-800 text-zinc-100";
  }, [inRoom, inTakes]);

  const brandClass = inTakes ? "text-white hover:text-white/85" : "hover:text-[var(--brand)]";

  const liveLinkClass = inTakes
    ? `px-2.5 sm:px-3 py-1 rounded-full transition ${
        inLive ? "bg-white text-black" : "text-white/75 hover:text-white"
      }`
    : `px-3 py-1 rounded ${inLive ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-white"}`;

  const takesLinkClass = inTakes
    ? `px-2.5 sm:px-3 py-1 rounded-full transition ${
        inTakes ? "bg-white/14 text-white border border-white/10" : "text-white/75 hover:text-white"
      }`
    : `px-3 py-1 rounded ${inTakes ? "bg-white text-zinc-900 border border-zinc-300" : "text-zinc-400 hover:text-white"}`;

  return (
    <header className={`sticky top-0 z-50 border-b backdrop-blur-md ${headerClass}`}>
      <div className="mx-auto max-w-6xl px-3 sm:px-4 py-3">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <div className="justify-self-start min-w-0">
            {inRoom ? (
              <span className="font-semibold cursor-default select-none whitespace-nowrap">
                Debate.Me
              </span>
            ) : (
              <a href="/" className={`font-semibold whitespace-nowrap ${brandClass}`}>
                Debate.Me
              </a>
            )}
          </div>

          {!inRoom && (
            <div className="justify-self-center min-w-0">
              <div className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <a href="/" className={liveLinkClass} aria-label="Live Debates">
                  Live Debates
                </a>

                <span className={inTakes ? "text-white/25" : "text-zinc-600"}>|</span>

                <a href="/takes" className={takesLinkClass} aria-label="Takes Feed">
                  Takes Feed
                </a>
              </div>
            </div>
          )}

          <nav className="justify-self-end min-w-0">
            {inRoom ? (
              <span className="text-zinc-600 cursor-not-allowed select-none text-sm">
                Profile
              </span>
            ) : (
              <a
                className={
                  inTakes
                    ? "text-white/85 hover:text-white text-sm"
                    : "text-zinc-300 hover:text-white text-sm"
                }
                href="/profile"
                aria-label="Profile"
              >
                Profile
              </a>
            )}
          </nav>
        </div>
      </div>

      {!inRoom && inTakes && (
        <div className="mx-auto max-w-6xl px-3 sm:px-4 pb-2">
          <div className="flex items-center justify-center gap-6 sm:gap-8 text-sm">
            <a href="/takes?tab=following" className="relative pb-1.5 px-1">
              <span
                className={
                  takesTab === "following"
                    ? "text-white font-medium"
                    : "text-white/60 hover:text-white/85"
                }
              >
                Following
              </span>
              {takesTab === "following" && (
                <span className="absolute left-0 right-0 -bottom-[2px] h-[2px] bg-white rounded-full" />
              )}
            </a>

            <a href="/takes?tab=explore" className="relative pb-1.5 px-1">
              <span
                className={
                  takesTab === "explore"
                    ? "text-white font-medium"
                    : "text-white/60 hover:text-white/85"
                }
              >
                Explore
              </span>
              {takesTab === "explore" && (
                <span className="absolute left-0 right-0 -bottom-[2px] h-[2px] bg-white rounded-full" />
              )}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}