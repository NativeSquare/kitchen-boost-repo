import { v } from "convex/values";
import {
  customerMutation,
  getOrCreateCustomerFiche,
  patchCustomerCheckoutContact,
} from "../tenancy";

/**
 * PWA-S7 (#458) — `recordCheckoutContact`: stamp the firstName + email + phone
 * the customer submits at the `/checkout` form on the caller's OWN `customers`
 * fiche (US 44 prefill loop, decisions-log Q3 « Recognition UX » — capture at
 * the FIRST checkout, surface at the NEXT). Closes the gap the
 * `decide-prefill.ts` comment in `apps/web/src/lib/checkout-gate/` flagged as
 * « S7 scope, see lib/customer/consent.ts » — `recordConsentAtCheckout` only
 * stamps the CGV hash, not the PII trio.
 *
 * Re-submitting from a later checkout OVERWRITES the previous PII — the
 * customer can correct a typo on their next order; the fiche reflects the
 * latest submit (same robustness as `updateAddress`).
 *
 * Self-scoped via `customerMutation`: the handler only ever sees
 * `ctx.actor.userId` (resolved by `getCurrentActor`, ADR 0011), and reaches the
 * GLOBAL `customers` table ONLY through the sanctioned tenancy seam
 * (`patchCustomerCheckoutContact`) — never raw `ctx.db` in this business module
 * (ADR 0010 / `no-untenanted-query`). Tolerates a missing fiche (provisions one
 * on the fly via `getOrCreateCustomerFiche`) so the chain stays robust if a
 * future refactor collapses `getOrCreateCurrentCustomer` + this mutation.
 *
 * `tenantId` is an explicit wrapper argument (the customer is a guest eater on
 * a given resto's PWA — see `customerMutation` factory). It is NOT stamped on
 * the GLOBAL fiche; per-tenant link lives on `customerOrdersPerTenant` (written
 * by Orders chantier).
 */
export const recordCheckoutContact = customerMutation({
  args: {
    firstName: v.string(),
    email: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, { firstName, email, phone }): Promise<void> => {
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    await patchCustomerCheckoutContact(ctx, customerId, {
      firstName,
      email,
      phone,
    });
  },
});
