"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SiteHeader() {
  const pathname = usePathname();
  const inRoom = pathname?.startsWith("/room/");

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

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        {/* Debate.Me title */}
        {inRoom ? (
          <span className="font-semibold cursor-default select-none">
            Debate.Me
          </span>
        ) : (
          <a
            href="/"
            className="font-semibold hover:text-[var(--brand)]"
            aria-label="Go to Debate.Me home"
          >
            Debate.Me
          </a>
        )}

        <nav className="text-sm flex items-center gap-4">
          {!inRoom && sr !== null && cr !== null && (
            <span className="text-zinc-400">
              SR <strong>{sr}</strong> · CR <strong>{cr}</strong>
            </span>
          )}

          {inRoom ? (
            <span className="text-zinc-600 cursor-not-allowed select-none">
              Profile
            </span>
          ) : (
            <a
              className="text-zinc-300 hover:text-white"
              href="/profile"
              aria-label="Profile"
            >
              Profile
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
