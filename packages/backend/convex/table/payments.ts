import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";
import { pricingSnapshot } from "./orders";

/**
 * 2.5-B — `payments` (PRD 30 §3/§4, payment CONTEXT, STACK §3, ADR 0010). The
 * single LOCAL source of truth of a Stripe direct-charge payment: one row per
 * order's PaymentIntent on the resto's connected account.
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * Carries `tenantId` and is TENANT-SCOPED: every read/write goes through the
 * tenancy wrappers and reaches this table ONLY through the sanctioned
 * `lib/tenancy/paymentsStore` seam — never raw `ctx.db` in the `lib/stripe`
 * business module (`no-untenanted-query`, 1.x-H). The module ships a cross-tenant
 * fuzz suite.
 *
 * ── Direct charge (payment CONTEXT) ───────────────────────────────────────────
 * KB is NOT merchant of record: the PaymentIntent lives on the resto's connected
 * account (`Stripe-Account: acct_resto`); KB takes a fixed `application_fee_amount`
 * (240 cts TTC, immutable V1 — Q30-Q1). The commission is stored HERE in HT (200
 * cts, `applicationFeeAmountHt`) for CGI-compliant reporting (Q30-Q7). Payment
 * never recomputes the total — `amountTotal` + `pricingSnapshot` are the values
 * RECEIVED from the pricing engine (#20) and CHARGED verbatim.
 *
 * ── Resolution keys ───────────────────────────────────────────────────────────
 * Indexed `by_order` (one payment per order) AND `by_payment_intent` (the webhook
 * resolves its tenant from the Stripe-supplied `paymentIntentId`, the only handle
 * an incoming `payment_intent.*` event carries besides the connected account).
 */

/**
 * The PaymentIntent lifecycle as KB tracks it locally (payment CONTEXT). The four
 * Stripe `payment_intent` states KB cares about, plus `refunded` (a later refund —
 * #49 — flips the row here). NOT invented: these mirror Stripe's own state names.
 */
export const paymentStatus = v.union(
  v.literal("requires_payment_method"),
  v.literal("processing"),
  v.literal("succeeded"),
  v.literal("payment_failed"),
  v.literal("refunded"),
);

export type PaymentStatus = Infer<typeof paymentStatus>;

export const payments = defineTable({
  tenantId: v.id("tenants"),
  // FK → the order this payment settles (#18 / 2.3). One payment per order.
  orderId: v.id("orders"),
  // The Stripe PaymentIntent id on the resto's connected account (`pi_…`).
  paymentIntentId: v.string(),
  status: paymentStatus,
  // KB commission stored HT (200 cts) for reporting — Stripe charges the TTC
  // amount (240 cts) as `application_fee_amount` (Q30-Q7).
  applicationFeeAmountHt: v.number(),
  // The total CHARGED to the client, in centimes — the amount RECEIVED from the
  // pricing engine (#20), never recomputed by Payment.
  amountTotal: v.number(),
  // The pricing trace received from #20, frozen onto the order at confirmation.
  pricingSnapshot,
  // Count of distinct `payment_intent.payment_failed` events: 3 max then abandon
  // (PRD 30 §4) — no order is ever created/confirmed on an abandoned payment.
  failedAttempts: v.number(),
  // Set by a later refund (#49) when the resto refuses the order (PRD 30 §5).
  refundId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  // One payment per order (the confirmation resolves the order from here).
  .index("by_order", ["tenantId", "orderId"])
  // The webhook resolves the tenant + order from the Stripe `paymentIntentId`.
  .index("by_payment_intent", ["paymentIntentId"]);
