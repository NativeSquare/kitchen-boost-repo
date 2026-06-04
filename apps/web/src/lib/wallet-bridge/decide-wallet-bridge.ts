/**
 * PWA-S9b (#461) — `decideWalletBridgeInterception` — the PURE decision function
 * the PWA edge middleware (`apps/web/src/proxy.ts`) consults to handle the
 * `?wallet=<serialNumber>` deep-link query parameter embedded in the Wallet
 * pass back-of-pass URL (decisions-log Q5 « Bridge identité au tap deep-link »,
 * US 39 / 40 / 41 / 42).
 *
 * The middleware is deliberately thin: it reads the request URL, asks THIS
 * function what to do, then performs the IO (set the
 * `__Host-kb_wallet_bridge_pending` cookie, 307-redirect to the clean URL).
 * Splitting the decision from the perform keeps every branch vitest-pinnable
 * in node env without spinning up Next.js or the edge runtime — same shape as
 * `decideTenantResolution` (#449).
 *
 * Verdict is a discriminated union so the IO layer can `switch (verdict.kind)`
 * without peeking at the strings:
 *  - `intercept` — well-formed serial, set the bridge cookie + redirect.
 *  - `strip-only` — the `wallet` param is present but malformed (empty, too
 *    short, illegal chars, too long); the URL is still cleaned to avoid
 *    leaving a stale param in the address bar, but NO cookie is set (no
 *    bridge attempt — graceful, issue AC « Serial invalide / non-trouvé →
 *    pas de crash »).
 *  - `passthrough` — no `wallet` param at all, the middleware does nothing.
 */

/**
 * Serial format guard — the serials we mint (2.8-A `generatePass`) are opaque
 * `[A-Za-z0-9_-]+` strings. The min length floor (8) raises the cost of a
 * probing attacker that would otherwise enumerate plausible short serials;
 * the max length ceiling (128) prevents a giant URL from blowing up the
 * cookie / downstream Convex argument validator. The same regex IS applied
 * in `auth.ts` `WalletBridge.authorize` so a probing serial that survives this
 * front-side strip is still rejected closed-form by the backend.
 */
const SERIAL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SERIAL_MIN_LENGTH = 8;
const SERIAL_MAX_LENGTH = 128;

/** The query-parameter name the Wallet pass back-of-pass URL embeds. */
const WALLET_QUERY_PARAM = "wallet";

export type DecideWalletBridgeInterceptionInput = {
  /**
   * The full request URL as the middleware sees it. The function parses it
   * with the standard `URL` constructor — no extraction logic of its own —
   * so behaviour matches every spec-compliant URL parser (including the
   * one Next's edge runtime uses).
   */
  url: string;
};

export type WalletBridgeVerdict =
  | {
      kind: "intercept";
      /** The validated, well-formed serial — safe to forward to Convex. */
      serial: string;
      /**
       * The URL with EVERY `wallet` param stripped (kept other params
       * untouched). The middleware 307-redirects to this URL after setting
       * the bridge cookie.
       */
      cleanUrl: string;
    }
  | {
      kind: "strip-only";
      /**
       * The URL with the malformed `wallet` param stripped. The middleware
       * still redirects to it (so the address bar is clean), but does NOT
       * set the bridge cookie — there is no plausible serial to bridge.
       */
      cleanUrl: string;
    }
  | { kind: "passthrough" };

/**
 * Validate a candidate serial against the format guard. Returns the serial
 * verbatim if OK, or `null` if it should be treated as malformed.
 */
function validateSerial(candidate: string | null): string | null {
  if (candidate === null) return null;
  const trimmed = candidate.trim();
  if (trimmed === "") return null;
  if (trimmed.length < SERIAL_MIN_LENGTH) return null;
  if (trimmed.length > SERIAL_MAX_LENGTH) return null;
  if (!SERIAL_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Strip every occurrence of the `wallet` query parameter from a parsed URL
 * (delete on `URLSearchParams` removes all values for the key) and return the
 * URL's string form. Other params survive verbatim, including their order.
 */
function buildCleanUrl(parsed: URL): string {
  parsed.searchParams.delete(WALLET_QUERY_PARAM);
  return parsed.toString();
}

/**
 * Decide what the middleware should do with the request URL:
 *  - No `wallet` param → `passthrough`.
 *  - `wallet` param present + well-formed (matches `[A-Za-z0-9_-]+`, between
 *    8 and 128 chars) → `intercept` with `{ serial, cleanUrl }`.
 *  - `wallet` param present but malformed (empty, whitespace-only, too short,
 *    illegal chars, too long) → `strip-only` with `{ cleanUrl }`.
 *
 * Multiple `wallet=` values: take the FIRST one (the only one that can
 * plausibly come from a back-of-pass URL); `URLSearchParams.delete` strips
 * them ALL from the clean URL so the redirect target carries none.
 *
 * The function is total — every input URL the `URL` constructor accepts maps
 * to exactly one verdict. A malformed URL string (which the `URL` constructor
 * would throw on) is the caller's responsibility; the middleware always
 * passes the `request.nextUrl.toString()` which is guaranteed parseable.
 */
export function decideWalletBridgeInterception(
  input: DecideWalletBridgeInterceptionInput,
): WalletBridgeVerdict {
  const parsed = new URL(input.url);
  const rawSerial = parsed.searchParams.get(WALLET_QUERY_PARAM);
  if (rawSerial === null) {
    return { kind: "passthrough" };
  }
  const validated = validateSerial(rawSerial);
  const cleanUrl = buildCleanUrl(parsed);
  if (validated === null) {
    return { kind: "strip-only", cleanUrl };
  }
  return { kind: "intercept", serial: validated, cleanUrl };
}
