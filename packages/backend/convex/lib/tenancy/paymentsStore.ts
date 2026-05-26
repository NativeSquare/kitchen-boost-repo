import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { PaymentStatus } from "../../table/payments";
import type { PricingSnapshot } from "../../table/orders";

/**
 * 2.5-B — the SANCTIONED tenant-scoped data-access seam for the `payments` table
 * (the isolation discipline of ADR 0010).
 *
 * `payments` carries `tenantId`, so business code must reach it ONLY through the
 * tenancy wrappers — never raw `ctx.db.query("payments")` (the
 * `no-untenanted-query` rule, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path (the single sanctioned `ctx.db` site for the
 * table), exactly like `ordersStore.ts` for `orders` or `deliveriesStore.ts` for
 * `deliveries`. The business module `lib/stripe/**` (NOT exempt) calls THESE
 * helpers instead of `ctx.db`.
 *
 * ── Two resolution paths ──────────────────────────────────────────────────────
 *  - tenant-scoped reads (`getTenantPaymentByOrder`) re-check `tenantId` ownership,
 *    so a foreign order id is unreachable;
 *  - the SYSTEM-side webhook resolves a payment from the Stripe-supplied
 *    `paymentIntentId` (`getPaymentByIntentId`), the only handle an incoming
 *    `payment_intent.*` event carries — there is NO user-supplied tenant id to
 *    forge, and the resolved row carries its own `tenantId`, so the webhook can
 *    only ever touch the owning tenant.
 *
 * No delete helper: a tenant's payment history is RETAINED (no hard delete V1).
 */

/** The fields set when a payment row is first created (at PaymentIntent creation). */
export type NewPayment = {
  orderId: Id<"orders">;
  paymentIntentId: string;
  status: PaymentStatus;
  applicationFeeAmountHt: number;
  amountTotal: number;
  pricingSnapshot: PricingSnapshot;
};

/**
 * Insert a new `payments` row for `tenantId` (status from the PaymentIntent
 * Stripe returned, `failedAttempts` 0). Returns the new row id.
 */
export async function insertTenantPayment(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  data: NewPayment,
): Promise<Id<"payments">> {
  const now = Date.now();
  return ctx.db.insert("payments", {
    tenantId,
    orderId: data.orderId,
    paymentIntentId: data.paymentIntentId,
    status: data.status,
    applicationFeeAmountHt: data.applicationFeeAmountHt,
    amountTotal: data.amountTotal,
    pricingSnapshot: data.pricingSnapshot,
    failedAttempts: 0,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * The one payment of a tenant's order (or `null`), keyed `by_order`. Re-checked
 * on `tenantId` so a cross-tenant order id is unreachable.
 */
export async function getTenantPaymentByOrder(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<Doc<"payments"> | null> {
  return ctx.db
    .query("payments")
    .withIndex("by_order", (q) =>
      q.eq("tenantId", tenantId).eq("orderId", orderId),
    )
    .unique();
}

/**
 * Resolve a payment from the Stripe-supplied `paymentIntentId` (or `null`), keyed
 * `by_payment_intent`. SYSTEM-SIDE only (the verified webhook): there is no
 * user-supplied tenant id, and the returned row carries its own `tenantId`, so the
 * webhook is structurally confined to the owning tenant.
 */
export async function getPaymentByIntentId(
  ctx: QueryCtx | MutationCtx,
  paymentIntentId: string,
): Promise<Doc<"payments"> | null> {
  return ctx.db
    .query("payments")
    .withIndex("by_payment_intent", (q) =>
      q.eq("paymentIntentId", paymentIntentId),
    )
    .unique();
}

/** Update a payment's `status` (webhook-driven transitions). Bumps `updatedAt`. */
export async function setPaymentStatus(
  ctx: MutationCtx,
  paymentId: Id<"payments">,
  status: PaymentStatus,
): Promise<void> {
  await ctx.db.patch(paymentId, { status, updatedAt: Date.now() });
}

/**
 * Record one failed `payment_intent.payment_failed`: set status `payment_failed`
 * and increment the attempt counter. Returns the NEW attempt count (the caller
 * decides abandon at the 3rd, PRD 30 §4). Bumps `updatedAt`.
 */
export async function recordPaymentFailure(
  ctx: MutationCtx,
  payment: Doc<"payments">,
): Promise<number> {
  const failedAttempts = payment.failedAttempts + 1;
  await ctx.db.patch(payment._id, {
    status: "payment_failed",
    failedAttempts,
    updatedAt: Date.now(),
  });
  return failedAttempts;
}
