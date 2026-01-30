"use client";

import { usePathname } from "next/navigation";

export default function SiteHeader() {
  const pathname = usePathname();
  const inRoom = pathname?.startsWith("/room/");

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        {/* Debate.Me title: NOT clickable inside a room */}
        {inRoom ? (
          <span className="font-semibold text-[var(--text)] cursor-default select-none">
            Debate.Me
          </span>
        ) : (
          <a
            href="/"
            className="font-semibold text-[var(--text)] hover:text-[var(--brand)]"
            aria-label="Go to Debate.Me home"
          >
            Debate.Me
          </a>
        )}

        {/* Optional: disable nav inside room too (prevents escaping mid-debate) */}
        <nav className="text-sm space-x-4" aria-label="Main navigation">
          {inRoom ? (
            <>
              <span className="text-zinc-600 cursor-not-allowed select-none">
                Profile
              </span>
              <span className="text-zinc-600 cursor-not-allowed select-none">
                Room
              </span>
            </>
          ) : (
            <>
              <a
                className="text-zinc-300 hover:text-white"
                href="/profile"
                aria-label="Profile"
              >
                Profile
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
