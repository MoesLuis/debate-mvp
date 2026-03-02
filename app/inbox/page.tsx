"use client";

import { useEffect, useMemo, useState } from "react";
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

  // new scheduling fields (added by Phase 8 scheduling SQL)
  scheduled_at?: string | null;
  scheduled_by?: string | null;
  availability_submitted_at?: string | null;

  // Supabase "questions(question)" join usually returns an array
  questions?: { question: string }[] | null;
};

type AvailabilityRow = {
  invite_id: string;
  slot_date: string; // YYYY-MM-DD
  time_block: "morning" | "afternoon" | "evening" | "night" | string;
};

const BLOCK_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

function formatScheduledAt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// MVP mapping from date + block to a concrete local time.
// (Later you can let them pick exact times.)
function scheduledAtFromSlot(slotDate: string, block: string) {
  const timeMap: Record<string, string> = {
    morning: "09:00:00",
    afternoon: "13:00:00",
    evening: "18:00:00",
    night: "21:00:00",
  };

  const t = timeMap[block] ?? "18:00:00";
  // This Date constructor interprets it in the user's local timezone.
  const d = new Date(`${slotDate}T${t}`);
  return d.toISOString();
}

export default function InboxPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [receivedInvites, setReceivedInvites] = useState<InviteRow[]>([]);
  const [sentInvites, setSentInvites] = useState<InviteRow[]>([]);

  const [handles, setHandles] = useState<Record<string, string>>({});
  const [topics, setTopics] = useState<Record<number, string>>({});

  // availability for SENT invites (sender views the invited person's slots)
  const [availabilityByInviteId, setAvailabilityByInviteId] = useState<Record<string, AvailabilityRow[]>>({});

  // UI state: which slot is selected for scheduling for each invite
  const [selectedSlotKey, setSelectedSlotKey] = useState<Record<string, string>>({});
  // key format: `${slot_date}|${time_block}`

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

  const allInvites = useMemo(() => [...receivedInvites, ...sentInvites], [receivedInvites, sentInvites]);

  async function preloadHandlesAndTopics(invites: InviteRow[]) {
    // preload handles
    const ids = Array.from(new Set(invites.flatMap((r) => [r.from_user_id, r.to_user_id]).filter(Boolean)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, handle").in("user_id", ids);

      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        map[p.user_id] = p.handle;
      });
      setHandles(map);
    }

    // preload topics
    const topicIds = Array.from(
      new Set(invites.map((r) => r.topic_id).filter((x): x is number => typeof x === "number"))
    );
    if (topicIds.length) {
      const { data: tops } = await supabase.from("topics").select("id, name").in("id", topicIds);

      const tmap: Record<number, string> = {};
      (tops ?? []).forEach((t: any) => {
        tmap[Number(t.id)] = t.name;
      });
      setTopics(tmap);
    }
  }

  async function loadAvailabilityForSent(invites: InviteRow[]) {
    // Only needed for invites where sender can schedule:
    // status = availability_submitted OR scheduled (to show slots if you want)
    const ids = invites
      .filter((i) => i.status === "availability_submitted" || i.status === "scheduled")
      .map((i) => i.id);

    if (!ids.length) {
      setAvailabilityByInviteId({});
      return;
    }

    // If table/RLS not created yet, this will error; we just skip gracefully.
    const { data, error } = await supabase
      .from("live_debate_invite_availability")
      .select("invite_id, slot_date, time_block")
      .in("invite_id", ids);

    if (error) {
      console.warn("loadAvailabilityForSent error", error);
      setAvailabilityByInviteId({});
      return;
    }

    const grouped: Record<string, AvailabilityRow[]> = {};
    (data ?? []).forEach((r: any) => {
      const invId = String(r.invite_id);
      if (!grouped[invId]) grouped[invId] = [];
      grouped[invId].push({
        invite_id: invId,
        slot_date: String(r.slot_date),
        time_block: String(r.time_block),
      });
    });

    // stable ordering for nicer UI
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => {
        const da = a.slot_date.localeCompare(b.slot_date);
        if (da !== 0) return da;
        return String(a.time_block).localeCompare(String(b.time_block));
      });
    }

    setAvailabilityByInviteId(grouped);
  }

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

    // RECEIVED
    const receivedRes = await supabase
      .from("live_debate_invites")
      .select(
        "id, created_at, from_user_id, to_user_id, topic_id, take_id, question_id, creator_stance, challenger_stance, status, room_slug, responded_at, scheduled_at, scheduled_by, availability_submitted_at, questions(question)"
      )
      .eq("to_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (receivedRes.error) {
      setMsg(receivedRes.error.message || "Failed to load received invites.");
      setReceivedInvites([]);
      setSentInvites([]);
      setLoading(false);
      return;
    }

    // SENT
    const sentRes = await supabase
      .from("live_debate_invites")
      .select(
        "id, created_at, from_user_id, to_user_id, topic_id, take_id, question_id, creator_stance, challenger_stance, status, room_slug, responded_at, scheduled_at, scheduled_by, availability_submitted_at, questions(question)"
      )
      .eq("from_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (sentRes.error) {
      setMsg(sentRes.error.message || "Failed to load sent invites.");
      setReceivedInvites([]);
      setSentInvites([]);
      setLoading(false);
      return;
    }

    const normalize = (data: any[] | null) =>
      ((data ?? []) as unknown as InviteRow[]).map((r) => ({
        ...r,
        questions: Array.isArray((r as any).questions)
          ? (r as any).questions
          : (r as any).questions
            ? [(r as any).questions]
            : null,
      }));

    const receivedRows = normalize(receivedRes.data as any);
    const sentRows = normalize(sentRes.data as any);

    setReceivedInvites(receivedRows);
    setSentInvites(sentRows);

    await preloadHandlesAndTopics([...receivedRows, ...sentRows]);
    await loadAvailabilityForSent(sentRows);

    setLoading(false);
  }

  useEffect(() => {
    if (!userId) return;
    load();

    // realtime refresh: listen to both received + sent changes
    const chReceived = supabase
      .channel(`invites-received-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_debate_invites", filter: `to_user_id=eq.${userId}` },
        () => load()
      )
      .subscribe();

    const chSent = supabase
      .channel(`invites-sent-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_debate_invites", filter: `from_user_id=eq.${userId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chReceived);
      supabase.removeChannel(chSent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function decline(inviteId: string) {
    setBusyId(inviteId);
    setMsg(null);

    const { error } = await supabase
      .from("live_debate_invites")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", inviteId)
      .in("status", ["pending", "availability_submitted"]);

    if (error) {
      setMsg(error.message || "Could not decline invite.");
      setBusyId(null);
      return;
    }

    await load();
    setBusyId(null);
  }

  async function scheduleInvite(inviteId: string) {
    setBusyId(inviteId);
    setMsg(null);

    const picked = selectedSlotKey[inviteId];
    if (!picked) {
      setMsg("Pick a time slot first.");
      setBusyId(null);
      return;
    }

    const [slotDate, timeBlock] = picked.split("|");
    const scheduledAtISO = scheduledAtFromSlot(slotDate, timeBlock);

    const ok = window.confirm(
      `Schedule this debate for ${formatScheduledAt(scheduledAtISO)}?\n\n(You can refine exact times later.)`
    );
    if (!ok) {
      setBusyId(null);
      return;
    }

    const { data, error } = await supabase.rpc("schedule_live_invite", {
      p_invite_id: inviteId,
      p_scheduled_at: scheduledAtISO,
    });

    if (error) {
      setMsg(error.message || "Could not schedule debate.");
      setBusyId(null);
      return;
    }

    const roomSlug = (data?.[0]?.room_slug ?? null) as string | null;

    await load();
    setBusyId(null);

    if (roomSlug) {
      // optional: take scheduler straight to room page
      // router.push(`/room/${roomSlug}`);
    }
  }

  function renderInviteCard(inv: InviteRow, mode: "received" | "sent") {
    const questionText = inv.questions?.[0]?.question ?? null;
    const topicName = inv.topic_id != null ? topics[inv.topic_id] ?? `Topic ${inv.topic_id}` : "Topic";

    const fromHandle = handles[inv.from_user_id] ? `@${handles[inv.from_user_id]}` : inv.from_user_id.slice(0, 8) + "…";
    const toHandle = handles[inv.to_user_id] ? `@${handles[inv.to_user_id]}` : inv.to_user_id.slice(0, 8) + "…";

    const isPending = inv.status === "pending";
    const isAvail = inv.status === "availability_submitted";
    const isScheduled = inv.status === "scheduled";
    const isDeclined = inv.status === "declined";

    // stance labels depend on viewer:
    // - receiver is the creator of the take
    // - sender is challenger
    const receiverYourStance = inv.creator_stance ?? "neutral";
    const receiverChallengerStance = inv.challenger_stance ?? "unspecified";

    const senderYourStance = inv.challenger_stance ?? "unspecified";
    const senderTheirStance = inv.creator_stance ?? "neutral";

    const scheduledAt = inv.scheduled_at ?? null;

    return (
      <div key={inv.id} className="rounded-lg border border-zinc-300 bg-zinc-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {mode === "received" ? (
              <div className="text-sm">
                <span className="font-semibold">{fromHandle}</span> challenged you to a live debate
              </div>
            ) : (
              <div className="text-sm">
                You challenged <span className="font-semibold">{toHandle}</span>
              </div>
            )}

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
              {mode === "received" ? (
                <>
                  Your stance: <span className="font-medium">{receiverYourStance}</span> • Challenger stance:{" "}
                  <span className="font-medium">{receiverChallengerStance}</span>
                </>
              ) : (
                <>
                  Your stance: <span className="font-medium">{senderYourStance}</span> • Their stance:{" "}
                  <span className="font-medium">{senderTheirStance}</span>
                </>
              )}
            </div>

            {isScheduled && scheduledAt && (
              <div className="text-xs text-zinc-700 mt-2">
                Scheduled for: <span className="font-semibold">{formatScheduledAt(scheduledAt)}</span>
              </div>
            )}

            <div className="text-[11px] text-zinc-500 mt-2">
              {new Date(inv.created_at).toLocaleString()} • Status: {inv.status}
            </div>

            {/* Sender view: show availability slots when submitted */}
            {mode === "sent" && isAvail && (
              <div className="mt-3 rounded border border-zinc-200 bg-white p-3">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Their proposed times</div>

                {availabilityByInviteId[inv.id]?.length ? (
                  <>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {availabilityByInviteId[inv.id].map((s) => {
                        const key = `${s.slot_date}|${s.time_block}`;
                        const on = selectedSlotKey[inv.id] === key;
                        const label = `${s.slot_date} • ${BLOCK_LABEL[s.time_block] ?? s.time_block}`;
                        return (
                          <button
                            key={key}
                            onClick={() =>
                              setSelectedSlotKey((prev) => ({
                                ...prev,
                                [inv.id]: key,
                              }))
                            }
                            className={`rounded border px-3 py-2 text-left text-sm transition ${
                              on ? "bg-black text-white border-black" : "bg-zinc-50 border-zinc-300 hover:bg-zinc-100"
                            }`}
                            disabled={busyId === inv.id}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 text-xs text-zinc-500">
                      When you schedule, we’ll pick a concrete start time (Morning=9am, Afternoon=1pm, Evening=6pm, Night=9pm).
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-sm text-zinc-600">Loading slots… (or none found)</div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 items-end">
            {mode === "received" && (isPending || isAvail) ? (
              <>
                <button
                  onClick={() => router.push(`/inbox/invite/${inv.id}`)}
                  disabled={busyId === inv.id}
                  className="px-3 py-2 rounded bg-black text-white hover:opacity-90 text-sm disabled:opacity-60"
                >
                  Propose times
                </button>
                <button
                  onClick={() => decline(inv.id)}
                  disabled={busyId === inv.id}
                  className="px-3 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-sm disabled:opacity-60"
                >
                  Decline
                </button>
              </>
            ) : null}

            {mode === "sent" && isAvail ? (
              <button
                onClick={() => scheduleInvite(inv.id)}
                disabled={busyId === inv.id}
                className="px-3 py-2 rounded bg-black text-white hover:opacity-90 text-sm disabled:opacity-60"
              >
                Schedule
              </button>
            ) : null}

            {isScheduled && inv.room_slug ? (
              <button
                onClick={() => router.push(`/?joinRoom=${inv.room_slug}`)}
                className="px-3 py-2 rounded bg-zinc-900 text-white hover:opacity-90 text-sm"
              >
                Open room
              </button>
            ) : null}

            {mode === "sent" && isPending ? (
              <div className="text-xs text-zinc-500 text-right max-w-[170px]">
                Waiting for them to submit availability…
              </div>
            ) : null}

            {isDeclined ? (
              <div className="text-xs text-zinc-500 text-right">Declined</div>
            ) : null}
          </div>
        </div>
      </div>
    );
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
        <div className="mt-6 text-sm text-zinc-600">Loading…</div>
      ) : (
        <>
          {/* RECEIVED */}
          <div className="mt-6">
            <h2 className="text-lg font-semibold">Received</h2>
            <p className="text-sm text-zinc-600 mt-1">Invites sent to you</p>

            {receivedInvites.length === 0 ? (
              <div className="mt-3 text-sm text-zinc-600">No received invites yet.</div>
            ) : (
              <div className="mt-3 space-y-3">
                {receivedInvites.map((inv) => renderInviteCard(inv, "received"))}
              </div>
            )}
          </div>

          {/* SENT */}
          <div className="mt-10">
            <h2 className="text-lg font-semibold">Sent</h2>
            <p className="text-sm text-zinc-600 mt-1">Invites you sent to others</p>

            {sentInvites.length === 0 ? (
              <div className="mt-3 text-sm text-zinc-600">No sent invites yet.</div>
            ) : (
              <div className="mt-3 space-y-3">{sentInvites.map((inv) => renderInviteCard(inv, "sent"))}</div>
            )}
          </div>
        </>
      )}
    </main>
  );
}