/**
 * 2.7-C (#54) — auth helper for the Web Push send Node route (PRD 80, STACK §5.5,
 * notifications CONTEXT « VAPID » / « Push subscription »).
 *
 * Mirrors the authoritative, unit-tested backend helper
 * (`packages/backend/convex/lib/wallet/internalAuth.ts`) — kept here, in the web app,
 * so the Node route stays self-contained and the Next build never pulls the Convex
 * server graph in (the same arrangement as `apps/admin/src/lib/wallet-auth.ts` for
 * the Wallet push route). Both sides agree on the SAME contract: the internal
 * Convex→Node channel HMAC over `${timestamp}.${body}` keyed on the shared secret
 * `WEB_PUSH_INTERNAL_HMAC_SECRET` — only an authenticated KB request triggers a send.
 * The signature travels in the `x-kb-timestamp` / `x-kb-signature` headers; the
 * secret NEVER in a body and NEVER returned by a query.
 *
 * Web Crypto only (Node 20 `globalThis.crypto.subtle`), so no extra dependency.
 */

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toHex(sig);
}

/**
 * Verify an internal-channel request (the Convex→Node direction). Returns `true` iff
 * the signature is a well-formed HMAC over `${timestamp}.${body}` with `secret`.
 * Rejects a missing / empty signature or timestamp. When `toleranceSeconds` is
 * supplied, also rejects a stale request (replay protection).
 */
export async function verifyInternalRequest(args: {
  secret: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  if (args.signature === null || args.signature === "") return false;
  if (args.timestamp === null || args.timestamp === "") return false;

  if (args.toleranceSeconds !== undefined) {
    const ts = Number(args.timestamp);
    const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > args.toleranceSeconds) {
      return false;
    }
  }

  const expected = await hmacSha256Hex(
    args.secret,
    `${args.timestamp}.${args.body}`,
  );
  return timingSafeEqualHex(args.signature, expected);
}

/** The shared internal secret, read server-side only. Throws if absent. */
export function webPushInternalSecret(): string {
  const secret = process.env.WEB_PUSH_INTERNAL_HMAC_SECRET;
  if (!secret || secret === "") {
    throw new Error("WEB_PUSH_INTERNAL_HMAC_SECRET is not configured.");
  }
  return secret;
}

/** A VAPID key pair, read server-side only — one pair per environment. */
export type VapidCredentials = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

/**
 * Read the VAPID credentials from the environment, or `null` when absent (CI / dev
 * ⇒ 503). `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are a per-environment secret
 * (one pair per dev/prod, notifications CONTEXT « VAPID »), NEVER committed. The
 * subject defaults to the KB ops mailto if unset.
 */
export function vapidCredentials(): VapidCredentials | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:ops@kitchen-boost.fr";
  return { publicKey, privateKey, subject };
}
