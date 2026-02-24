"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type FollowedTopic = { id: number; name: string };
type Question = { id: number; question: string };

type ParentTakeMeta = {
  topic_id: number;
  question_id: number;
};

export default function RecordTakePage() {
  const router = useRouter();
  const params = useSearchParams();

  // ✅ Reply / thread params
  const parentTakeIdParam = params.get("parentTakeId");
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
  const [stance, setStance] = useState<"neutral" | "pro" | "against">(isReply ? "pro" : "neutral");
  const [isChallengeable, setIsChallengeable] = useState(false);

  // Upload state
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const selectorsLocked = isReply; // for now: replies inherit topic/question from parent

  useEffect(() => {
    // If this is a reply, force: not challengeable
    if (isReply) setIsChallengeable(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReply, parentTakeIdParam]);

  useEffect(() => {
    if (isReply) {
      loadParentTakeMeta();
    } else {
      loadFollowedTopics();
    }
    return () => cleanupMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only load questions on topic change in non-reply mode
  useEffect(() => {
    if (selectorsLocked) return;
    if (topicId) loadQuestions(topicId);
    else setQuestions([]);
    setQuestionId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, selectorsLocked]);

  const canRecord = useMemo(() => {
    if (!topicId || !questionId || busy) return false;
    if (isReply && stance === "neutral") return false; // replies must be pro/against
    return true;
  }, [topicId, questionId, busy, isReply, stance]);

  const canUpload = useMemo(() => {
    if (!videoBlob || !topicId || !questionId || busy) return false;
    if (isReply && stance === "neutral") return false;
    return true;
  }, [videoBlob, topicId, questionId, busy, isReply, stance]);

  async function loadParentTakeMeta() {
    setStatus("Loading parent take…");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setStatus("Please log in to record a reply.");
      return;
    }

    const parentId = parentTakeIdParam!;
    const { data: parent, error: pErr } = await supabase
      .from("takes")
      .select("topic_id, question_id")
      .eq("id", parentId)
      .maybeSingle();

    if (pErr || !parent) {
      console.error(pErr);
      setStatus("Could not load the take you are replying to.");
      return;
    }

    const meta = parent as unknown as ParentTakeMeta;

    // lock selectors to parent topic/question
    setTopicId(Number(meta.topic_id));
    setQuestionId(Number(meta.question_id));

    // load topic name
    const { data: topicRow } = await supabase
      .from("topics")
      .select("id, name")
      .eq("id", Number(meta.topic_id))
      .maybeSingle();

    // load question text
    const { data: qRow } = await supabase
      .from("questions")
      .select("id, question")
      .eq("id", Number(meta.question_id))
      .maybeSingle();

    if (topicRow?.id && topicRow?.name) {
      setTopics([{ id: Number(topicRow.id), name: String(topicRow.name) }]);
    } else {
      setTopics([{ id: Number(meta.topic_id), name: `Topic ${meta.topic_id}` }]);
    }

    if (qRow?.id && qRow?.question) {
      setQuestions([{ id: Number(qRow.id), question: String(qRow.question) }]);
    } else {
      setQuestions([{ id: Number(meta.question_id), question: `Question ${meta.question_id}` }]);
    }

    // replies default to pro (user can switch to against)
    setStance("pro");
    setStatus("");
  }

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

    if (isReply && stance === "neutral") {
      setStatus("Choose In favor or Against for a reply.");
      return;
    }

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

    setTimeout(() => router.push("/takes"), 900);
  }

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-lg border border-zinc-300 bg-zinc-200 text-zinc-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{isReply ? "Join take" : "Record a Take"}</h1>
          {isReply && (
            <p className="text-sm text-zinc-700 mt-1">
              You’re replying to a thread. Pick <strong>In favor</strong> or <strong>Against</strong>.
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
            disabled={selectorsLocked}
            className="mt-1 w-full rounded border border-zinc-300 bg-white p-2 text-sm disabled:opacity-70"
          >
            {topics.length === 0 ? (
              <option value="">
                ({isReply ? "Loading parent topic…" : "No topics followed — add topics in Profile"})
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
            disabled={selectorsLocked}
            className="mt-1 w-full rounded border border-zinc-300 bg-white p-2 text-sm disabled:opacity-70"
          >
            {questions.length === 0 ? (
              <option value="">
                ({isReply ? "Loading parent question…" : "No questions for this topic yet"})
              </option>
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

              {isReply ? (
                <select
                  value={stance}
                  onChange={(e) => setStance(e.target.value as "pro" | "against")}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white p-2 text-sm"
                >
                  <option value="pro">In favor</option>
                  <option value="against">Against</option>
                </select>
              ) : (
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
              This is a reply, so <strong>Challengeable is off</strong>.
            </div>
          ) : (
            <div className="mt-4 text-xs text-zinc-600">
              Tip: If you have no topics here, go to <strong>Profile</strong> and select topics first.
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