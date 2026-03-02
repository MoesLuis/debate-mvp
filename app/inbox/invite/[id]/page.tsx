"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Block = "morning" | "afternoon" | "evening" | "night";
const BLOCKS: { key: Block; label: string; hours: string }[] = [
  { key: "morning", label: "Morning", hours: "8am–12pm" },
  { key: "afternoon", label: "Afternoon", hours: "12pm–5pm" },
  { key: "evening", label: "Evening", hours: "5pm–9pm" },
  { key: "night", label: "Night", hours: "9pm–12am" },
];

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export default function InviteAvailabilityPage() {
  const router = useRouter();
  const params = useParams();
  const inviteId = String(params.id || "");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [topicName, setTopicName] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState<string | null>(null);
  const [fromHandle, setFromHandle] = useState<string | null>(null);

  // selections: key = `${date}|${block}`
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const next14Days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      // Load invite context: topic, question, sender handle
      const { data: inv, error: invErr } = await supabase
        .from("live_debate_invites")
        .select("id, from_user_id, to_user_id, topic_id, question_id, status, topics(name), questions(question)")
        .eq("id", inviteId)
        .maybeSingle();

      if (invErr || !inv) {
        setMsg(invErr?.message || "Invite not found.");
        setLoading(false);
        return;
      }

      if (inv.to_user_id !== auth.user.id) {
        setMsg("Not allowed.");
        setLoading(false);
        return;
      }

      setTopicName((inv as any)?.topics?.name ?? null);
      const q = Array.isArray((inv as any)?.questions) ? (inv as any).questions[0]?.question : (inv as any)?.questions?.question;
      setQuestionText(q ?? null);

      // sender handle
      const { data: prof } = await supabase
        .from("profiles")
        .select("handle")
        .eq("user_id", inv.from_user_id)
        .maybeSingle();
      setFromHandle(prof?.handle ?? null);

      // Load existing availability (if re-submitting)
      const { data: slots } = await supabase
        .from("live_debate_invite_availability")
        .select("slot_date, time_block")
        .eq("invite_id", inviteId)
        .eq("user_id", auth.user.id);

      const s = new Set<string>();
      (slots ?? []).forEach((r: any) => {
        s.add(`${r.slot_date}|${r.time_block}`);
      });
      setSelected(s);

      setLoading(false);
    })();
  }, [inviteId, router]);

  function toggle(dateISO: string, block: Block) {
    const key = `${dateISO}|${block}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    setMsg(null);

    if (selected.size === 0) {
      setMsg("Select at least one day/time block.");
      return;
    }

    setBusy(true);

    const slots = Array.from(selected).map((k) => {
      const [date, block] = k.split("|");
      return { date, block };
    });

    const { error } = await supabase.rpc("submit_live_invite_availability", {
      p_invite_id: inviteId,
      p_slots: slots,
    });

    if (error) {
      setMsg(error.message || "Failed to submit availability.");
      setBusy(false);
      return;
    }

    setBusy(false);
    router.push("/inbox");
  }

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <button onClick={() => router.back()} className="text-sm underline opacity-80 hover:opacity-100">
        ← Back
      </button>

      <h1 className="mt-3 text-2xl font-bold">Propose times</h1>

      {loading ? (
        <div className="mt-6 text-sm text-zinc-600">Loading…</div>
      ) : (
        <>
          <div className="mt-3 rounded border border-zinc-300 bg-zinc-50 p-4">
            <div className="text-sm text-zinc-700">
              <div>
                <span className="font-semibold">Challenger:</span> {fromHandle ? `@${fromHandle}` : "—"}
              </div>
              <div className="mt-1">
                <span className="font-semibold">Topic:</span> {topicName ?? "—"}
              </div>
            </div>

            {questionText && (
              <div className="mt-3 rounded border border-zinc-200 bg-white p-3">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Question</div>
                <div className="mt-1 text-sm">{questionText}</div>
              </div>
            )}
          </div>

          {msg && <div className="mt-4 rounded border border-zinc-300 bg-white p-3 text-sm">{msg}</div>}

          <div className="mt-6 space-y-4">
            {next14Days.map((d) => {
              const iso = toISODate(d);
              const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

              return (
                <div key={iso} className="rounded-lg border border-zinc-300 bg-zinc-100 p-4">
                  <div className="font-semibold text-sm">{label}</div>

                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                    {BLOCKS.map((b) => {
                      const key = `${iso}|${b.key}`;
                      const on = selected.has(key);
                      return (
                        <button
                          key={b.key}
                          onClick={() => toggle(iso, b.key)}
                          className={`rounded border px-3 py-3 text-left text-sm transition ${
                            on ? "bg-black text-white border-black" : "bg-white border-zinc-300 hover:bg-zinc-50"
                          }`}
                        >
                          <div className="font-medium">{b.label}</div>
                          <div className={`text-xs ${on ? "text-white/80" : "text-zinc-500"}`}>{b.hours}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              onClick={() => router.push("/inbox")}
              className="px-4 py-2 rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-sm"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="px-4 py-2 rounded bg-black text-white hover:opacity-90 text-sm disabled:opacity-60"
              disabled={busy}
            >
              {busy ? "Submitting…" : "Submit availability"}
            </button>
          </div>
        </>
      )}
    </main>
  );
}