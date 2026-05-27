/**
 * 2.8-B — authentication of the two trust boundaries of the Apple Wallet Web
 * Service (PRD 80, STACK §2.3/§5.4, US 23).
 *
 * The crypto-heavy / binary work (`.pkpass` PKCS#7 signing, APNs HTTP/2) lives in
 * the Next.js Node routes (`apps/admin/api/wallet/*`), while the data lives in
 * Convex. Two distinct tokens guard the flow, BOTH derived with HMAC-SHA256 via
 * `crypto.subtle` (default Convex runtime, no `"use node"` — same primitive the
 * Stripe / Uber webhook verifiers use, so it is unit-testable in isolation):
 *
 *  1. The INTERNAL Convex↔Node channel (`signInternalRequest` /
 *     `verifyInternalRequest`): the Node route calls Convex (and Convex calls the
 *     Node route) with a `${timestamp}.${body}` HMAC keyed on the shared secret
 *     `WALLET_INTERNAL_HMAC_SECRET` — "seules des requêtes authentifiées de KB
 *     déclenchent la génération" (issue, US 23). The signature travels in headers,
 *     the secret NEVER in a body and NEVER returned by a Convex query (US 22).
 *
 *  2. The PER-PASS Apple PassKit auth token (`walletPassAuthToken`): every Wallet
 *     Web Service call from a device carries `Authorization: ApplePass {token}`,
 *     where `{token}` is the `authenticationToken` embedded in the pass. We DERIVE
 *     it deterministically as `HMAC(secret, "wallet-pass-auth:" + serialNumber)` so
 *     the pass needs no per-row secret stored — the same serial always yields the
 *     same token, and KB re-derives + compares it before registering / serving a
 *     pass. The secret stays server-side.
 *
 * Pure + I/O-light (only `crypto.subtle`), so both halves are testable without a
 * Convex ctx and reusable from a Node route.
 */

/** Hex-encode bytes. */
function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish equality over two hex strings (length-independent guard). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256(secret, message) as a lowercase hex string (`crypto.subtle`). */
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

// ---------------------------------------------------------------------------
// 1. Internal Convex↔Node channel (US 23)
// ---------------------------------------------------------------------------

/** A signed internal request: the timestamp + the HMAC over `${ts}.${body}`. */
export type SignedInternalRequest = {
  /** Unix seconds at signing — replayed in the header, signed into the MAC. */
  timestamp: string;
  /** HMAC-SHA256 hex of `${timestamp}.${body}` with the shared secret. */
  signature: string;
};

/**
 * Sign an internal request body for the Convex↔Node channel. Returns the
 * `timestamp` (Unix seconds) + the HMAC hex; both travel as headers and the
 * receiver re-derives the MAC over `${timestamp}.${body}`. `at` (seconds) is
 * injectable for deterministic tests, defaulting to now.
 */
export async function signInternalRequest(
  secret: string,
  body: string,
  at?: number,
): Promise<SignedInternalRequest> {
  const timestamp = String(at ?? Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return { timestamp, signature };
}

/**
 * Verify an internal request. Returns `true` iff the signature is a well-formed
 * HMAC over `${timestamp}.${body}` with `secret`. Rejects a missing / empty
 * signature or timestamp. When `toleranceSeconds` is supplied, also rejects a
 * request whose timestamp is older than the tolerance vs `nowSeconds` (replay
 * protection); pass `toleranceSeconds: undefined` to skip the freshness check.
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

// ---------------------------------------------------------------------------
// 2. Per-pass Apple PassKit auth token
// ---------------------------------------------------------------------------

/** Domain-separation prefix so the pass token can never collide with channel MACs. */
const PASS_AUTH_PREFIX = "wallet-pass-auth:";

/**
 * Derive the Apple PassKit `authenticationToken` for a pass, deterministically
 * from its serial + the shared secret: `HMAC(secret, "wallet-pass-auth:" + serial)`.
 * Embedded in the signed `pass.json` and presented by the device as
 * `Authorization: ApplePass {token}` on every Web Service call. The same serial
 * always yields the same token, so no per-pass secret is stored — KB re-derives it
 * and compares with `verifyWalletPassAuthToken`.
 */
export async function walletPassAuthToken(
  secret: string,
  serialNumber: string,
): Promise<string> {
  return hmacSha256Hex(secret, `${PASS_AUTH_PREFIX}${serialNumber}`);
}

/**
 * Verify a presented PassKit auth token against the one derived from the serial.
 * Constant-time-ish. Rejects a null / empty token. Used by the Web Service guard
 * before any registration / pass download.
 */
export async function verifyWalletPassAuthToken(args: {
  secret: string;
  serialNumber: string;
  presentedToken: string | null;
}): Promise<boolean> {
  if (args.presentedToken === null || args.presentedToken === "") return false;
  const expected = await walletPassAuthToken(args.secret, args.serialNumber);
  return timingSafeEqualHex(args.presentedToken, expected);
}

/**
 * Parse the bearer token out of an `Authorization: ApplePass {token}` header (the
 * exact scheme Apple sends). Returns the token, or `null` if the header is absent
 * or not the `ApplePass` scheme.
 */
export function parseApplePassAuthorization(
  header: string | null,
): string | null {
  if (header === null) return null;
  const trimmed = header.trim();
  const prefix = "ApplePass ";
  if (!trimmed.startsWith(prefix)) return null;
  const token = trimmed.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}
