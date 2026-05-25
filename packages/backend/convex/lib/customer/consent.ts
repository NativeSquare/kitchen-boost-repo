import { ConvexError } from "convex/values";
import {
  customerMutation,
  getOrCreateCustomerFiche,
  patchCustomerConsent,
  readActiveCgvVersion,
} from "../tenancy";

/**
 * 2.1-C — Consent at click-Payer + global marketing opt-out + the pure
 * `marketingEligible` rule (PRD 90 §2, ADR 0007, ADR 0005).
 *
 * There is NO consent checkbox (ADR 0007 supersedes the ADR 0001 checkbox): the
 * click on "Payer" IS the consent. `recordConsentAtCheckout` stamps
 * `cgvAcceptedAt` + the `cgvVersionHash` of the ACTIVE CGV version; each later
 * checkout re-stamps the then-current version, which is the "re-consent par
 * achat" pattern (ADR 0005). `optOutMarketing` stamps `marketingOptOutDate`
 * (transactional opt-out stays impossible — contractual basis). There are
 * deliberately NO `consentMarketing` / `consentTransactional` booleans.
 *
 * Both mutations are SELF-SCOPED via `customerMutation`: the handler only ever
 * sees `ctx.actor.userId` (resolved by `getCurrentActor`, ADR 0011), and reaches
 * the GLOBAL `customers` / `cgvVersions` tables ONLY through the sanctioned
 * tenancy seam — never raw `ctx.db` in this business module (ADR 0010 /
 * `no-untenanted-query`).
 */

/** The subset of a customer fiche the marketing-eligibility rule reads. */
export type MarketingEligibilityInput = {
  cgvAcceptedAt?: number;
  marketingOptOutDate?: number;
  lastCheckoutAt?: number;
};

/**
 * PURE business rule (ADR 0005), the seam read by the Notifications engine (2.7):
 *
 *   cgvAcceptedAt IS NOT NULL
 *   AND (marketingOptOutDate IS NULL OR lastCheckoutAt > marketingOptOutDate)
 *
 * i.e. the customer accepted the CGV at least once, and is not currently
 * opted out — a checkout STRICTLY after the opt-out re-opts them in (re-consent
 * par achat). No Convex ctx: trivially unit-testable, reusable everywhere.
 */
export function marketingEligible(input: MarketingEligibilityInput): boolean {
  if (input.cgvAcceptedAt === undefined) return false;
  if (input.marketingOptOutDate === undefined) return true;
  return (
    input.lastCheckoutAt !== undefined &&
    input.lastCheckoutAt > input.marketingOptOutDate
  );
}

/**
 * Record the consent carried by the click on "Payer" (ADR 0007). Stamps the
 * caller's OWN fiche with `cgvAcceptedAt` (now) + the hash of the ACTIVE CGV
 * version. Provisions the fiche on the fly if absent. Throws if no CGV version
 * has been published yet — KB cannot record acceptance of an unknown wording
 * (the real text is injected via `publishCgvVersion`).
 */
export const recordConsentAtCheckout = customerMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const active = await readActiveCgvVersion(ctx);
    if (active === null) {
      throw new ConvexError({
        code: "NO_ACTIVE_CGV",
        message:
          "No active CGV version: publish one via publishCgvVersion before recording consent.",
      });
    }
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    await patchCustomerConsent(ctx, customerId, {
      cgvAcceptedAt: Date.now(),
      cgvVersionHash: active.hash,
    });
  },
});

/**
 * Global marketing opt-out (ADR 0005). Stamps `marketingOptOutDate` on the
 * caller's OWN fiche; the customer becomes marketing-ineligible until a checkout
 * STRICTLY after this date re-consents them. Provisions the fiche on the fly if
 * absent. Transactional messaging is unaffected (contractual basis).
 */
export const optOutMarketing = customerMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    await patchCustomerConsent(ctx, customerId, {
      marketingOptOutDate: Date.now(),
    });
  },
});
