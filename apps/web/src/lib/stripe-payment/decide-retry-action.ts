/**
 * PWA-S7 (#458) — pure decision returning the retry action for a Stripe
 * payment failure (US 48, acceptance criterion #458 « 1ᵉʳ et 2ᵉ échec →
 * retry inline, 3ᵉ échec → toast + Sentry log »).
 *
 * The decision is stateless — the caller passes the COUNT of attempts so
 * far (1, 2, 3, …) and gets back whether the next thing the UI should
 * surface is an inline retry banner or a fatal toast. The transient retry
 * count is owned by the form (a `useState<number>`); this module is the
 * single source of truth for the "≤2 → inline / ≥3 → fatal" rule.
 */

export type RetryAction = { kind: "inline-retry" } | { kind: "fatal-toast" };

/** Maximum number of inline retries before escalating to a fatal toast. */
export const INLINE_RETRY_THRESHOLD = 2;

/**
 * Decide the retry action for a given attempt count. Defensive: an
 * `attemptsSoFar` of `0` (shouldn't happen — parent counts from `1`)
 * collapses to `inline-retry` so we never hide the retry banner from a
 * confused state.
 */
export function decideRetryAction(attemptsSoFar: number): RetryAction {
  if (attemptsSoFar <= INLINE_RETRY_THRESHOLD) {
    return { kind: "inline-retry" };
  }
  return { kind: "fatal-toast" };
}
