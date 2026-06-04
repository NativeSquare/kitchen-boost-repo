/**
 * PWA-S4 (#452) — `decideRevalidateRequest` — pure validator for the
 * HMAC-signed Convex→Next channel that the `publishMenu` mutation uses to
 * invalidate `/menu` ISR (decisions-log Q2, AC « Publier admin → menu se
 * met à jour <30s »).
 *
 * Mirrors the internal-channel pattern of `apps/web/src/lib/web-push-auth.ts`
 * (Web Push) and `apps/admin/src/lib/wallet-auth.ts` (Wallet push): the
 * caller signs `${timestamp}.${body}` with HMAC-SHA256 keyed on a shared
 * secret (`MENU_REVALIDATE_HMAC_SECRET`); the route verifies before parsing.
 *
 * Verdict:
 *  - `kind: "ok"` ⇒ route calls `revalidateTag(verdict.tag)` and 200.
 *  - `kind: "unauthorized"` ⇒ 401 (forged / stale / unsigned).
 *  - `kind: "bad-request"` ⇒ 400 (auth OK but body unparseable / no tenantId).
 *
 * Pure: keeps every branch unit-pinned in node env, no Next runtime required.
 */

/** Verdict the route handler acts on. */
export type RevalidateVerdict =
  | { kind: "ok"; tag: `menu:${string}` }
  | { kind: "unauthorized" }
  | { kind: "bad-request" };

/** Inputs the route extracts from the incoming POST. */
export type RevalidateInputs = {
  /** Shared secret (`MENU_REVALIDATE_HMAC_SECRET`, server-side env). */
  secret: string;
  /** RAW request body — never parsed before verifying the HMAC. */
  body: string;
  /** `x-kb-timestamp` header value. */
  timestamp: string | null;
  /** `x-kb-signature` header value (hex). */
  signature: string | null;
  /** Current unix seconds — defaults to `Date.now() / 1000` if omitted. */
  nowSeconds?: number;
  /** Replay tolerance window in seconds (mirror Web Push: 300). */
  toleranceSeconds?: number;
};

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
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

/** True iff `${timestamp}.${body}` HMAC matches and (if requested) fresh. */
async function verifySignature(inputs: RevalidateInputs): Promise<boolean> {
  if (inputs.signature === null || inputs.signature === "") return false;
  if (inputs.timestamp === null || inputs.timestamp === "") return false;

  if (inputs.toleranceSeconds !== undefined) {
    const ts = Number(inputs.timestamp);
    const now = inputs.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > inputs.toleranceSeconds) {
      return false;
    }
  }

  const expected = await hmacSha256Hex(
    inputs.secret,
    `${inputs.timestamp}.${inputs.body}`,
  );
  return timingSafeEqualHex(inputs.signature, expected);
}

export async function decideRevalidateRequest(
  inputs: RevalidateInputs,
): Promise<RevalidateVerdict> {
  const valid = await verifySignature(inputs);
  if (!valid) return { kind: "unauthorized" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputs.body);
  } catch {
    return { kind: "bad-request" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "bad-request" };
  }
  const tenantId = (parsed as Record<string, unknown>).tenantId;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { kind: "bad-request" };
  }
  return { kind: "ok", tag: `menu:${tenantId}` };
}
