"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type InviteRow = {
  id: string;
  created_at: string;
  from_user_id: string;
  to_user_id: string;
  topic_id: number | null;
  take_id: string | null;
  question_id: number | null;

  creator_stance: string | null;
  challenger_stance: string | null;

  status: string;
  room_slug: string | null;
  responded_at: string | null;

  // Supabase "questions(question)" join usually returns an array
  questions?: { question: string }[] | null;
};

export default function InboxPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [topics, setTopics] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
    })();
  }, [router]);

  async function load() {
    setMsg(null);
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("live_debate_invites")
      .select(
        "id, created_at, from_user_id, to_user_id, topic_id, take_id, question_id, creator_stance, challenger_stance, status, room_slug, responded_at, questions(question)"
      )
      .eq("to_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setMsg(error.message || "Failed to load invites.");
      setInvites([]);
      setLoading(false);
      return;
    }

    // Supabase join typing can be weird; normalize safely
    const rows = ((data ?? []) as unknown as InviteRow[]).map((r) => ({
      ...r,
      questions: Array.isArray((r as any).questions) ? (r as any).questions : (r as any).questions ? [(r as any).questions] : null,
    }));

    setInvites(rows);

    // preload handles for senders
    const senderIds = Array.from(new Set(rows.map((r) => r.from_user_id)));
    if (senderIds.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, handle").in("user_id", senderIds);

      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        map[p.user_id] = p.handle;
      });
      setHandles(map);
    }

    // preload topics
    const topicIds = Array.from(new Set(rows.map((r) => r.topic_id).filter((x): x is number => typeof x === "number")));
    if (topicIds.length) {
      const { data: tops } = await supabase.from("topics").select("id, name").in("id", topicIds);

      const tmap: Record<number, string> = {};
      (tops ?? []).forEach((t: any) => {
        tmap[Number(t.id)] = t.name;
      });
      setTopics(tmap);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    load();

    const ch = supabase
      .channel(`invites-to-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_debate_invites", filter: `to_user_id=eq.${userId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function accept(inviteId: string) {
    setBusyId(inviteId);
    setMsg(null);

    const ok = window.confirm("Accept this live debate invite? You will enter a room.");
    if (!ok) {
      setBusyId(null);
      return;
    }

    const { data, error } = await supabase.rpc("accept_live_invite", { p_invite_id: inviteId });

    if (error) {
      setMsg(error.message || "Could not accept invite.");
      setBusyId(null);
      return;
    }

    const roomSlug = (data?.[0]?.room_slug ?? null) as string | null;
    if (!roomSlug) {
      setMsg("Accepted, but no room returned.");
      setBusyId(null);
      return;
    }

    router.push(`/room/${roomSlug}`);
  }

  async function decline(inviteId: string) {
    setBusyId(inviteId);
    setMsg(null);

    const { error } = await supabase
      .from("live_debate_invites")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", inviteId)
      .eq("status", "pending");

    if (error) {
      setMsg(error.message || "Could not decline invite.");
      setBusyId(null);
      return;
    }

    await load();
    setBusyId(null);
  }

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.back()} className="text-sm underline opacity-80 hover:opacity-100">
            ← Back
          </button>
          <h1 className="mt-3 text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-zinc-600 mt-1">Live debate invitations</p>
        </div>

        <button
          onClick={load}
          className="px-4 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-sm"
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {msg && <div className="mt-4 rounded border border-zinc-300 bg-white p-3 text-sm">{msg}</div>}

      {loading ? (
        <div className="mt-6 text-sm text-zinc-600">Loading invites…</div>
      ) : invites.length === 0 ? (
        <div className="mt-6 text-sm text-zinc-600">No invites yet.</div>
      ) : (
        <div className="mt-6 space-y-3">
          {invites.map((inv) => {
            const fromHandle = handles[inv.from_user_id]
              ? `@${handles[inv.from_user_id]}`
              : inv.from_user_id.slice(0, 8) + "…";
            const topicName = inv.topic_id != null ? topics[inv.topic_id] ?? `Topic ${inv.topic_id}` : "Topic";
            const pending = inv.status === "pending";

            const questionText = inv.questions?.[0]?.question ?? null;

            // ✅ Fixed stance labeling for recipient
            const yourStance = inv.creator_stance ?? "neutral";
            const challenger = inv.challenger_stance ?? "unspecified";

            return (
              <div key={inv.id} className="rounded-lg border border-zinc-300 bg-zinc-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">
                      <span className="font-semibold">{fromHandle}</span> challenged you to a live debate
                    </div>

                    <div className="text-xs text-zinc-600 mt-1">
                      Topic: <span className="font-medium">{topicName}</span>
                    </div>

                    {questionText && (
                      <div className="mt-2 rounded border border-zinc-200 bg-white p-2 text-sm text-zinc-800">
                        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Question</div>
                        <div className="mt-1">{questionText}</div>
                      </div>
                    )}

                    <div className="text-xs text-zinc-600 mt-2">
                      Your stance: <span className="font-medium">{yourStance}</span> • Challenger stance:{" "}
                      <span className="font-medium">{challenger}</span>
                    </div>

                    <div className="text-[11px] text-zinc-500 mt-2">
                      {new Date(inv.created_at).toLocaleString()} • Status: {inv.status}
                    </div>
                  </div>

                  {pending ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => decline(inv.id)}
                        disabled={busyId === inv.id}
                        className="px-3 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-sm disabled:opacity-60"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => accept(inv.id)}
                        disabled={busyId === inv.id}
                        className="px-3 py-2 rounded bg-black text-white hover:opacity-90 text-sm disabled:opacity-60"
                      >
                        Accept
                      </button>
                    </div>
                  ) : inv.room_slug ? (
                    <button
                      onClick={() => router.push(`/room/${inv.room_slug}`)}
                      className="px-3 py-2 rounded bg-zinc-900 text-white hover:opacity-90 text-sm"
                    >
                      Open room
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}