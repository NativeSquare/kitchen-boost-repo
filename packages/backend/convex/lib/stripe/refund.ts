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
  getTenantOrder,
  getTenantPaymentByOrder,
  insertTenantNotificationEvent,
  logAudit,
  manuallyRefundTenantOrder,
  readCustomerAggregateFields,
  requireTenantOrder,
  setPaymentRefunded,
  tenantAction,
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

// ---------------------------------------------------------------------------
// B-REFUND-PUBLIC-ACTION (#221) — refundOrder: PUBLIC manager-driven refund
// ---------------------------------------------------------------------------

/**
 * B-REFUND-PUBLIC-ACTION (#221) — preflight READ for the public `refundOrder`
 * action. Resolves the order's `paidAt` + `status` + `customerId` + the
 * refundable `pricingSnapshot.total`, tenant-scoped via the sanctioned seam
 * (a foreign `orderId` → `null`). Internal: only the public action consumes it.
 *
 * Returning the resolved fields lets the action AUDIT the refund amount + queue
 * the client `refund_issued` notification WITHOUT the downstream mutation
 * re-reading the order — the mutation is concerned only with writes.
 */
export const readManualRefundContext = internalQuery({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.union(
    v.object({
      status: v.string(),
      paidAt: v.union(v.number(), v.null()),
      customerId: v.id("customers"),
      amountTotal: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: string;
    paidAt: number | null;
    customerId: Id<"customers">;
    amountTotal: number | null;
  } | null> => {
    const order = await getTenantOrder(ctx, args.tenantId, args.orderId);
    if (order === null) return null;
    return {
      status: order.status,
      paidAt: order.paidAt ?? null,
      customerId: order.customerId,
      amountTotal: order.pricingSnapshot?.total ?? null,
    };
  },
});

/**
 * B-REFUND-PUBLIC-ACTION (#221) — the WRITE side of the manager-driven refund,
 * run AFTER the Stripe refund succeeded + the `payments` row is `refunded`. In
 * ONE Convex transaction (atomicity = all-or-nothing):
 *  1. transition the order to TERMINAL `refusée` outside the kitchen state
 *     machine (via the `manuallyRefundTenantOrder` seam, so a `livrée` /
 *     `collectée` / `prête` order can be refunded a posteriori — distinct from
 *     `refuse` which is `nouvelle → refusée` only),
 *  2. queue the client `refund_issued` notification (the actual send is 2.7),
 *  3. AUDIT the refund with the MANAGER actor (`actorUserId` + `actorRole`) +
 *     orderId target + refunded amount in metadata — NOT a `system` row, so the
 *     trail distinguishes a manager-driven refund from the kitchen Refusal /
 *     auto-refund paths (which use `actorRole: "system"`).
 *
 * The order REFUNDABILITY GUARD (paidAt set, not already `refusée`) is enforced
 * in the public action BEFORE the Stripe call — so a re-trigger throws before
 * reaching here. The mutation is therefore unconditional on those fields and
 * focused on the writes only.
 */
export const applyManualRefundOrderSideEffects = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    orderId: v.id("orders"),
    actorUserId: v.id("users"),
    actorRole: v.union(
      v.literal("kb_admin"),
      v.literal("kb_manager"),
      v.literal("staff"),
    ),
    amountRefunded: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // 1 — transition to `refusée` + append the orderEvents row (outside the
    // kitchen state machine, accepts any non-`refusée` state).
    await manuallyRefundTenantOrder(ctx, args.tenantId, args.orderId, {
      actorUserId: args.actorUserId,
      reason: "manual_refund",
    });

    // 2 — queue the client `refund_issued` notification. Resolve through the
    // same tenant-scoped seam (re-checks ownership) to route the customer.
    const order = await requireTenantOrder(ctx, args.tenantId, args.orderId);
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

    // 3 — AUDIT (manager-driven, not system).
    await logAudit(ctx, {
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      action: "order.refundOrder",
      tenantId: args.tenantId,
      targetType: "order",
      targetId: args.orderId,
      metadata: { amountRefunded: args.amountRefunded },
    });

    return null;
  },
});

/**
 * B-REFUND-PUBLIC-ACTION (#221) — PUBLIC `tenantAction` exposed to the KB Admin
 * UI (F-COMMANDES-REFUND, epic #141): the [[KB Manager]] can refund a PAID
 * order's PaymentIntent in FULL (V1 — partial is V2, PRD 30 §5) from any non-
 * terminal-`refusée` state — including the kitchen terminals `livrée` /
 * `collectée` (a litigation post-delivery). Distinct from the kitchen `refuse`
 * (which is `nouvelle → refusée` only via the state-machine guard) and from the
 * system-side `refundOnRefusal` / `refundAbortedOrder` (internal, no actor).
 *
 * ── RBAC (issue #221 acceptance) ─────────────────────────────────────────────
 * `tenantAction({ allow: ["kb_manager"] })` — staff is REFUSED (the kitchen can
 * acknowledge / mark prepared, but cannot refund); KB Admin passes via the
 * wrapper's root override. Any cross-tenant / unauthenticated caller is rejected
 * by the wrapper BEFORE any Stripe call (the gate is the same as `tenantQuery`).
 *
 * ── Order REFUNDABILITY guard (BEFORE the Stripe call) ───────────────────────
 * The action throws `NOT_REFUNDABLE` if `paidAt` is null (no payment to refund)
 * or `status === "refusée"` (already refunded — never double-refund). Both are
 * checked BEFORE the Stripe `POST /refunds`, so a re-trigger never even reaches
 * the network.
 *
 * ── Mechanism (reused from 2.5-C) ────────────────────────────────────────────
 * `runTotalRefund` is the shared internal mechanism: a TOTAL Stripe refund on
 * the resto's connected account (no `refund_application_fee` — KB keeps its
 * commission per Article 3.3) + the `payments` row flipped to `refunded` (+
 * `refundId`) in an internal mutation idempotently. The Idempotency-Key
 * `kb_refund_{orderId}` guards a network retry of the Stripe call itself.
 *
 * ── Audit (manager-driven, NOT system) ───────────────────────────────────────
 * The downstream `applyManualRefundOrderSideEffects` mutation writes the audit
 * row with `actorUserId` + `actorRole` (kb_manager / kb_admin via root) and the
 * refunded amount in metadata — distinguishing this trail from the kitchen
 * Refusal / auto-refund rows (which carry `actorRole: "system"`). Plus the
 * payment-side `payment.refund` row written by the existing `markRefunded`
 * mutation (system-side, recording the Stripe `refundId`).
 *
 * ── Isolation (ADR 0010) ─────────────────────────────────────────────────────
 * `tenantAction` keyed on the EXPLICIT `tenantId`; the preflight query +
 * downstream mutation re-check ownership via the sanctioned `lib/tenancy` seam
 * (a foreign `orderId` resolves to `null` / NOT_FOUND, no cross-tenant write).
 * Identity flows only via the wrapper's `getCurrentActor` (ADR 0011).
 */
export const refundOrder = tenantAction({ allow: ["kb_manager"] })({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args): Promise<{ refunded: boolean }> => {
    // 1 — REFUNDABILITY GUARD (before the Stripe call). A foreign / unknown
    // order id → null → NOT_FOUND (same as the tenancy seam).
    const context = await ctx.runQuery(
      internal.lib.stripe.refund.readManualRefundContext,
      { tenantId: ctx.tenantId, orderId: args.orderId },
    );
    if (context === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Order not found for this tenant.",
      });
    }
    if (context.paidAt === null) {
      throw new ConvexError({
        code: "NOT_REFUNDABLE",
        message:
          "Order is not refundable: no payment recorded (paidAt absent).",
      });
    }
    if (context.status === "refusée") {
      throw new ConvexError({
        code: "NOT_REFUNDABLE",
        message: "Order is not refundable: already refusée (already refunded).",
      });
    }
    if (context.amountTotal === null) {
      // A paid order without a frozen pricingSnapshot is a structural invariant
      // failure (paidAt is set in lockstep with the snapshot at confirmPayment).
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Order has no frozen pricingSnapshot — cannot refund.",
      });
    }

    // 2 — Stripe refund + mark the `payments` row refunded (the shared 2.5-C
    // mechanism). Idempotent: a `payments` row already `refunded` skips the
    // Stripe call (defence-in-depth — the guard above already rejects the
    // refused order, but the `payments` mark is the source of truth).
    const { refunded } = await runTotalRefund(ctx, ctx.tenantId, args.orderId);
    if (!refunded) {
      // Stripe refund didn't fire (no payment row / already refunded) — we
      // already passed the refundability guard, so this is a race / structural
      // inconsistency; surface it rather than silently completing.
      throw new ConvexError({
        code: "REFUND_NOT_APPLIED",
        message:
          "Stripe refund could not be applied (payment row missing or already refunded).",
      });
    }

    // 3 — Transition the order + queue the client notif + AUDIT, in one Convex
    // transaction (manager-driven — NOT the system path).
    await ctx.runMutation(
      internal.lib.stripe.refund.applyManualRefundOrderSideEffects,
      {
        tenantId: ctx.tenantId,
        orderId: args.orderId,
        actorUserId: ctx.actor.userId,
        actorRole: ctx.actor.role,
        amountRefunded: context.amountTotal,
      },
    );

    return { refunded: true };
  },
});
