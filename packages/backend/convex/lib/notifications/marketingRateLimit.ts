/**
 * 2.7-D — the PURE marketing rate limit (PRD 80 §6 "Rate limit marketing global :
 * 3 push marketing / semaine / client tous restos + KB cross-tenant confondus").
 * NO Convex ctx — unit-testable in isolation.
 *
 * The GLOBAL scope is enforced by the CALLER, which reads ALL of the customer's
 * prior CAMPAIGN sends across EVERY tenant + cross-tenant (the `notificationEvents`
 * `by_customer` index spans tenants — the journal carries `tenantId` but the
 * customer is global, ADR 0010). This rule only answers, given those timestamps +
 * `now`: is one MORE marketing send allowed? — over a trailing 7-day sliding
 * window. (The PRD names `@convex-dev/rate-limiter`; that component is a SERVER-
 * side fixed/sliding-window keyed limiter. We derive the count from the existing
 * send journal instead — the schema's `by_customer` index was laid for exactly
 * this "rate-limit reads" purpose (table comment) — so the GLOBAL-across-tenants
 * count is exact and the rule stays a pure, offline-testable seam. No extra Convex
 * component is mounted; the number 3/sem is taken verbatim from the PRD, not
 * invented.)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 3 marketing push / semaine / client, GLOBAL (PRD 80 §6). */
export const RATE_LIMIT_PER_WEEK = 3;

/** The trailing window the limit applies over: 7 days (PRD 80 §6 "/ semaine"). */
export const RATE_WINDOW_MS = 7 * DAY_MS;

/**
 * How many of the customer's prior campaign sends fall inside the trailing window
 * ending at `now` (strictly after `now - 7d`; a send exactly 7 days old or older
 * has aged out).
 */
export function countInWindow(
  campaignSendTimestamps: number[],
  now: number,
): number {
  const cutoff = now - RATE_WINDOW_MS;
  let count = 0;
  for (const ts of campaignSendTimestamps) {
    if (ts > cutoff && ts <= now) count += 1;
  }
  return count;
}

/**
 * Whether ONE more marketing send is allowed for the customer right now: true iff
 * fewer than `RATE_LIMIT_PER_WEEK` of their prior campaign sends are in the
 * trailing 7-day window. The 4th send of the week is therefore blocked.
 */
export function withinRateLimit(
  campaignSendTimestamps: number[],
  now: number,
): boolean {
  return countInWindow(campaignSendTimestamps, now) < RATE_LIMIT_PER_WEEK;
}
