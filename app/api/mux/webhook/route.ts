import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import supabaseAdmin from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * Mux webhook signature format header: "Mux-Signature"
 * Example: "t=1700000000,v1=abcdef..."
 */
function verifyMuxSignature(rawBody: string, muxSignature: string, secret: string) {
  const parts = muxSignature.split(",").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  // 5 minute tolerance
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now - ts) > 300) return false;

  const signedPayload = `${t}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

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

    // Important: verify signature against RAW body string
    const rawBody = await req.text();
    const muxSig = req.headers.get("Mux-Signature");

    if (!muxSig) {
      console.log("MUX WEBHOOK: missing Mux-Signature header");
      return NextResponse.json({ error: "Missing Mux-Signature header" }, { status: 401 });
    }

    const ok = verifyMuxSignature(rawBody, muxSig, secret);
    if (!ok) {
      console.log("MUX WEBHOOK: invalid signature", { muxSig: muxSig.slice(0, 40) + "..." });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const type: string | undefined = event?.type;
    const data = event?.data ?? event?.object ?? event;

    console.log("MUX WEBHOOK EVENT", { type });

    // -----------------------------
    // 1) upload -> asset created
    // -----------------------------
    if (type === "video.upload.asset_created") {
      /**
       * Mux commonly sends:
       * data.id       = upload id
       * data.asset_id = asset id
       *
       * Your previous code only looked for data.upload_id (often absent).
       */
      const uploadId: string | undefined = data?.upload_id ?? data?.id;
      const assetId: string | undefined = data?.asset_id ?? data?.asset?.id;

      console.log("upload.asset_created", { uploadId, assetId });

      if (uploadId && assetId) {
        const { error } = await supabaseAdmin
          .from("takes")
          .update({
            mux_asset_id: assetId,
            status: "processing",
          })
          .eq("video_provider", "mux")
          .eq("video_ref", uploadId);

        if (error) {
          console.log("Supabase update error (asset_created)", error);
        }
      } else {
        console.log("Missing uploadId/assetId in asset_created", { data });
      }

      return NextResponse.json({ ok: true });
    }

    // -----------------------------
    // 2) asset ready -> playback id
    // -----------------------------
    if (type === "video.asset.ready") {
      const assetId: string | undefined = data?.id;

      // playback_ids usually like [{ id: "PLAYBACK_ID" }]
      const playbackId: string | undefined =
        data?.playback_id ?? data?.playback_ids?.[0]?.id;

      console.log("asset.ready", { assetId, playbackId });

      if (assetId && playbackId) {
        const { error } = await supabaseAdmin
          .from("takes")
          .update({
            playback_id: playbackId,
            status: "ready",
          })
          .eq("video_provider", "mux")
          .eq("mux_asset_id", assetId);

        if (error) {
          console.log("Supabase update error (asset_ready)", error);
        }
      } else {
        console.log("Missing assetId/playbackId in asset_ready", { data });
      }

      return NextResponse.json({ ok: true });
    }

    // -----------------------------
    // 3) asset errored
    // -----------------------------
    if (type === "video.asset.errored") {
      const assetId: string | undefined = data?.id;

      console.log("asset.errored", { assetId });

      if (assetId) {
        const { error } = await supabaseAdmin
          .from("takes")
          .update({ status: "errored" })
          .eq("video_provider", "mux")
          .eq("mux_asset_id", assetId);

        if (error) {
          console.log("Supabase update error (asset_errored)", error);
        }
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Mux webhook error", e);
    return NextResponse.json({ error: e?.message || "Webhook error" }, { status: 500 });
  }
}