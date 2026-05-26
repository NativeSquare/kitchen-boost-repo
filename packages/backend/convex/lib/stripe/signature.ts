/**
 * 2.5-A — Stripe webhook signature verification on the RAW body (PRD 30 §1,
 * STACK §2.3, POC #1 ✅). Stripe signs each webhook with the endpoint signing
 * secret (`whsec_…`) and sends a `Stripe-Signature` header of the form
 *
 *   t=1690000000,v1=<hex hmac>,v1=<hex hmac>,...
 *
 * where the signed payload is `${t}.${rawBody}` and the MAC is HMAC-SHA256 with
 * the signing secret. We verify on the EXACT bytes received (`await req.text()`
 * before any parse — POC #1 proved Convex `httpAction` preserves the raw body),
 * using Web Crypto `crypto.subtle` (default Convex runtime, no `"use node"`).
 *
 * Pure + I/O-light (only `crypto.subtle`), so it is unit-testable in isolation.
 */

/** Parse a `Stripe-Signature` header into its timestamp + the list of v1 MACs. */
export function parseStripeSignatureHeader(header: string): {
  timestamp: string | null;
  v1: string[];
} {
  let timestamp: string | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") v1.push(value);
  }
  return { timestamp, v1 };
}

/** Hex-encode bytes. */
function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish equality over two same-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256(secret, message) as a lowercase hex string. */
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
 * Verify a Stripe webhook signature against the raw body. Returns `true` iff the
 * header is well-formed AND at least one `v1` MAC matches HMAC-SHA256 over
 * `${t}.${rawBody}` with `secret`. Optionally rejects an event whose timestamp
 * is older than `toleranceSeconds` relative to `nowSeconds` (replay protection);
 * pass `toleranceSeconds: undefined` to skip the freshness check.
 */
export async function verifyStripeSignature(args: {
  rawBody: string;
  header: string | null;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  if (args.header === null || args.header === "") return false;
  const { timestamp, v1 } = parseStripeSignatureHeader(args.header);
  if (timestamp === null || v1.length === 0) return false;

  if (args.toleranceSeconds !== undefined) {
    const ts = Number(timestamp);
    const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > args.toleranceSeconds) {
      return false;
    }
  }

  const expected = await hmacSha256Hex(
    args.secret,
    `${timestamp}.${args.rawBody}`,
  );
  return v1.some((mac) => timingSafeEqualHex(mac, expected));
}
