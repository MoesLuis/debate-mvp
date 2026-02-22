import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import supabaseAdmin from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// Verify Mux webhook signature (header: "Mux-Signature") :contentReference[oaicite:4]{index=4}
function verifyMuxSignature(rawBody: string, muxSignature: string, secret: string) {
  // Expected format: "t=timestamp,v1=signature"
  const parts = muxSignature.split(",").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  // Tolerance: 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now - ts) > 300) return false;

  const signedPayload = `${t}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.MUX_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Missing MUX_WEBHOOK_SECRET" }, { status: 500 });
    }

    const rawBody = await req.text();
    const muxSig = req.headers.get("Mux-Signature"); // exact header name :contentReference[oaicite:5]{index=5}

    if (!muxSig) {
      return NextResponse.json({ error: "Missing Mux-Signature header" }, { status: 401 });
    }

    const ok = verifyMuxSignature(rawBody, muxSig, secret);
    if (!ok) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(rawBody);

    // event.type examples: "video.upload.asset_created", "video.asset.ready" :contentReference[oaicite:6]{index=6}
    const type: string | undefined = event?.type;

    // Mux payload commonly uses event.data for the object
    const data = event?.data ?? event?.object ?? event;

    // ---- 1) Upload -> asset created ----
    if (type === "video.upload.asset_created") {
      // Contains asset_id, and is tied to an upload :contentReference[oaicite:7]{index=7}
      const uploadId: string | undefined =
        data?.upload_id || event?.data?.upload_id || event?.object?.upload_id;

      const assetId: string | undefined = data?.asset_id || data?.id;

      if (uploadId && assetId) {
        await supabaseAdmin
          .from("takes")
          .update({
            mux_asset_id: assetId,
            status: "processing",
          })
          .eq("video_provider", "mux")
          .eq("video_ref", uploadId);
      }

      return NextResponse.json({ ok: true });
    }

    // ---- 2) Asset ready -> playback id exists ----
    if (type === "video.asset.ready") {
      // Contains playback id when ready :contentReference[oaicite:8]{index=8}
      const assetId: string | undefined = data?.id;

      // playback_ids often is an array like [{ id: "..." }]
      const playbackId: string | undefined =
        data?.playback_id ||
        data?.playback_ids?.[0]?.id ||
        event?.data?.playback_ids?.[0]?.id;

      if (assetId && playbackId) {
        await supabaseAdmin
          .from("takes")
          .update({
            playback_id: playbackId,
            status: "ready",
          })
          .eq("video_provider", "mux")
          .eq("mux_asset_id", assetId);
      }

      return NextResponse.json({ ok: true });
    }

    // ---- 3) Asset errored ----
    if (type === "video.asset.errored") {
      const assetId: string | undefined = data?.id;
      if (assetId) {
        await supabaseAdmin
          .from("takes")
          .update({ status: "errored" })
          .eq("video_provider", "mux")
          .eq("mux_asset_id", assetId);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Mux webhook error", e);
    return NextResponse.json({ error: e?.message || "Webhook error" }, { status: 500 });
  }
}