/**
 * PWA-S9b (#461) — `wallet-bridge` module API.
 *
 * The PWA edge middleware (`apps/web/src/proxy.ts`) consumes:
 *  - `decideWalletBridgeInterception(input)` → pure verdict for the
 *    `?wallet=<serial>` deep-link interception (US 39 / 40 / 41 / 42,
 *    decisions-log Q5).
 *  - The IO adapters (cookie set, 307-redirect to the clean URL) are wired
 *    by the middleware itself — splitting "decide" from "perform" lets
 *    vitest pin every branch in node env.
 *
 * Types are re-exported so the client `<WalletBridgeRunner>` + any RSC
 * reading the pending serial cookie share ONE source of truth for the
 * verdict shape — same convention as the `tenant-resolver` module API.
 *
 * The bridge-pending cookie name is surfaced as a CONSTANT so the IO sites
 * (middleware, RSC, client component, API route) all reference the same
 * literal — change the cookie name in ONE place to roll it forward.
 */
export {
  decideWalletBridgeInterception,
  type DecideWalletBridgeInterceptionInput,
  type WalletBridgeVerdict,
} from "./decide-wallet-bridge";

/**
 * The short-lived cookie the PWA edge middleware sets when it intercepts a
 * well-formed `?wallet=<serial>`. The client `<WalletBridgeRunner>` reads
 * it on first mount, calls `signIn("wallet-bridge", { serial })`, then asks
 * the `/api/wallet-bridge/clear` route to delete the cookie so a second
 * hit (refresh, back button) does NOT re-trigger the bridge. `__Host-` is
 * mandatory: it pins the cookie to the resolved host (no `Domain` allowed),
 * so a bridge-pending cookie minted on resto A can never leak to resto B —
 * same isolation rule as `__Host-kb_tenant` (ADR 0008 amendment 2026-05-25).
 */
export const WALLET_BRIDGE_PENDING_COOKIE = "__Host-kb_wallet_bridge_pending";

/**
 * Cookie lifetime for `__Host-kb_wallet_bridge_pending` (5 minutes). The
 * window is intentionally narrow — the client runs the `signIn` chain
 * immediately on mount, so any cookie still present after a few minutes is
 * either a stalled tab or a tab the user backgrounded; we'd rather expire
 * the bridge than keep a stale serial waiting indefinitely. The cookie is
 * ALSO actively cleared by `/api/wallet-bridge/clear` after a successful
 * signIn, so the TTL is the FALLBACK lifetime, not the nominal one.
 */
export const WALLET_BRIDGE_COOKIE_MAX_AGE_S = 60 * 5;
