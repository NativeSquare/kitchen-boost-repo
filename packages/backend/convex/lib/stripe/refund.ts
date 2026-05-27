import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import {
  channelAvailabilityFrom,
  planTransactionalSends,
} from "../notifications";
import {
  abortTenantOrder,
  getPaymentByIntentId,
  getTenantById,
  getTenantPaymentByOrder,
  insertTenantNotificationEvent,
  logAudit,
  readCustomerAggregateFields,
  requireTenantOrder,
  setPaymentRefunded,
} from "../tenancy";
import { withIdempotence } from "../webhooks";

/**
 * 2.5-C/D — Refund: the payment-domain MECHANISM behind a TOTAL, IMMEDIATE refund
 * (PRD 30 §5, payment CONTEXT "Refund"/"Cmd avortée", ADR 0010). Two entry points,
 * both creating a Stripe `POST /refunds` on the resto's CONNECTED account (a direct
 * charge is refunded ON the connected account, exactly as it was created there —
 * payment CONTEXT). Partial refund is V2 — V1 is always total.
 *
 *  - `refundOnRefusal(tenantId, orderId)` — the Orders [[Refusal]] (#18) is the
 *    TRIGGER, this is the mechanism (payment CONTEXT: "Orders est le trigger,
 *    Payment fournit la mécanique"). The `refuse` mutation already transitioned the
 *    order to `refusée` and queued the client `refund_issued` notification; here we
 *    only run the Stripe refund + flip the local `payments` row. KB does NOT refund
 *    its commission (Article 3.3 — no `refund_application_fee`).
 *  - `refundAbortedOrder(tenantId, orderId)` — the [[Cmd avortée]] auto-refund the
 *    delivery course-failure (#48 Cas A) triggers: the payment `succeeded` but the
 *    Uber course could not be created post-payment. Same total refund, PLUS pull the
 *    order OUT of KB Orders (`nouvelle → refusée`, so the resto never works it — the
 *    order is NEVER transmitted) and emit the client `refund_issued` push. Distinct
 *    from the standard Refund (which follows a resto Refusal); coherent with the
 *    strict payment ↔ delivery coupling V1 (if delivery can't be created, undo all).
 *  - `applyChargeRefunded(eventId, paymentIntentId, refundId)` — RECONCILE a refund
 *    that originated OUTSIDE KB (e.g. the resto refunds in its Stripe Dashboard): the
 *    `charge.refunded` webhook flips the local row to `refunded`. Wrapped in
 *    `withIdempotence(ctx, "stripe", eventId, …)` so a redelivered event is a clean
 *    no-op (Stripe delivers at-least-once — no double mark).
 *
 * ── Action ↔ mutation split (STACK §2.3) ──────────────────────────────────────
 * The Stripe network call lives in the ACTIONs (the KB-wide `STRIPE_SECRET_KEY` env
 * var — not per-tenant, so no envelope encryption here). The DB writes (mark
 * `refunded`, transition the order, queue the notif, audit) run in internal mutations
 * ORDERED AFTER the Stripe call. No Stripe SDK: the documented REST endpoint is
 * called over `fetch` with a form-encoded body (same pattern as `account.ts` /
 * `paymentIntent.ts`).
 *
 * ── Audit (issue #49: "tout refund est audité via logAudit") ──────────────────
 * Every refund mark writes one `auditLog` row. These are SYSTEM-SIDE writes (no
 * human actor — the trigger is a state machine / webhook), so the row carries
 * `actorRole: "system"` with no `actorUserId` (the audit field is optional for
 * system writes). It records the tenant + the refunded payment + the Stripe refund id.
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * SYSTEM-SIDE: these are INTERNAL (never exposed publicly) and carry NO user-supplied
 * tenant id that could be forged — the triggers (`refuse`, the course executor, the
 * verified webhook) pass a tenant id they already resolved, and every read/write
 * re-checks ownership through the sanctioned `lib/tenancy` seam (a foreign `orderId`
 * resolves to no payment ⇒ clean no-op; `requireTenantOrder` / `transitionTenantOrder`
 * throw NOT_FOUND for a foreign id). No raw `ctx.db` in this module except the single
 * `payments.refundId` patch via the seam-resolved row. The cross-tenant assertion is
 * the structural no-op test, like the sibling `confirmPaymentSucceeded` /
 * `createCourseOnPaymentConfirmed`.
 */

const STRIPE_API = "https://api.stripe.com/v1";

const missingSecret = () =>
  new ConvexError({
    code: "MISCONFIGURED",
    message: "STRIPE_SECRET_KEY is not configured.",
  });

/** Encode a flat record as application/x-www-form-urlencoded (Stripe wire format). */
function form(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, value] of Object.entries(params)) usp.set(k, value);
  return usp.toString();
}

/** The fields the refund action needs, resolved structurally for `(tenant, order)`. */
type RefundContext = {
  paymentIntentId: string;
  /** The resto's connected account the direct charge (and thus the refund) lives on. */
  stripeAccountId: string;
  /** Already refunded ⇒ the action skips the Stripe call (idempotent). */
  alreadyRefunded: boolean;
};

// ---------------------------------------------------------------------------
// Internal query + mutations (the DB side of the action ↔ mutation split)
// ---------------------------------------------------------------------------

/**
 * Resolve the refund context for one of `tenantId`'s orders, or `null` when there is
 * nothing to refund (no payment, or the resto has no connected account). Tenant-scoped
 * via the sanctioned seam (a foreign `orderId` → null, no cross-tenant read).
 */
export const getRefundContext = internalQuery({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.union(
    v.object({
      paymentIntentId: v.string(),
      stripeAccountId: v.string(),
      alreadyRefunded: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<RefundContext | null> => {
    const payment = await getTenantPaymentByOrder(
      ctx,
      args.tenantId,
      args.orderId,
    );
    if (payment === null) return null;
    const tenant = await getTenantById(ctx, args.tenantId);
    if (tenant === null || tenant.stripeAccountId === undefined) return null;
    return {
      paymentIntentId: payment.paymentIntentId,
      stripeAccountId: tenant.stripeAccountId,
      alreadyRefunded: payment.status === "refunded",
    };
  },
});

/**
 * Mark `tenantId`'s order payment `refunded` (+ `refundId`) and AUDIT the refund. A
 * row already `refunded` is a no-op (returns `false`) so a re-trigger never re-audits
 * or re-stamps. Tenant-scoped via the seam (the row is resolved by the tenant + order).
 */
export const markRefunded = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    orderId: v.id("orders"),
    refundId: v.string(),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const payment = await getTenantPaymentByOrder(
      ctx,
      args.tenantId,
      args.orderId,
    );
    if (payment === null || payment.status === "refunded") {
      return { applied: false };
    }
    await setPaymentRefunded(ctx, payment._id, args.refundId);
    // System-side refund (no human actor) — total refund of the order's payment; the
    // KB commission is NOT refunded (Article 3.3).
    await logAudit(ctx, {
      actorRole: "system",
      action: "payment.refund",
      tenantId: args.tenantId,
      targetType: "payment",
      targetId: payment._id,
      metadata: {
        refundId: args.refundId,
        paymentIntentId: payment.paymentIntentId,
      },
    });
    return { applied: true };
  },
});

/**
 * 2.5-D + 2.3-fix (#108) — the ORDER side of the [[Cmd avortée]] auto-refund, in ONE
 * transaction: pull the order OUT of KB Orders (terminal `refusée` — so the resto
 * never works it; the order is NEVER transmitted) and queue the client
 * `refund_issued` notification (the actual send is 2.7).
 *
 * Uses the system-side `abortTenantOrder` seam (#108), which handles BOTH aborted-
 * order shapes the strict payment↔delivery coupling produces and COMPENSATES the
 * MOAT stats when (and only when) the order had already been counted:
 *  - the gated DELIVERY order still `en attente de paiement` (course failed before
 *    it was ever transmitted, Cas A) — never `nouvelle`, never counted ⇒ the abort
 *    only flips it to `refusée`, no stat to revert;
 *  - an already-confirmed order (`nouvelle`/worked, e.g. incident-after-pickup Cas C)
 *    ⇒ its previously-posted `customerOrdersPerTenant` increment is reverted.
 * Idempotent: an order already `refusée` (a re-trigger) is left as-is — no second
 * notif, no double compensation.
 */
export const abortOrderForRefund = internalMutation({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.object({ aborted: v.boolean() }),
  handler: async (ctx, args): Promise<{ aborted: boolean }> => {
    const order = await requireTenantOrder(ctx, args.tenantId, args.orderId);
    // Pull it out (terminal `refusée`) from ANY non-terminal state, compensating the
    // stats if they were posted. A no-op (already refused) emits no second notif.
    const { aborted } = await abortTenantOrder(
      ctx,
      args.tenantId,
      args.orderId,
      { reason: "autre" },
    );
    if (!aborted) return { aborted: false };

    // Client "livraison impossible, vous êtes remboursé" — the refund_issued
    // transactional trigger (PRD 80 §1 trigger 6). Reachability READ from 2.1.
    const fields = await readCustomerAggregateFields(ctx, order.customerId);
    const availability = channelAvailabilityFrom(fields ?? {});
    const sends = planTransactionalSends("refund_issued", availability);
    for (const send of sends) {
      await insertTenantNotificationEvent(ctx, args.tenantId, {
        customerId: order.customerId,
        trigger: "refund_issued",
        category: send.category,
        channel: send.channel,
        status: "queued",
      });
    }
    return { aborted: true };
  },
});

/**
 * `charge.refunded` webhook reconciliation: a refund originated outside KB (resto's
 * Stripe Dashboard) — flip the LOCAL row to `refunded` idempotently. Wrapped in
 * `withIdempotence` so a redelivered event is a clean no-op (no double mark). The
 * tenant is resolved structurally from the Stripe-supplied `paymentIntentId` (the
 * `payments` row carries `tenantId`), never a user-supplied id (ADR 0010).
 */
export const applyChargeRefunded = internalMutation({
  args: {
    eventId: v.string(),
    paymentIntentId: v.string(),
    refundId: v.string(),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    let applied = false;
    await withIdempotence(ctx, "stripe", args.eventId, async () => {
      const payment = await getPaymentByIntentId(ctx, args.paymentIntentId);
      // Unknown intent OR already refunded → nothing to reconcile (still marked
      // processed so a replay of this stray event is a clean no-op).
      if (payment === null || payment.status === "refunded") return;
      await setPaymentRefunded(ctx, payment._id, args.refundId);
      await logAudit(ctx, {
        actorRole: "system",
        action: "payment.refund.webhook",
        tenantId: payment.tenantId,
        targetType: "payment",
        targetId: payment._id,
        metadata: {
          refundId: args.refundId,
          paymentIntentId: payment.paymentIntentId,
        },
      });
      applied = true;
    });
    return { applied };
  },
});

// ---------------------------------------------------------------------------
// Internal actions (the Stripe network side of the split)
// ---------------------------------------------------------------------------

/**
 * Create the TOTAL Stripe refund for the order's PaymentIntent on the resto's
 * connected account, then mark the local row `refunded`. Pure mechanism — the
 * caller handles the order state + notification. Idempotent: a row already `refunded`
 * (re-trigger) skips the Stripe call entirely.
 */
async function runTotalRefund(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<{ refunded: boolean }> {
  const context = await ctx.runQuery(
    internal.lib.stripe.refund.getRefundContext,
    { tenantId, orderId },
  );
  // Nothing to refund (no payment / no connected account) OR already refunded.
  if (context === null || context.alreadyRefunded) return { refunded: false };

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw missingSecret();

  // TOTAL refund: only `payment_intent`, no `amount` (partial = V2), and NO
  // `refund_application_fee` (KB keeps its commission — Article 3.3). Created ON the
  // resto's connected account, where the direct charge lives. An idempotency key
  // guards a double-refund on a network retry of THIS refund.
  const res = await fetch(`${STRIPE_API}/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Account": context.stripeAccountId,
      "Idempotency-Key": `kb_refund_${orderId}`,
    },
    body: form({ payment_intent: context.paymentIntentId }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message;
    throw new ConvexError({
      code: "STRIPE_ERROR",
      message: `Stripe refund error: ${err ?? res.status}`,
    });
  }

  const refundId = json.id as string;
  const { applied } = await ctx.runMutation(
    internal.lib.stripe.refund.markRefunded,
    { tenantId, orderId, refundId },
  );
  return { refunded: applied };
}

export const refundOnRefusal = internalAction({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.object({ refunded: v.boolean() }),
  handler: async (ctx, args): Promise<{ refunded: boolean }> =>
    runTotalRefund(ctx, args.tenantId, args.orderId),
});

export const refundAbortedOrder = internalAction({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.object({ refunded: v.boolean() }),
  handler: async (ctx, args): Promise<{ refunded: boolean }> => {
    // First the Stripe refund + local mark; only if it actually refunded do we pull
    // the order out of KB Orders + push the client (a re-trigger refunds nothing and
    // skips the abort, so the order is refused + the client pushed exactly once).
    const { refunded } = await runTotalRefund(ctx, args.tenantId, args.orderId);
    if (refunded) {
      await ctx.runMutation(internal.lib.stripe.refund.abortOrderForRefund, {
        tenantId: args.tenantId,
        orderId: args.orderId,
      });
    }
    return { refunded };
  },
});
