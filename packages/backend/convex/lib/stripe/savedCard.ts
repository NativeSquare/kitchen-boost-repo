import { ConvexError, v } from "convex/values";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { action, internalMutation } from "../../_generated/server";
import { pricingSnapshot } from "../../table/orders";
import {
  customerQuery,
  getOrCreateCustomerFiche,
  getTenantById,
  getTenantOrder,
  insertTenantPayment,
  readCustomerFicheByUser,
  setCustomerSavedCard,
} from "../tenancy";
import { APPLICATION_FEE_AMOUNT_HT, APPLICATION_FEE_AMOUNT_TTC } from "./fees";

/**
 * 2.5-D — saved card REUSABLE CROSS-RESTO (Stripe Customer cross-tenant, PRD 30,
 * payment CONTEXT "Stripe Customer (cross-tenant)" / "Sauvegarde carte"). The
 * mechanism POC #6 validated (`docs/spikes/poc-6-stripe-clone.md`): a card the
 * client saves once is reusable at every KitchenBoost resto in ONE tap, WITHOUT
 * re-entry and WITHOUT KB ever being merchant of record.
 *
 * ── Platform Customer, NOT tenant (payment CONTEXT) ───────────────────────────
 * The Stripe `Customer` (`cus_…`) lives at the KB PLATFORM account level (not on
 * any connected account), so it is stored on the GLOBAL `customers` MOAT fiche
 * (which carries no `tenantId`, ADR 0010 documented exemption) alongside the saved
 * PaymentMethod (`pm_…`). `saveCard` create-or-reuses that platform Customer and
 * attaches the front-collected PaymentMethod to it.
 *
 * ── Clone-then-direct-charge (POC #6) ─────────────────────────────────────────
 * At checkout on resto X, `payWithSavedCard` CLONES the platform PaymentMethod to
 * resto X's connected account —
 *   `stripe.paymentMethods.create({ customer, payment_method }, { stripeAccount })`
 * (REST: `POST /payment_methods` with the `Stripe-Account: acct_resto` header +
 * `customer` + `payment_method`) — then creates a confirmed direct-charge
 * PaymentIntent ON that same connected account with the CLONED card and the
 * IMMUTABLE `application_fee_amount = 240` cts TTC (Q30-Q1), charging the
 * `pricingSnapshot.total` RECEIVED from Pricing (#20) verbatim (NO `on_behalf_of` —
 * a destination-charge param never used at KB). The ORIGINAL platform PaymentMethod
 * is left INTACT (never detached/deleted), so the next order at resto Y re-clones
 * it. The local `payments` row is persisted exactly like the bare-card flow (2.5-B).
 *
 * ── Action ↔ mutation split (STACK §2.3) ──────────────────────────────────────
 * The Stripe network calls live in the ACTIONs (the KB-wide `STRIPE_SECRET_KEY`
 * env var — NOT per-tenant ⇒ no envelope encryption here). The DB writes (stamp the
 * saved card on the fiche, insert the `payments` row) run in internal mutations
 * ORDERED AFTER the Stripe calls. No Stripe SDK: the documented REST endpoints are
 * called over `fetch` with form-encoded bodies (same pattern as `account.ts` /
 * `paymentIntent.ts`).
 *
 * ── Scope self (the client clones/charges only for its OWN order, ADR 0010) ────
 * Both actions are CUSTOMER-scoped and re-assert ownership through a customer-scoped
 * guard query (which inherits the action's auth identity) BEFORE any Stripe call:
 *  - `saveCard` resolves the caller's OWN fiche (keyed on `ctx.actor.userId`);
 *  - `payWithSavedCard` re-asserts (via `assertOwnSavedCardOrder`) the order belongs
 *    to the CALLER's own fiche AND is still awaiting payment, the resto's Stripe
 *    account is `ready`, and the caller HAS a saved card — so a non-customer /
 *    cross-tenant / foreign-order / card-less caller is refused before reaching
 *    Stripe (the mandatory cross-tenant fuzz drives `assertOwnSavedCardOrder`).
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

/** Parse a Stripe JSON response, throwing a typed error on a non-2xx status. */
async function stripeJson(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message;
    throw new ConvexError({
      code: "STRIPE_ERROR",
      message: `Stripe API error: ${err ?? res.status}`,
    });
  }
  return json;
}

// ---------------------------------------------------------------------------
// saveCard — platform Customer create/reuse + attach + store on the OWN fiche
// ---------------------------------------------------------------------------

/**
 * Customer-scoped guard: resolve the caller's OWN saved-card context — the existing
 * platform `stripeCustomerId` (if any). Self-scoped (`customerQuery`): a PRO / cross-
 * tenant / anonymous caller is rejected by the wrapper. Keyed on `ctx.actor.userId`,
 * so it can only ever read the caller's own fiche.
 */
export const readOwnSavedCardCustomer = customerQuery({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    stripeCustomerId: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
  ): Promise<{ userId: Id<"users">; stripeCustomerId: string | null }> => {
    const fiche = await readCustomerFicheByUser(ctx, ctx.actor.userId);
    return {
      userId: ctx.actor.userId,
      stripeCustomerId: fiche?.stripeCustomerId ?? null,
    };
  },
});

/**
 * INTERNAL — stamp the platform Customer + saved PaymentMethod on the CALLER's OWN
 * fiche (resolved by `userId`, provisioning a minimal fiche if none exists —
 * silent provisioning, ADR 0008). System-side write ordered AFTER the Stripe calls.
 * Self-scoped by `userId`; reaches the global `customers` table only through the
 * sanctioned `lib/tenancy` seam.
 */
export const recordSavedCard = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    savedPaymentMethodId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const customerId = await getOrCreateCustomerFiche(ctx, args.userId);
    await setCustomerSavedCard(ctx, customerId, {
      stripeCustomerId: args.stripeCustomerId,
      savedPaymentMethodId: args.savedPaymentMethodId,
    });
    return null;
  },
});

export const saveCard = action({
  args: {
    // Consumed by the customer wrapper of the guard query (scope self).
    tenantId: v.id("tenants"),
    // The PaymentMethod the front collected via a Stripe SetupIntent (front, hors
    // scope) — KB attaches it to the platform Customer and saves it for reuse.
    paymentMethodId: v.string(),
  },
  handler: async (ctx, args): Promise<{ stripeCustomerId: string }> => {
    // Re-assert customer scope + read the caller's OWN userId + existing platform
    // Customer. The identity is resolved by the guard query's `getCurrentActor`
    // (ADR 0011) and returned here — the action never touches `ctx.auth` directly.
    // A PRO / anonymous caller is refused by the wrapper, before any Stripe call.
    const { userId, stripeCustomerId: existing } = await ctx.runQuery(
      api.lib.stripe.savedCard.readOwnSavedCardCustomer,
      { tenantId: args.tenantId },
    );

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw missingSecret();

    // 1. Reuse the platform Customer if the fiche already has one, else create one
    //    at the KB PLATFORM account level (NO `Stripe-Account` header — it must NOT
    //    live on a connected account; the clone happens later, per resto).
    let stripeCustomerId = existing;
    if (stripeCustomerId === null) {
      const created = await stripeJson(
        await fetch(`${STRIPE_API}/customers`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form({}),
        }),
      );
      stripeCustomerId = created.id as string;
    }

    // 2. Attach the front-collected PaymentMethod to the platform Customer (still on
    //    the KB account, NO `Stripe-Account` header).
    await stripeJson(
      await fetch(
        `${STRIPE_API}/payment_methods/${args.paymentMethodId}/attach`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form({ customer: stripeCustomerId }),
        },
      ),
    );

    // 3. Persist on the caller's OWN fiche (DB write OUT of the action).
    await ctx.runMutation(internal.lib.stripe.savedCard.recordSavedCard, {
      userId,
      stripeCustomerId,
      savedPaymentMethodId: args.paymentMethodId,
    });

    return { stripeCustomerId };
  },
});

// ---------------------------------------------------------------------------
// payWithSavedCard — clone the platform PM to the resto + direct charge it
// ---------------------------------------------------------------------------

/** The saved-card payment context, resolved self-scoped for `(tenant, order)`. */
type SavedCardContext = {
  /** The resto's connected account the clone + direct charge live on. */
  stripeAccountId: string;
  /** The platform Stripe Customer (`cus_…`) the saved card is attached to. */
  stripeCustomerId: string;
  /** The platform PaymentMethod (`pm_…`) to clone to the connected account. */
  savedPaymentMethodId: string;
};

/**
 * Customer-scoped guard: assert the order belongs to the CALLER's OWN fiche at
 * `ctx.tenantId` and is still `en attente de paiement`, the resto's Stripe account
 * is `ready`, AND the caller HAS a saved card (platform Customer + PaymentMethod).
 * Returns the connected `stripeAccountId` + the platform `stripeCustomerId` /
 * `savedPaymentMethodId` the action clones + charges. Self-scoped (`customerQuery`):
 * a PRO / cross-tenant / anonymous caller is rejected by the wrapper; a foreign-
 * customer order reads as not-owned and throws here — so a customer only ever
 * clones/charges for its OWN order (ADR 0010, the cross-tenant fuzz target).
 */
export const assertOwnSavedCardOrder = customerQuery({
  args: { orderId: v.id("orders") },
  returns: v.object({
    stripeAccountId: v.string(),
    stripeCustomerId: v.string(),
    savedPaymentMethodId: v.string(),
  }),
  handler: async (ctx, args): Promise<SavedCardContext> => {
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
    if (
      fiche.stripeCustomerId === undefined ||
      fiche.savedPaymentMethodId === undefined
    ) {
      throw new ConvexError({
        code: "NO_SAVED_CARD",
        message: "No saved card for this customer.",
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
    return {
      stripeAccountId: tenant.stripeAccountId,
      stripeCustomerId: fiche.stripeCustomerId,
      savedPaymentMethodId: fiche.savedPaymentMethodId,
    };
  },
});

/**
 * INTERNAL — persist the `payments` row after the saved-card direct charge cleared
 * on the resto's connected account. Identical contract to the bare-card flow's
 * `recordPaymentIntent` (2.5-B): one row per order, commission stored HT, through
 * the sanctioned `lib/tenancy` seam. System-side write ordered AFTER the Stripe call.
 */
export const recordSavedCardPayment = internalMutation({
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

export const payWithSavedCard = action({
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
    // Scope self + resto readiness + saved-card presence, BEFORE any Stripe call.
    // A non-owner / cross-tenant / not-ready / card-less caller is refused here.
    const { stripeAccountId, stripeCustomerId, savedPaymentMethodId } =
      await ctx.runQuery(api.lib.stripe.savedCard.assertOwnSavedCardOrder, {
        tenantId: args.tenantId,
        orderId: args.orderId,
      });

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw missingSecret();

    // 1. CLONE the platform PaymentMethod to the resto's connected account (POC #6):
    //    `paymentMethods.create({ customer, payment_method }, { stripeAccount })`.
    //    The ORIGINAL platform PaymentMethod stays intact (never detached/deleted).
    const cloned = await stripeJson(
      await fetch(`${STRIPE_API}/payment_methods`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // Run in the resto's connected-account context — the clone lives there.
          "Stripe-Account": stripeAccountId,
        },
        body: form({
          customer: stripeCustomerId,
          payment_method: savedPaymentMethodId,
        }),
      }),
    );
    const clonedPaymentMethodId = cloned.id as string;

    // 2. DIRECT CHARGE on the resto's connected account with the CLONED card. Same
    //    immutable fee (240 TTC, Q30-Q1) + verbatim pricing total as the bare-card
    //    flow; confirmed immediately (the card is already on file). NO `on_behalf_of`
    //    (direct charge). Idempotency key guards a double-charge on retry.
    const intent = await stripeJson(
      await fetch(`${STRIPE_API}/payment_intents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Account": stripeAccountId,
          "Idempotency-Key": `kb_pi_${args.orderId}`,
        },
        body: form({
          amount: String(args.pricingSnapshot.total),
          currency: "eur",
          application_fee_amount: String(APPLICATION_FEE_AMOUNT_TTC),
          payment_method: clonedPaymentMethodId,
          confirm: "true",
          "metadata[kb_order_id]": args.orderId,
          "metadata[kb_tenant_id]": args.tenantId,
        }),
      }),
    );

    const paymentIntentId = intent.id as string;
    const clientSecret = intent.client_secret as string;
    const status =
      intent.status === "processing" || intent.status === "succeeded"
        ? intent.status
        : "requires_payment_method";

    // DB write OUT of the action, ordered after the Stripe calls.
    await ctx.runMutation(
      internal.lib.stripe.savedCard.recordSavedCardPayment,
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
