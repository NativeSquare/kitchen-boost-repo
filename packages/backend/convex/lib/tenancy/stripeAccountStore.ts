import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Infer } from "convex/values";
import type { stripeAccountStatus } from "../../table/tenants";

/**
 * 2.5-A — the SANCTIONED tenant-scoped data-access seam for the Stripe Connect
 * fields on the `tenants` table (the isolation discipline of ADR 0010).
 *
 * `tenants` is a core foundation table reached via raw `ctx.db` ONLY from the
 * exempt `convex/lib/tenancy/**` / `convex/table/**` paths; the business module
 * `lib/stripe/**` (NOT exempt, `no-untenanted-query`) writes the Stripe link
 * EXCLUSIVELY through these helpers — never raw `ctx.db.patch(tenantId, …)`.
 * This mirrors `setTenantUberCustomerId` in `deliveriesStore.ts`.
 *
 * Two distinct write moments (PRD 30 §1/§2):
 *  - `setTenantStripeAccount` — stamp the freshly-created connected account id
 *    (`acct_xxx`) and an initial status when the KB Admin generates the
 *    `account_link`. The CALLER (a root `kbAdminMutation` handler) has already
 *    gated access, so this never writes a tenant the actor cannot reach.
 *  - `setTenantStripeStatus` — update ONLY the status, driven by the
 *    `account.updated` webhook (resolved BY `stripeAccountId`, not by a
 *    user-supplied tenant id, so the webhook can never be tricked into writing a
 *    foreign tenant).
 *
 * `getTenantByStripeAccount` resolves the tenant a webhook event targets from the
 * `acct_xxx` it carries (the only identifier Stripe sends), keyed on the
 * `by_stripe_account` index.
 */

export type StripeAccountStatus = Infer<typeof stripeAccountStatus>;

/** Stamp the connected Stripe account id + status onto the tenant's row. */
export async function setTenantStripeAccount(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  stripeAccountId: string,
  stripeStatus: StripeAccountStatus,
): Promise<void> {
  await ctx.db.patch(tenantId, { stripeAccountId, stripeStatus });
}

/** Update only the Stripe status of a tenant (webhook-driven transitions). */
export async function setTenantStripeStatus(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  stripeStatus: StripeAccountStatus,
): Promise<void> {
  await ctx.db.patch(tenantId, { stripeStatus });
}

/**
 * The tenant whose `stripeAccountId` equals `acct` (or `null`). Keyed on the
 * `by_stripe_account` index. The connected account id is unique per tenant, so a
 * webhook resolves to at most one tenant.
 */
export async function getTenantByStripeAccount(
  ctx: QueryCtx | MutationCtx,
  acct: string,
): Promise<Doc<"tenants"> | null> {
  return ctx.db
    .query("tenants")
    .withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", acct))
    .unique();
}

// `getTenantById` was relocated to `tenantsStore.ts` in B-TENANT-LIFECYCLE
// [1/4] so the single sanctioned `ctx.db.get` site for the `tenants` table
// lives next to the rest of that table's seam. Import it via the module
// barrel (`./index.ts`) — the public re-export is unchanged.
