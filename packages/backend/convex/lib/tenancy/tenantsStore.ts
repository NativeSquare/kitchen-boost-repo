import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.9-E — the SANCTIONED data-access seam for the CORE `tenants` table, used by
 * the tenant provisioning wizard (`lib/onboarding/provisioning.ts`). The
 * isolation discipline of ADR 0010: the business module never touches raw
 * `ctx.db` (`no-untenanted-query`) — it routes every tenant create / slug check
 * through these helpers, which live in the exempt `convex/lib/tenancy/**` path.
 *
 * `tenants` carries no `tenantId` scoping key (it IS the tenant), so the gate is
 * the ROOT wrapper of the caller: `provisionTenant` runs through `kbAdminMutation`
 * (kb_admin only) — a `kb_manager` / `staff` / `customer` never reaches here. This
 * mirrors `stripeAccountStore.getTenantById` / `setTenantStripeAccount`.
 *
 * Slug uniqueness is the only INVARIANT enforced here: `<slug>.kitchen-boost.fr`
 * is the bootstrap sub-domain (PRD 50 §3), so a duplicate slug would collide on
 * the sub-domain. The `by_slug` index makes the existence check O(1).
 */

/** The fields the wizard supplies to create a fresh tenant row. */
export type NewTenant = {
  slug: string;
  name: string;
  siret: string;
  customDomain?: string;
};

/** The tenant whose `slug` equals `slug` (or `null`). Keyed on `by_slug`. */
export async function getTenantBySlug(
  ctx: QueryCtx | MutationCtx,
  slug: string,
): Promise<Doc<"tenants"> | null> {
  return ctx.db
    .query("tenants")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

/**
 * Insert a fresh tenant in `pending` lifecycle status (PRD 50 §1.1 — a tenant is
 * `pending` until activated, the wizard's final step is out of this slice). The
 * `customDomain` (public face, norm V1) is stamped when supplied; the bootstrap
 * sub-domain is derived from the slug, never stored as a field. Stamps
 * `createdAt`. The CALLER must have asserted slug uniqueness first.
 */
export async function insertTenant(
  ctx: MutationCtx,
  body: NewTenant,
): Promise<Id<"tenants">> {
  return ctx.db.insert("tenants", {
    slug: body.slug,
    name: body.name,
    siret: body.siret,
    status: "pending",
    customDomain: body.customDomain,
    createdAt: Date.now(),
  });
}
