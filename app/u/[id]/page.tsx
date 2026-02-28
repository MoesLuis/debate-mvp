"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type TakeRow = {
  id: string;
  playback_id: string | null;
  created_at: string;
  stance: string | null;
  parent_take_id: string | null;
  questions?: { question: string }[] | null;
};

function muxHlsUrl(playbackId: string) {
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

function normalizeQuestionsField(r: any): TakeRow {
  return {
    ...(r as TakeRow),
    questions: Array.isArray(r.questions) ? r.questions : r.questions ? [r.questions] : null,
  };
}

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const profileUserId = params?.id;

  const [viewerId, setViewerId] = useState<string | null>(null);

  const [handle, setHandle] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [takes, setTakes] = useState<TakeRow[]>([]);
  const [loadingTakes, setLoadingTakes] = useState(true);

  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const isSelf = useMemo(
    () => !!viewerId && !!profileUserId && viewerId === profileUserId,
    [viewerId, profileUserId]
  );

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setViewerId(user?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    if (!profileUserId) return;

    (async () => {
      setLoadingProfile(true);

      const { data, error } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", profileUserId)
        .maybeSingle();

      if (error) console.warn("profile load error", error);

      setHandle(data?.handle ?? null);
      setLoadingProfile(false);
    })();
  }, [profileUserId]);

  useEffect(() => {
    if (!profileUserId) return;

    (async () => {
      setLoadingTakes(true);

      const { data, error } = await supabase
        .from("takes")
        .select("id, playback_id, created_at, stance, parent_take_id, questions(question)")
        .eq("status", "ready")
        .eq("user_id", profileUserId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) {
        console.warn("takes load error", error);
        setTakes([]);
        setLoadingTakes(false);
        return;
      }

      setTakes(((data ?? []) as any[]).map(normalizeQuestionsField));
      setLoadingTakes(false);
    })();
  }, [profileUserId]);

  useEffect(() => {
    if (!viewerId || !profileUserId) return;
    if (viewerId === profileUserId) {
      setIsFollowing(false);
      return;
    }

    (async () => {
      const { data, error } = await supabase
        .from("user_follow_users")
        .select("following_id")
        .eq("follower_id", viewerId)
        .eq("following_id", profileUserId)
        .maybeSingle();

      if (error) {
        console.warn("follow status error", error);
        setIsFollowing(false);
        return;
      }

      setIsFollowing(!!data);
    })();
  }, [viewerId, profileUserId]);

  async function toggleFollow() {
    if (!viewerId) {
      alert("Please log in first.");
      return;
    }
    if (!profileUserId) return;
    if (viewerId === profileUserId) return;
    if (followBusy) return;

    setFollowBusy(true);
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from("user_follow_users")
          .delete()
          .eq("follower_id", viewerId)
          .eq("following_id", profileUserId);

        if (!error) setIsFollowing(false);
      } else {
        const { error } = await supabase.from("user_follow_users").insert({
          follower_id: viewerId,
          following_id: profileUserId,
        });

        if (!error) setIsFollowing(true);
      }
    } finally {
      setFollowBusy(false);
    }
  }

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.back()} className="text-sm underline opacity-80 hover:opacity-100">
            ← Back
          </button>

          <h1 className="mt-3 text-2xl font-bold">
            {loadingProfile ? "Loading…" : handle ? `@${handle}` : "User"}
          </h1>

          {profileUserId && (
            <div className="text-xs text-zinc-500 mt-1">
              {profileUserId.slice(0, 8)}…{profileUserId.slice(-6)}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {isSelf ? (
            <button
              onClick={() => router.push("/profile")}
              className="px-4 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-sm"
            >
              Edit my profile
            </button>
          ) : (
            <button
              onClick={toggleFollow}
              disabled={followBusy || !viewerId}
              className={`px-4 py-2 rounded text-sm border ${
                isFollowing ? "bg-black text-white border-black" : "bg-white border-zinc-300 hover:bg-zinc-50"
              } ${followBusy ? "opacity-60" : ""}`}
            >
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Takes</h2>

      {loadingTakes ? (
        <div className="mt-3 text-sm text-zinc-600">Loading takes…</div>
      ) : takes.length === 0 ? (
        <div className="mt-3 text-sm text-zinc-600">No takes yet.</div>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {takes.map((t) => {
            const questionText = t.questions?.[0]?.question ?? null;

            return (
              <div key={t.id} className="rounded-lg border border-zinc-300 bg-zinc-100 overflow-hidden">
                {/* Top meta line stays ABOVE the video (as you wanted) */}
                <div className="px-3 py-2 text-xs text-zinc-700 flex items-center justify-between">
                  <div>
                    {t.parent_take_id ? "Response" : "Root"} · {t.stance ?? "neutral"}
                  </div>
                  <div className="opacity-70">{new Date(t.created_at).toLocaleString()}</div>
                </div>

                {t.playback_id ? (
                  <video className="w-full aspect-video bg-black" controls playsInline src={muxHlsUrl(t.playback_id)} />
                ) : (
                  <div className="w-full aspect-video bg-black flex items-center justify-center text-white/80 text-sm">
                    No playback
                  </div>
                )}

                {/* Question goes BELOW the video */}
                {questionText && (
                  <div className="px-3 py-2 text-sm text-zinc-800 border-t border-zinc-200">
                    {questionText}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}