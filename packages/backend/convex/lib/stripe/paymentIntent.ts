import { ConvexError, v } from "convex/values";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { action, internalMutation } from "../../_generated/server";
import { pricingSnapshot } from "../../table/orders";
import {
  customerQuery,
  getTenantById,
  getTenantOrder,
  insertTenantPayment,
  readCustomerFicheByUser,
} from "../tenancy";
import { APPLICATION_FEE_AMOUNT_HT, APPLICATION_FEE_AMOUNT_TTC } from "./fees";

/**
 * 2.5-B — `createPaymentIntent`: the DIRECT-CHARGE PaymentIntent creation (PRD 30
 * §3, payment CONTEXT, STACK §2.3). The single backend entry the PWA checkout
 * calls to start a payment.
 *
 * ── Direct charge on the resto's account (payment CONTEXT) ────────────────────
 * The PaymentIntent is created IN THE CONNECTED ACCOUNT'S CONTEXT via the
 * `Stripe-Account: acct_resto` header — the resto is merchant of record and bears
 * the Stripe acceptance fees NATIVELY (an intrinsic property of the direct charge;
 * NOT `on_behalf_of`, which is a destination-charge param never used at KB). KB
 * takes the IMMUTABLE `application_fee_amount = 240` cts TTC (Q30-Q1). Apple/Google
 * Pay are authorised at the PaymentIntent level via `automatic_payment_methods`.
 *
 * Payment NEVER recomputes the total: it charges the `pricingSnapshot.total`
 * RECEIVED from the pricing engine (#20). A Stripe idempotency key guards against
 * a double-charge on a client/network retry.
 *
 * ── Action ↔ mutation split (STACK §2.3) ──────────────────────────────────────
 * The Stripe network call lives in this ACTION (the KB-wide `STRIPE_SECRET_KEY`
 * env var, no envelope encryption — it is not per-tenant). The DB write (the
 * `payments` row) runs in an internal mutation ORDERED AFTER the Stripe call. No
 * Stripe SDK: the documented REST endpoint is called over `fetch` with a
 * form-encoded body (same pattern as `account.ts`).
 *
 * ── Scope self (the client pays only its OWN order) ───────────────────────────
 * Before any Stripe call, the action re-asserts (via the customer-scoped guard
 * query `assertOwnPendingOrder`, which inherits this action's auth identity) that
 * the order belongs to the CALLER's own customer fiche AND is still awaiting
 * payment, and that the resto's Stripe account is `ready`. A non-customer / cross-
 * tenant / foreign-order caller is refused there, before reaching Stripe.
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

/**
 * Customer-scoped guard: assert the order belongs to the CALLER's OWN fiche at
 * `ctx.tenantId` and is still `en attente de paiement`, and that the resto's
 * Stripe account is `ready` (a direct charge requires a chargeable connected
 * account). Returns the connected `stripeAccountId` the action charges on. Self-
 * scoped (`customerQuery`): a PRO / cross-tenant / anonymous caller is rejected by
 * the wrapper; a foreign-customer order reads as not-owned and throws here.
 */
export const assertOwnPendingOrder = customerQuery({
  args: { orderId: v.id("orders") },
  returns: v.object({ stripeAccountId: v.string() }),
  handler: async (ctx, args): Promise<{ stripeAccountId: string }> => {
    const fiche = await readCustomerFicheByUser(ctx, ctx.actor.userId);
    if (fiche === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "No customer fiche for this order.",
      });
    }
    const order = await getTenantOrder(ctx, ctx.tenantId, args.orderId);
    if (order === null || order.customerId !== fiche._id) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Order not found for this customer.",
      });
    }
    if (order.status !== "en attente de paiement") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: `Order is "${order.status}", expected "en attente de paiement".`,
      });
    }

    const tenant = await getTenantById(ctx, ctx.tenantId);
    if (
      tenant === null ||
      tenant.stripeAccountId === undefined ||
      tenant.stripeStatus !== "ready"
    ) {
      throw new ConvexError({
        code: "STRIPE_NOT_READY",
        message: "The restaurant's Stripe account is not ready for payments.",
      });
    }
    return { stripeAccountId: tenant.stripeAccountId };
  },
});

/**
 * INTERNAL — persist the `payments` row after the PaymentIntent was created on the
 * resto's connected account. System-side write ordered AFTER the Stripe call
 * (action ↔ mutation split). Through the sanctioned `lib/tenancy` seam.
 */
export const recordPaymentIntent = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    orderId: v.id("orders"),
    paymentIntentId: v.string(),
    status: v.union(
      v.literal("requires_payment_method"),
      v.literal("processing"),
      v.literal("succeeded"),
    ),
    amountTotal: v.number(),
    pricingSnapshot,
  },
  returns: v.id("payments"),
  handler: async (ctx, args): Promise<Id<"payments">> =>
    insertTenantPayment(ctx, args.tenantId, {
      orderId: args.orderId,
      paymentIntentId: args.paymentIntentId,
      status: args.status,
      applicationFeeAmountHt: APPLICATION_FEE_AMOUNT_HT,
      amountTotal: args.amountTotal,
      pricingSnapshot: args.pricingSnapshot,
    }),
});

export const createPaymentIntent = action({
  args: {
    tenantId: v.id("tenants"),
    orderId: v.id("orders"),
    // The pricing trace computed by #20 — Payment charges `total` verbatim.
    pricingSnapshot,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ paymentIntentId: string; clientSecret: string }> => {
    // Scope self + resto readiness, BEFORE any Stripe call. Inherits the caller's
    // auth identity; a non-owner / cross-tenant / not-ready resto is refused here.
    const { stripeAccountId } = await ctx.runQuery(
      api.lib.stripe.paymentIntent.assertOwnPendingOrder,
      { tenantId: args.tenantId, orderId: args.orderId },
    );

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw missingSecret();

    // Direct charge on the resto's connected account. The amount is the total
    // RECEIVED from pricing (#20), never recomputed. `application_fee_amount` is
    // the immutable KB commission (Q30-Q1). `automatic_payment_methods` authorises
    // Apple/Google Pay via the Payment Element. NO `on_behalf_of` (direct charge).
    const res = await fetch(`${STRIPE_API}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Direct charge: run the request in the resto's connected-account context.
        "Stripe-Account": stripeAccountId,
        // Guard against a double-charge on a retry of the SAME order's payment.
        "Idempotency-Key": `kb_pi_${args.orderId}`,
      },
      body: form({
        amount: String(args.pricingSnapshot.total),
        currency: "eur",
        application_fee_amount: String(APPLICATION_FEE_AMOUNT_TTC),
        "automatic_payment_methods[enabled]": "true",
        "metadata[kb_order_id]": args.orderId,
        "metadata[kb_tenant_id]": args.tenantId,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error as { message?: string } | undefined)?.message;
      throw new ConvexError({
        code: "STRIPE_ERROR",
        message: `Stripe API error: ${err ?? res.status}`,
      });
    }

    const paymentIntentId = json.id as string;
    const clientSecret = json.client_secret as string;
    const status =
      json.status === "processing" || json.status === "succeeded"
        ? json.status
        : "requires_payment_method";

    // DB write OUT of the action, ordered after the Stripe call.
    await ctx.runMutation(
      internal.lib.stripe.paymentIntent.recordPaymentIntent,
      {
        tenantId: args.tenantId,
        orderId: args.orderId,
        paymentIntentId,
        status,
        amountTotal: args.pricingSnapshot.total,
        pricingSnapshot: args.pricingSnapshot,
      },
    );

    return { paymentIntentId, clientSecret };
  },
});
