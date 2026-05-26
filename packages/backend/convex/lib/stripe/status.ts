import type { StripeAccountStatus } from "../tenancy";

/**
 * 2.5-A — PURE mapping from a Stripe Connect Express `account` object (the body
 * of an `account.updated` webhook event) to the tenant's `stripeStatus` (PRD 30
 * §1/§2, payment CONTEXT). No DB, no ctx — testable in isolation.
 *
 * The three target statuses (PRD 30 §2): `pending` / `ready` / `disabled`. The
 * mapping uses the DOCUMENTED Stripe Connect account fields (not invented
 * product facts):
 *  - `charges_enabled` / `payouts_enabled` — the account can take charges and
 *    receive payouts (both true ⇒ fully onboarded ⇒ `ready`).
 *  - `requirements.disabled_reason` — set by Stripe when the account is BLOCKED
 *    (a rejected KYC, `rejected.*`, `requirements.past_due`, …). Any disabled
 *    reason ⇒ `disabled`.
 *
 * Decision order (the rejected-KYC guard is FIRST, PRD 30 §1 / issue #35: "un
 * KYC rejected n'amène jamais le paiement à `ready`"):
 *  1. a `disabled_reason` present ⇒ `disabled` — even if charges were briefly
 *     enabled, a blocked/rejected account never reads as `ready`.
 *  2. else `charges_enabled && payouts_enabled` ⇒ `ready`.
 *  3. else ⇒ `pending` (onboarding/KYC still in progress).
 */

/** The slice of a Stripe `account` object this mapping reads. All optional —
 * Stripe may omit fields; an absent flag is treated as `false`. */
export type StripeAccountSnapshot = {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: {
    disabled_reason?: string | null;
  } | null;
};

/** Map a Stripe `account` object to the tenant `stripeStatus`. Pure. */
export function mapStripeAccountToStatus(
  account: StripeAccountSnapshot,
): StripeAccountStatus {
  // 1. Blocked / rejected by Stripe → disabled. Guarded FIRST so a rejected KYC
  //    can never be read as `ready` (PRD 30 §1).
  const disabledReason = account.requirements?.disabled_reason;
  if (disabledReason !== undefined && disabledReason !== null) {
    return "disabled";
  }
  // 2. Fully onboarded: can charge AND payout → ready.
  if (account.charges_enabled === true && account.payouts_enabled === true) {
    return "ready";
  }
  // 3. Otherwise still onboarding / awaiting verification → pending.
  return "pending";
}
