/**
 * 2.8-B — auth helpers for the Apple Wallet Web Service Node routes (PRD 80, ADR
 * 0003, STACK §2.3/§5.4).
 *
 * These mirror the authoritative, unit-tested backend helpers
 * (`packages/backend/convex/lib/wallet/internalAuth.ts`) — kept here, in the admin
 * app, so the Node routes stay self-contained and the Next build never pulls the
 * Convex server graph in. Both sides agree on the SAME contract:
 *  - the internal Convex↔Node channel HMAC over `${timestamp}.${body}` keyed on
 *    `WALLET_INTERNAL_HMAC_SECRET` (US 23), and
 *  - the per-pass Apple PassKit token derived as
 *    `HMAC(secret, "wallet-pass-auth:" + serialNumber)` (US 10).
 *
 * Web Crypto only (Node 20 `globalThis.crypto.subtle`), so no extra dependency.
 */

const PASS_AUTH_PREFIX = "wallet-pass-auth:";

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

/** Signed internal request: the timestamp + the HMAC over `${ts}.${body}`. */
export type SignedInternalRequest = { timestamp: string; signature: string };

/** Sign an internal-channel request body (US 23). */
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
 * Verify an internal-channel request (US 23). Returns `true` iff the signature is a
 * well-formed HMAC over `${timestamp}.${body}` with `secret`. Rejects a missing /
 * empty signature or timestamp. When `toleranceSeconds` is supplied, also rejects a
 * stale request (replay protection). The Convex→Node direction (the push route, #71)
 * verifies the incoming signature; the Node→Convex direction signs it.
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

/** Derive the Apple PassKit `authenticationToken` for a serial (US 10). */
export async function walletPassAuthToken(
  secret: string,
  serialNumber: string,
): Promise<string> {
  return hmacSha256Hex(secret, `${PASS_AUTH_PREFIX}${serialNumber}`);
}

/** Verify a presented PassKit token against the one derived from the serial. */
export async function verifyWalletPassAuthToken(args: {
  secret: string;
  serialNumber: string;
  presentedToken: string | null;
}): Promise<boolean> {
  if (args.presentedToken === null || args.presentedToken === "") return false;
  const expected = await walletPassAuthToken(args.secret, args.serialNumber);
  return timingSafeEqualHex(args.presentedToken, expected);
}

/** Parse the bearer token out of an `Authorization: ApplePass {token}` header. */
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

/** The shared internal secret, read server-side only (US 22). Throws if absent. */
export function walletInternalSecret(): string {
  const secret = process.env.WALLET_INTERNAL_HMAC_SECRET;
  if (!secret || secret === "") {
    throw new Error("WALLET_INTERNAL_HMAC_SECRET is not configured.");
  }
  return secret;
}

/**
 * The Convex HTTP Actions base URL (`*.convex.site`), derived from
 * `NEXT_PUBLIC_CONVEX_URL` (`*.convex.cloud`). The Node routes forward the verified
 * registration to `${base}/wallet/registrations` over the HMAC channel.
 */
export function convexSiteUrl(): string {
  const explicit = process.env.CONVEX_SITE_URL;
  if (explicit && explicit !== "") return explicit.replace(/\/$/, "");
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!cloud || cloud === "") {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }
  return cloud.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
