import { createSign } from "node:crypto";
import { connect } from "node:http2";
import { NextResponse } from "next/server";
import { verifyInternalRequest, walletInternalSecret } from "@/lib/wallet-auth";

/**
 * 2.8-D — Apple Wallet push-update route (PRD 80, ADR 0003, STACK §2.3/§5.4, US
 * 15/16/22/27). Node runtime: the APNs HTTP/2 transport + the ES256 provider-token
 * signing do NOT belong in the Convex V8 runtime (STACK §2.3).
 *
 * The Convex DEFAULT-runtime action (`lib/wallet/triggerUpdate.triggerUpdate`)
 * resolves the pass + its active device tokens, signs the payload with the internal
 * channel HMAC (`WALLET_INTERNAL_HMAC_SECRET`, `x-kb-timestamp` / `x-kb-signature`)
 * and POSTs it here — "Convex reste la source de vérité data, déclenche via fetch
 * HMAC-signé" (STACK §2.3). This route:
 *  1. reads the RAW body FIRST (never parse before verifying the channel HMAC, same
 *     discipline as the Stripe / Uber webhooks + the 2.8-B routes);
 *  2. verifies the channel HMAC with a freshness tolerance (replay protection); a
 *     forged / stale caller ⇒ 401, no APNs call;
 *  3. for each device push token, sends a CONTENT-FREE APNs push (`{}` body, the
 *     Wallet update protocol — the device then re-downloads the `.pkpass` from the
 *     Web Service, #69). `silent` maps to the APNs priority/push-type so an Info
 *     statut update (US 16) lands without a lock-screen alert;
 *  4. collects the tokens APNs rejects as Unregistered / BadDeviceToken (the
 *     410-equivalent) into `inactiveTokens`, which Convex soft-deactivates so they
 *     are never targeted again (US 27).
 *
 * The APNs auth KEY (.p8) is read server-side ONLY (US 22), never from Convex. In
 * CI / dev the key is absent → the route answers 503 (the real send is HITL: a
 * device e2e, like the `.pkpass` signing of #69). The signature/transport never
 * runs in the Convex runtime.
 */
export const runtime = "nodejs";

/** Replay tolerance for the internal channel (seconds) — mirrors the 2.8-B routes. */
const TOLERANCE_SECONDS = 300;

/** APNs production host. The Wallet topic = the FIXED Pass Type ID (ADR 0003). */
const APNS_HOST = "https://api.push.apple.com";

type PushPayload = {
  serialNumber: string;
  passTypeIdentifier: string;
  pushTokens: string[];
  silent: boolean;
};

function isPushPayload(value: unknown): value is PushPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.serialNumber === "string" &&
    typeof v.passTypeIdentifier === "string" &&
    Array.isArray(v.pushTokens) &&
    v.pushTokens.every((t) => typeof t === "string") &&
    typeof v.silent === "boolean"
  );
}

/** The APNs provider credentials, read server-side only (US 22). */
type ApnsCredentials = {
  authKey: string; // the .p8 private key (PEM)
  keyId: string;
  teamId: string;
};

/** Read the APNs provider credentials, or `null` when absent (CI / dev ⇒ 503). */
function apnsCredentials(): ApnsCredentials | null {
  const authKey = process.env.WALLET_APNS_AUTH_KEY;
  const keyId = process.env.WALLET_APNS_KEY_ID;
  const teamId = process.env.WALLET_APNS_TEAM_ID;
  if (!authKey || !keyId || !teamId) return null;
  // The env may carry the PEM with escaped newlines — normalise them.
  return { authKey: authKey.replace(/\\n/g, "\n"), keyId, teamId };
}

/** Base64url without padding (JWT segment encoding). */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Build the APNs provider authentication token (ES256 JWT), signed with the .p8
 * auth key. Reused across the batch (APNs accepts a token for ~1h). The auth key
 * never leaves this Node process (US 22).
 */
function apnsProviderToken(creds: ApnsCredentials): string {
  const header = { alg: "ES256", kid: creds.keyId };
  const claims = { iss: creds.teamId, iat: Math.floor(Date.now() / 1000) };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(claims),
  )}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key: creds.authKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

/** One device's APNs result: delivered, or gone (token to soft-deactivate). */
type ApnsTokenResult = { token: string; gone: boolean };

/**
 * Send a CONTENT-FREE Wallet push to one device over APNs HTTP/2. A 410 Gone, or a
 * 400/403 whose `reason` is Unregistered / BadDeviceToken, marks the token gone
 * (US 27). The push body is `{}` (the Wallet update protocol); `silent` lowers the
 * priority so an Info statut update does not raise a lock-screen alert (US 16).
 */
function sendToToken(
  session: ReturnType<typeof connect>,
  token: string,
  topic: string,
  providerToken: string,
  silent: boolean,
): Promise<ApnsTokenResult> {
  return new Promise<ApnsTokenResult>((resolve, reject) => {
    const body = "{}";
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken}`,
      "apns-topic": topic,
      "apns-push-type": "background",
      "apns-priority": silent ? "5" : "10",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });

    let status = 0;
    let data = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      data += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      let reason = "";
      if (data) {
        try {
          reason = (JSON.parse(data) as { reason?: string }).reason ?? "";
        } catch {
          reason = "";
        }
      }
      const gone =
        status === 410 ||
        reason === "Unregistered" ||
        reason === "BadDeviceToken";
      resolve({ token, gone });
    });
    req.end(body);
  });
}

export async function POST(request: Request): Promise<Response> {
  // 1. RAW body FIRST — never parse before verifying the channel signature.
  const rawBody = await request.text();

  // 2. Verify the internal channel HMAC (US 23). A misconfiguration ⇒ 500, a forged
  //    / stale signature ⇒ 401 (no APNs call).
  let secret: string;
  try {
    secret = walletInternalSecret();
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
  if (!isPushPayload(payload)) {
    return new NextResponse("Malformed push", { status: 400 });
  }

  // No active device ⇒ nothing to push (Convex normally filters this out — US 27).
  if (payload.pushTokens.length === 0) {
    return NextResponse.json({ inactiveTokens: [] }, { status: 200 });
  }

  // 4. APNs key absent in this env (CI / dev) ⇒ 503. The real send is HITL (device
  //    e2e), exactly like the `.pkpass` signing of #69 — never in CI.
  const creds = apnsCredentials();
  if (creds === null) {
    return new NextResponse("Push transport unavailable", { status: 503 });
  }

  // 5. Send a content-free Wallet push to each device over APNs HTTP/2.
  const providerToken = apnsProviderToken(creds);
  const session = connect(APNS_HOST);
  const inactiveTokens: string[] = [];
  try {
    const results = await Promise.all(
      payload.pushTokens.map((token) =>
        sendToToken(
          session,
          token,
          payload.passTypeIdentifier,
          providerToken,
          payload.silent,
        ),
      ),
    );
    for (const r of results) {
      if (r.gone) inactiveTokens.push(r.token);
    }
  } catch {
    // A transport error is not a dead-token signal — report none, no retry storm.
    return new NextResponse("Push transport error", { status: 502 });
  } finally {
    session.close();
  }

  return NextResponse.json({ inactiveTokens }, { status: 200 });
}
