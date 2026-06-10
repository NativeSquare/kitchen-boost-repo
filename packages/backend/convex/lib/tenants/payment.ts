import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { customerQuery, getTenantById } from "../tenancy";

/**
 * PWA-S7 (#458) — `paymentContextForCustomer`: the connected-account
 * snapshot the PWA `/checkout` needs to initialise Stripe Elements with
 * `loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, { stripeAccount })`
 * (US 46, decisions-log Q6 « direct charge on the resto's connected
 * account »).
 *
 * Two narrow fields surfaced — `stripeAccountId` (the `acct_…`) + the
 * `stripeStatus` (the onboarding lifecycle gate) — so the front can:
 *  - mount Elements on the right connected account, OR
 *  - render a « Le resto n'accepte pas encore les paiements en ligne »
 *    fallback when `stripeStatus !== "ready"` (the backend `createPaymentIntent`
 *    refuses such a tenant anyway, but we want to avoid mounting Stripe
 *    for nothing).
 *
 * Wrapper: `customerQuery` (NOT `publicTenantQuery` / not the unauth
 * `resolution.byId`). Why : the connected `acct_…` is NOT a CGU-published
 * piece of data — it surfaces ONLY to authenticated customers actively
 * on the resto's PWA `/checkout`. The `customerMutation` factory rejects
 * non-customer callers (PRO, anonymous), so the surface is structurally
 * minimal — only an authenticated eater can read it. The information
 * itself is non-sensitive (just a public id), but limiting its read
 * surface follows the same projection discipline as `resolution.ts` +
 * `branding.ts` (NEVER surface `Doc<"tenants">` to the wire).
 *
 * Tenant-not-found returns `null` so the front renders the same
 * « Resto non disponible » degraded state as the rest of the PWA chain
 * (no exception across the wire).
 */

export type TenantPaymentContextProjection = {
  tenantId: Id<"tenants">;
  /** Connected `acct_…` to pass to `loadStripe(pk, { stripeAccount })`. */
  stripeAccountId: string | null;
  /** Stripe onboarding lifecycle gate from the `account.updated` webhook. */
  stripeStatus: "pending" | "ready" | "disabled" | null;
};

export const forCheckout = customerQuery({
  args: {},
  returns: v.object({
    tenantId: v.id("tenants"),
    stripeAccountId: v.union(v.string(), v.null()),
    stripeStatus: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("disabled"),
      v.null(),
    ),
  }),
  handler: async (ctx): Promise<TenantPaymentContextProjection> => {
    const row = await getTenantById(ctx, ctx.tenantId);
    if (row === null) {
      // The `customerQuery` wrapper does not gate on the tenant existing
      // (that's the role of `publicTenantQuery`); a dangling cookie /
      // deleted tenant should surface to the front without an exception.
      return {
        tenantId: ctx.tenantId,
        stripeAccountId: null,
        stripeStatus: null,
      };
    }
    return {
      tenantId: ctx.tenantId,
      stripeAccountId: row.stripeAccountId ?? null,
      stripeStatus: row.stripeStatus ?? null,
    };
  },
});
