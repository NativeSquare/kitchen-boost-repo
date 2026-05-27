import { NextResponse } from "next/server";
import webpush, { type PushSubscription, WebPushError } from "web-push";
import {
  vapidCredentials,
  verifyInternalRequest,
  webPushInternalSecret,
} from "@/lib/web-push-auth";

/**
 * 2.7-C (#54) — Web Push send route (PRD 80, STACK §5.5, POC #2, notifications
 * CONTEXT « Push web » / « VAPID » / « Push subscription »). Node runtime: the Web
 * Push Protocol encryption (ECDH P-256 + HKDF + AES-128-GCM, RFC 8291) + the VAPID
 * JWT do NOT run in the V8 Convex runtime (STACK §5.5 / POC #2) — they run HERE via
 * the `web-push` lib.
 *
 * The Convex DEFAULT-runtime action (`lib/notifications/dispatch.dispatchWebPushSends`)
 * resolves the customer's ACTIVE subscriptions (#128 tenant-scoped read seam), signs
 * the payload with the internal channel HMAC (`WEB_PUSH_INTERNAL_HMAC_SECRET`,
 * `x-kb-timestamp` / `x-kb-signature`) and POSTs it here. This route:
 *  1. reads the RAW body FIRST (never parse before verifying the channel HMAC — the
 *     same discipline as the Stripe / Uber webhooks + the Wallet push route);
 *  2. verifies the channel HMAC with a freshness tolerance (replay protection); a
 *     forged / stale / unsigned caller ⇒ 401, no push sent;
 *  3. for each subscription, sends the encrypted Web Push via `web-push` + VAPID;
 *  4. collects the endpoints the push service rejected with 410 Gone / 404 (the
 *     expired-subscription marker) into `goneEndpoints`, which Convex soft-deactivates
 *     via the #128 seam so they are never targeted again (notifications CONTEXT).
 *
 * The VAPID key pair is read server-side ONLY (one pair per environment, never
 * committed). In CI / dev the keys are absent → the route answers 503 (the real send
 * is HITL: a browser e2e, like the APNs send of the Wallet route). The encryption /
 * transport never runs in the Convex runtime.
 */
export const runtime = "nodejs";

/** Replay tolerance for the internal channel (seconds) — mirrors the Wallet route. */
const TOLERANCE_SECONDS = 300;

/** One subscription to push to (the RFC 8291 client keys, from the #128 store). */
type IncomingSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type SendPayload = {
  customerId: string;
  subscriptions: IncomingSubscription[];
};

function isIncomingSubscription(value: unknown): value is IncomingSubscription {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.endpoint === "string" &&
    typeof v.p256dh === "string" &&
    typeof v.auth === "string"
  );
}

function isSendPayload(value: unknown): value is SendPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.customerId === "string" &&
    Array.isArray(v.subscriptions) &&
    v.subscriptions.every(isIncomingSubscription)
  );
}

/** The Web Push notification content. Minimal V1 — the SW renders title/body. */
const PUSH_CONTENT = JSON.stringify({ title: "KitchenBoost" });

/** One subscription's send result: delivered, or gone (410/404 → soft-deactivate). */
type SendResult = { endpoint: string; gone: boolean; failed: boolean };

/**
 * Send one encrypted Web Push. A 410 Gone / 404 marks the endpoint gone (the
 * expired-subscription marker, RFC 8291 / notifications CONTEXT). Any other error is
 * a transport failure (NOT a gone signal — no soft-deactivate, no retry storm).
 */
async function sendToSubscription(
  sub: IncomingSubscription,
): Promise<SendResult> {
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  try {
    await webpush.sendNotification(subscription, PUSH_CONTENT);
    return { endpoint: sub.endpoint, gone: false, failed: false };
  } catch (err) {
    if (
      err instanceof WebPushError &&
      (err.statusCode === 410 || err.statusCode === 404)
    ) {
      return { endpoint: sub.endpoint, gone: true, failed: false };
    }
    return { endpoint: sub.endpoint, gone: false, failed: true };
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. RAW body FIRST — never parse before verifying the channel signature.
  const rawBody = await request.text();

  // 2. Verify the internal channel HMAC. A misconfiguration ⇒ 500, a forged / stale /
  //    unsigned signature ⇒ 401 (no push sent).
  let secret: string;
  try {
    secret = webPushInternalSecret();
  } catch {
    return new NextResponse("Misconfigured", { status: 500 });
  }
  const channelOk = await verifyInternalRequest({
    secret,
    body: rawBody,
    timestamp: request.headers.get("x-kb-timestamp"),
    signature: request.headers.get("x-kb-signature"),
    toleranceSeconds: TOLERANCE_SECONDS,
  });
  if (!channelOk) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // 3. Safe to parse now.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  if (!isSendPayload(payload)) {
    return new NextResponse("Malformed push", { status: 400 });
  }

  // No subscription ⇒ nothing to push (Convex normally filters this out).
  if (payload.subscriptions.length === 0) {
    return NextResponse.json({ goneEndpoints: [] }, { status: 200 });
  }

  // 4. VAPID keys absent in this env (CI / dev) ⇒ 503. The real send is HITL (a
  //    browser e2e), exactly like the APNs send of the Wallet route.
  const vapid = vapidCredentials();
  if (vapid === null) {
    return new NextResponse("Push transport unavailable", { status: 503 });
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  // 5. Send the encrypted Web Push to each subscription.
  const results = await Promise.all(
    payload.subscriptions.map((sub) => sendToSubscription(sub)),
  );
  const goneEndpoints = results.filter((r) => r.gone).map((r) => r.endpoint);
  const failed = results.filter((r) => r.failed).length;

  // Every endpoint failed transport (none gone) ⇒ surface a transport error so the
  // dispatcher records `failed` (no soft-deactivate, no retry storm).
  if (failed > 0 && goneEndpoints.length === 0 && failed === results.length) {
    return new NextResponse("Push transport error", { status: 502 });
  }

  return NextResponse.json({ goneEndpoints }, { status: 200 });
}
