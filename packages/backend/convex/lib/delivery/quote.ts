import { v } from "convex/values";
import { api } from "../../_generated/api";
import { action } from "../../_generated/server";
import { isWithinServiceHours } from "../menu/serviceHours";
import { listTenantServiceWindows, publicTenantQuery } from "../tenancy";
import type { UberQuoteResult } from "../uberDirect/quote";

/**
 * 2.6-B — `lib/delivery/quote`: the address-first livrabilité orchestration (PRD
 * 40 §2, delivery CONTEXT "Address-first flow", ADR 0010 / 0011).
 *
 * It crosses the Uber Direct [[Quote]] (`lib/uberDirect.requestQuote`, the ONLY
 * module that talks to Uber) with the [[Plage horaire de service]] — KB's source
 * of truth, READ from 2.2 (`isWithinServiceHours` over the tenant's persisted
 * windows). 2.6 only READS the schedule; configuring it stays the 2.2 frontier.
 *
 * Verdict `{ deliverable, fee?, eta?, quoteId?, reason? }`, `reason ∈ {
 * hors_zone, hors_horaire, surge }` (delivery CONTEXT, none invented):
 *  - hors plage horaire ⇒ `hors_horaire` (checkout bloqué, no pre-ordering V1) —
 *    and Uber is NOT called when closed (no wasted quote);
 *  - in-window but Uber refuses ⇒ `hors_zone` / `surge` (delivery mode locked,
 *    only click & collect remains);
 *  - in-window + deliverable ⇒ `deliverable: true` + fee + eta.
 *
 * `recaptureQuoteAtPayment` is the LATCHING re-capture consumed by 2.5: at the
 * "Payer" moment it returns a FRESH quote (a new Uber call, never a cached panier
 * quote) so an anti-surge / stale-fee condition that appeared since the cart is
 * caught before charging. This module does NOT wire the Stripe webhook (the 2.5
 * frontier) — it only EXPOSES the re-capture for 2.5 to call.
 *
 * Tenant isolation (ADR 0010): the actions dispatch their tenant access to the
 * kb_manager-scoped credential blob query (2.6-A) and to `readServiceOpen` (a
 * `tenantQuery` here) BEFORE any Uber HTTP call, so an unauthorized / cross-tenant
 * caller is refused first. Neither reaches the datastore through raw `ctx.db` —
 * service hours go through the sanctioned `listTenantServiceWindows` seam.
 */

/** The livrabilité verdict the front consumes (fee cents, eta minutes). */
export type DeliveryQuoteVerdict =
  | { deliverable: true; fee: number; eta: number; quoteId: string }
  | {
      deliverable: false;
      reason: "hors_zone" | "hors_horaire" | "surge";
    };

/** Validator mirror of `DeliveryQuoteVerdict` for the actions' declared return. */
export const deliveryQuoteVerdict = v.union(
  v.object({
    deliverable: v.literal(true),
    fee: v.number(),
    eta: v.number(),
    quoteId: v.string(),
  }),
  v.object({
    deliverable: v.literal(false),
    reason: v.union(
      v.literal("hors_zone"),
      v.literal("hors_horaire"),
      v.literal("surge"),
    ),
  }),
);

/**
 * PURE cross of the open/closed decision with the Uber quote — no I/O, unit
 * tested. `hors_horaire` wins FIRST (when closed the Uber quote is never even
 * fetched, so `quote` is `null`); when open, the Uber refusal reason
 * (`hors_zone` / `surge`) or the deliverable fee/eta is surfaced verbatim.
 */
export function crossQuoteWithServiceHours(input: {
  isOpen: boolean;
  quote: UberQuoteResult | null;
}): DeliveryQuoteVerdict {
  if (!input.isOpen) return { deliverable: false, reason: "hors_horaire" };
  const quote = input.quote;
  if (quote === null || !quote.ok) {
    // Closed already handled; open + no/failed quote ⇒ surface the Uber reason
    // (default hors_zone when the quote is absent for a non-closed resto).
    return {
      deliverable: false,
      reason: quote === null ? "hors_zone" : quote.reason,
    };
  }
  return {
    deliverable: true,
    fee: quote.fee,
    eta: quote.eta,
    quoteId: quote.quoteId,
  };
}

/**
 * PUBLIC read of the [[Plage horaire de service]] (KB source of truth, 2.2):
 * `true` iff the tenant is currently within an open window (Europe/Paris).
 * Wrapped by `publicTenantQuery` so an anonymous customer on the PWA can drive
 * the address-first chain (`requestDeliveryQuote` → here → Uber Direct) without
 * tripping a kb_manager auth gate — the chain is initiated BEFORE the customer
 * has any session, and "is this resto open right now" is a fact every visitor
 * is allowed to see anyway. The `requireTenant` inside `publicTenantQuery`
 * still throws Forbidden for an unknown/dangling `tenantId`, so cross-tenant
 * probing remains blocked. Reads ONLY through the sanctioned
 * `listTenantServiceWindows` seam scoped to `ctx.tenantId` — never raw
 * `ctx.db` (ADR 0010 / `no-untenanted-query`).
 */
export const readServiceOpen = publicTenantQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx): Promise<boolean> => {
    const windows = await listTenantServiceWindows(ctx, ctx.tenantId);
    return isWithinServiceHours(windows, Date.now());
  },
});

/**
 * Address-first quote: gate on service hours FIRST (Uber is not called when
 * closed), then ask Uber for a quote and cross the two into the verdict.
 */
export const requestDeliveryQuote = action({
  args: { tenantId: v.id("tenants"), address: v.string() },
  returns: deliveryQuoteVerdict,
  handler: async (ctx, args): Promise<DeliveryQuoteVerdict> => {
    // Access gate + 2.2 read. A foreign / unauthorized caller is refused here,
    // before any Uber HTTP call.
    const isOpen = await ctx.runQuery(api.lib.delivery.quote.readServiceOpen, {
      tenantId: args.tenantId,
    });
    if (!isOpen) {
      return crossQuoteWithServiceHours({ isOpen: false, quote: null });
    }

    const quote = await ctx.runAction(api.lib.uberDirect.quote.requestQuote, {
      tenantId: args.tenantId,
      address: args.address,
    });
    return crossQuoteWithServiceHours({ isOpen: true, quote });
  },
});

/**
 * LATCHING re-capture at payment (anti-surge), exposed for 2.5. Returns a FRESH
 * verdict — a new Uber quote at "Payer" time — rather than the panier quote, so a
 * surge / stale fee that appeared since the cart is caught before charging. Same
 * service-hours gate (a resto that closed between cart and payment ⇒
 * `hors_horaire`).
 */
export const recaptureQuoteAtPayment = action({
  args: { tenantId: v.id("tenants"), address: v.string() },
  returns: deliveryQuoteVerdict,
  handler: async (ctx, args): Promise<DeliveryQuoteVerdict> =>
    ctx.runAction(api.lib.delivery.quote.requestDeliveryQuote, {
      tenantId: args.tenantId,
      address: args.address,
    }),
});
