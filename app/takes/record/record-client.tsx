"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type FollowedTopic = { id: number; name: string };
type Question = { id: number; question: string };

function normalizeStance(s: string | null): "neutral" | "pro" | "against" {
  if (!s) return "neutral";
  const v = s.toLowerCase();
  if (v === "against") return "against";
  if (v === "pro" || v === "for" || v === "in_favor") return "pro";
  return "neutral";
}

export default function RecordTakeClient() {
  const router = useRouter();
  const params = useSearchParams();

  // ✅ Reply / thread params
  const parentTakeIdParam = params.get("parentTakeId");
  const stanceParam = params.get("stance");
  const isReply = !!parentTakeIdParam;

  // Recording state
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Data state
  const [topics, setTopics] = useState<FollowedTopic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [topicId, setTopicId] = useState<number | null>(null);
  const [questionId, setQuestionId] = useState<number | null>(null);

  // Metadata
  const [stance, setStance] = useState<"neutral" | "pro" | "against">(
    normalizeStance(stanceParam)
  );
  const [isChallengeable, setIsChallengeable] = useState(false);

  // Upload state
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // If URL param stance changes (rare), sync
    setStance(normalizeStance(stanceParam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stanceParam]);

  useEffect(() => {
    // If this is a reply, default: not challengeable
    if (isReply) setIsChallengeable(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReply, parentTakeIdParam]);

  useEffect(() => {
    loadFollowedTopics();
    return () => cleanupMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (topicId) loadQuestions(topicId);
    else setQuestions([]);
    setQuestionId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  const canRecord = useMemo(
    () => !!topicId && !!questionId && !busy,
    [topicId, questionId, busy]
  );
  const canUpload = useMemo(
    () => !!videoBlob && !!topicId && !!questionId && !busy,
    [videoBlob, topicId, questionId, busy]
  );

  async function loadFollowedTopics() {
    setStatus("Loading your topics…");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setStatus("Please log in to record a take.");
      return;
    }

    const { data, error } = await supabase
      .from("user_topics")
      .select("topic_id, topics(name)")
      .eq("user_id", user.id);

    if (error) {
      console.error(error);
      setStatus("Failed to load topics.");
      return;
    }

    const mapped =
      (data ?? [])
        .map((row: any) => {
          const id = row?.topic_id;
          const name = row?.topics?.name;
          if (typeof id !== "number" || typeof name !== "string") return null;
          return { id, name } as FollowedTopic;
        })
        .filter(Boolean) as FollowedTopic[];

    mapped.sort((a, b) => a.name.localeCompare(b.name));
    setTopics(mapped);

    if (mapped.length > 0) setTopicId(mapped[0].id);
    setStatus("");
  }

  async function loadQuestions(tid: number) {
    setStatus("Loading questions…");

    const { data, error } = await supabase
      .from("questions")
      .select("id, question")
      .eq("topic_id", tid)
      .eq("is_active", true)
      .order("id");

    if (error) {
      console.error(error);
      setStatus("Failed to load questions.");
      return;
    }

    const mapped = (data ?? []).map((q: any) => ({
      id: Number(q.id),
      question: q.question,
    }));

    setQuestions(mapped);
    if (mapped.length > 0) setQuestionId(mapped[0].id);
    setStatus("");
  }

  function cleanupMedia() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }

  async function startRecording() {
    if (!canRecord) return;

    setStatus("");
    setVideoBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "user" },
      });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm",
      });

      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        setVideoBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);

        // Stop camera
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };

      recorder.start();
      setRecording(true);
      setStatus("Recording…");
    } catch (e) {
      console.error(e);
      setStatus("Could not access camera/microphone. Check browser permissions.");
    }
  }

  function stopRecording() {
    if (!recorderRef.current) return;
    if (recorderRef.current.state === "inactive") return;

    recorderRef.current.stop();
    setRecording(false);
    setStatus("Recording stopped. Preview below.");
  }

  async function uploadToMux() {
    if (!canUpload || !topicId || !questionId || !videoBlob) return;

    setBusy(true);
    setStatus("Creating upload…");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setStatus("Not logged in.");
      setBusy(false);
      return;
    }

    // ✅ If this is a reply, enforce non-challengeable
    const finalIsChallengeable = isReply ? false : isChallengeable;

    // 1) Ask server for signed Mux upload URL + takeId
    const createRes = await fetch("/api/takes/create-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        topicId,
        questionId,
        stance,
        parentTakeId: parentTakeIdParam || null,
        isChallengeable: finalIsChallengeable,
      }),
    });

    const createJson = await createRes.json().catch(() => ({}));

    if (!createRes.ok) {
      console.error("create-upload failed", createJson);
      setStatus(`Create upload failed: ${createJson?.error || createRes.status}`);
      setBusy(false);
      return;
    }

    const uploadUrl: string | undefined = createJson?.uploadUrl;
    const takeId: string | undefined = createJson?.takeId;

    if (!uploadUrl || !takeId) {
      setStatus("Server did not return uploadUrl/takeId.");
      setBusy(false);
      return;
    }

    // 2) Upload blob to Mux signed URL
    setStatus("Uploading video…");

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": videoBlob.type || "video/webm",
      },
      body: videoBlob,
    });

    if (!putRes.ok) {
      const t = await putRes.text().catch(() => "");
      console.error("Mux upload failed", putRes.status, t);
      setStatus(`Upload failed (${putRes.status}).`);
      setBusy(false);
      return;
    }

    setStatus("Uploaded ✅ Processing in Mux… (this may take a moment)");
    setBusy(false);

    // MVP: send back to feed
    setTimeout(() => router.push("/takes"), 900);
  }

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {isReply ? "Record a Reply" : "Record a Take"}
          </h1>
          {isReply && (
            <p className="text-sm text-zinc-700 mt-1">
              Replying to a take (thread). Your reply will show under{" "}
              <strong>
                {stance === "against"
                  ? "Against"
                  : stance === "pro"
                  ? "In favor"
                  : "Neutral"}
              </strong>
              .
            </p>
          )}
        </div>

        <button
          onClick={() => router.push("/takes")}
          className="px-3 py-2 rounded border border-zinc-400 bg-zinc-100 text-sm hover:bg-zinc-50"
        >
          Back to feed
        </button>
      </div>

      <div className="mt-4 grid md:grid-cols-2 gap-4">
        {/* Left: selections */}
        <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-4">
          <label className="block text-sm font-medium">Topic</label>
          <select
            value={topicId ?? ""}
            onChange={(e) => setTopicId(Number(e.target.value))}
            className="mt-1 w-full rounded border border-zinc-300 bg-white p-2 text-sm"
          >
            {topics.length === 0 ? (
              <option value="">
                (No topics followed — add topics in Profile)
              </option>
            ) : (
              topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))
            )}
          </select>

          <label className="block text-sm font-medium mt-4">Question</label>
          <select
            value={questionId ?? ""}
            onChange={(e) => setQuestionId(Number(e.target.value))}
            className="mt-1 w-full rounded border border-zinc-300 bg-white p-2 text-sm"
          >
            {questions.length === 0 ? (
              <option value="">(No questions for this topic yet)</option>
            ) : (
              questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.question}
                </option>
              ))
            )}
          </select>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium">Stance</label>
              <select
                value={stance}
                onChange={(e) =>
                  setStance(e.target.value as "neutral" | "pro" | "against")
                }
                className="mt-1 w-full rounded border border-zinc-300 bg-white p-2 text-sm"
              >
                <option value="neutral">Neutral</option>
                <option value="pro">In favor</option>
                <option value="against">Against</option>
              </select>

              {isReply && (
                <div className="text-xs text-zinc-600 mt-2">
                  Tip: For replies, stance controls whether it appears under{" "}
                  <strong>Against</strong> or <strong>In favor</strong>.
                </div>
              )}
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isChallengeable}
                  disabled={isReply}
                  onChange={(e) => setIsChallengeable(e.target.checked)}
                />
                Challengeable
              </label>
            </div>
          </div>

          {isReply ? (
            <div className="mt-4 text-xs text-zinc-700">
              Challengeable is disabled for replies.
            </div>
          ) : (
            <div className="mt-4 text-xs text-zinc-600">
              Tip: If you have no topics here, go to <strong>Profile</strong>{" "}
              and select topics first.
            </div>
          )}
        </div>

        {/* Right: recorder */}
        <div className="rounded-lg border border-zinc-300 bg-zinc-100 p-4">
          <div className="flex items-center gap-3">
            {!recording ? (
              <button
                disabled={!canRecord}
                onClick={startRecording}
                className={`px-4 py-2 rounded text-sm ${
                  canRecord
                    ? "bg-black text-white hover:opacity-90"
                    : "bg-zinc-300 text-zinc-600 cursor-not-allowed"
                }`}
              >
                Start recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="px-4 py-2 rounded text-sm bg-red-600 text-white hover:opacity-90"
              >
                Stop
              </button>
            )}

            <button
              disabled={!canUpload}
              onClick={uploadToMux}
              className={`px-4 py-2 rounded text-sm ${
                canUpload
                  ? "bg-emerald-600 text-white hover:opacity-90"
                  : "bg-zinc-300 text-zinc-600 cursor-not-allowed"
              }`}
            >
              Upload to Mux
            </button>
          </div>

          {status && <p className="mt-3 text-sm text-zinc-700">{status}</p>}

          <div className="mt-4">
            <div className="text-sm font-medium mb-2">Preview</div>
            {previewUrl ? (
              <video
                src={previewUrl}
                controls
                playsInline
                className="w-full rounded border border-zinc-300 bg-black"
              />
            ) : (
              <div className="h-56 rounded border border-zinc-300 bg-zinc-200 flex items-center justify-center text-sm text-zinc-600">
                No recording yet
              </div>
            )}
          </div>
        </div>
      </div>

      {isReply && (
        <div className="mt-4 text-xs text-zinc-700">
          Parent take id: <span className="font-mono">{parentTakeIdParam}</span>
        </div>
      )}
    </div>
  );
}