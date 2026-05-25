import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.1-D — the SANCTIONED data-access seam for the `customerOrdersPerTenant` link
 * (read-only here) + the GLOBAL `customers` push-enrollment patch (the MOAT
 * discipline of ADR 0010).
 *
 * `customerOrdersPerTenant` carries `tenantId`, so business code reaches it ONLY
 * through the tenancy wrappers — never raw `ctx.db.query("customerOrdersPerTenant")`
 * (the `no-untenanted-query` rule, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path (the single sanctioned `ctx.db` site for these
 * reads), exactly like `pricingRulesStore.ts` for `pricingRules` or
 * `customerFiche.ts` for the SELF case of the GLOBAL `customers` table. The
 * business modules `lib/customer/segments` + `lib/customer/reachability` (NOT
 * exempt) call THESE helpers instead of `ctx.db`.
 *
 * ── READ-ONLY on the link (reserved 2.3) ──────────────────────────────────────
 * This slice (2.1) NEVER writes `customerOrdersPerTenant` — `totalOrders`,
 * `lastOrderAt`, `ltv` are written exclusively by chantier 2.3 (Orders). So this
 * file exposes only READS of the link; there is deliberately no insert/patch
 * helper for it here.
 *
 * ── MOAT: aggregates only, never a raw customer to a kb_manager ────────────────
 * The link reads are TENANT-SCOPED (keyed on `by_tenant`). To classify a tenant's
 * customers (segment, reachability) the business module needs a few fields from
 * each linked GLOBAL `customers` fiche — `readCustomerAggregateFields` returns a
 * NARROW projection (no email/phone/name/address leaked out as an object; the
 * business module reduces it to COUNTS before exposing anything to the resto).
 */

/** The per-tenant link rows of one tenant, keyed on `by_tenant`. */
export async function listTenantCustomerOrders(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"customerOrdersPerTenant">[]> {
  return ctx.db
    .query("customerOrdersPerTenant")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

/**
 * The NARROW projection of a GLOBAL `customers` fiche the per-tenant aggregates
 * need (segment is computed from the link stats; reachability from these). It is
 * deliberately a value object reduced to COUNTS by the caller — it never crosses
 * the wrapper boundary to a `kb_manager` as-is.
 */
export type CustomerAggregateFields = {
  email?: string;
  phone?: string;
  pushEnrollment?: Doc<"customers">["pushEnrollment"];
};

/**
 * Read the reachability-relevant fields of a customer by id. SANCTIONED read of
 * the GLOBAL `customers` table (no `tenantId` to scope on — the MOAT exemption,
 * ADR 0010); the CALLER has already resolved this `customerId` from a
 * tenant-scoped `customerOrdersPerTenant` row, so the resto only ever reaches the
 * fiches of its OWN customers. Returns `null` if the fiche vanished.
 */
export async function readCustomerAggregateFields(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers">,
): Promise<CustomerAggregateFields | null> {
  const fiche = await ctx.db.get(customerId);
  if (fiche === null) return null;
  return {
    email: fiche.email,
    phone: fiche.phone,
    pushEnrollment: fiche.pushEnrollment,
  };
}

/** A partial push-enrollment patch — each field independently updatable. */
export type PushEnrollmentPatch = {
  walletSerialNumber?: string;
  webPushSubscriptionId?: string;
  walletStatus?: "enrolled" | "not_enrolled" | "revoked";
  webPushStatus?: "enrolled" | "not_enrolled" | "revoked";
  a2hsStatus?: "enrolled" | "not_enrolled" | "revoked";
};

/**
 * Patch the `pushEnrollment` object on a fiche the caller already resolved as its
 * OWN (the `customerId` MUST come from `getOrCreateCustomerFiche` / a self-scoped
 * read keyed on `ctx.actor.userId`). This is a sanctioned `ctx.db.patch` site for
 * the GLOBAL `customers` table (like `patchCustomerConsent`), confined to the
 * push surface — it cannot overwrite identity or personal captation fields.
 *
 * MERGES into the existing object so a single-channel update (web-push expiry,
 * opt-out) does NOT erase the other channels' ids/status (US #16). Only DEFINED
 * patch fields are applied — an `undefined` field (e.g. an unset optional arg)
 * leaves the existing value intact rather than clobbering it.
 */
export async function patchCustomerPushEnrollment(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  patch: PushEnrollmentPatch,
): Promise<void> {
  const fiche = await ctx.db.get(customerId);
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  const merged = { ...(fiche?.pushEnrollment ?? {}), ...defined };
  await ctx.db.patch(customerId, { pushEnrollment: merged });
}
