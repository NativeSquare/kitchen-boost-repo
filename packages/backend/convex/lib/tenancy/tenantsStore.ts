import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.9-E + B-TENANT-LIFECYCLE [1/4] — the SANCTIONED data-access seam for the
 * CORE `tenants` table, used by the tenant provisioning wizard
 * (`lib/onboarding/provisioning.ts`) AND the upcoming `tenant.updateSettings`
 * (D5 élargi) / `tenant.activate` (D6) mutations (PRD 70 §3.6 + §4.8).
 *
 * The isolation discipline of ADR 0010: the business module never touches raw
 * `ctx.db` (`no-untenanted-query`) — it routes every tenant read / create /
 * patch through these helpers, which live in the exempt
 * `convex/lib/tenancy/**` path.
 *
 * `tenants` carries no `tenantId` scoping key (it IS the tenant), so the gate
 * is the ROOT wrapper of the caller: every consumer of these helpers runs
 * through `kbAdminMutation` (kb_admin only) — a `kb_manager` / `staff` /
 * `customer` never reaches here. Same exempt-path discipline as
 * `stripeAccountStore` / `deliveriesStore.setTenantUberCustomerId`.
 *
 * Slug uniqueness is the only INVARIANT enforced here on insert:
 * `<slug>.kitchen-boost.fr` is the bootstrap sub-domain (PRD 50 §3), so a
 * duplicate slug would collide on the sub-domain. The `by_slug` index makes
 * the existence check O(1).
 */

/** The fields the wizard supplies to create a fresh tenant row. */
export type NewTenant = {
  slug: string;
  name: string;
  siret: string;
  customDomain?: string;
};

/**
 * The settings-side patch the wizard step 4 + the Paramètres tenant form pass
 * to `tenant.updateSettings` (D5 élargi, PRD 70 §4.8). Every field is
 * optional — callers may patch any subset. The `branding` sub-object is
 * DEEP-MERGED here (passing `{ branding: { logoUrl } }` does NOT erase an
 * existing `primaryColor`); the other top-level fields are shallow-merged
 * via `ctx.db.patch` semantics.
 */
export type TenantSettingsPatch = {
  address?: string;
  phone?: string;
  acceptedModes?: { delivery: boolean; clickAndCollect: boolean };
  branding?: { logoUrl?: string; primaryColor?: string };
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
 * Read one tenant by id (or `null`). The sanctioned `ctx.db.get` for the
 * `tenants` core table — the CALLER (a `kbAdminQuery` / `kbAdminMutation`
 * handler, root-gated) has already proven access, so this is not a tenancy
 * bypass (same exempt-path discipline as the rest of this seam).
 *
 * Centralised here so every store sharing the `tenants` table
 * (`stripeAccountStore`, `deliveriesStore`, `walletPasses`, …) re-uses ONE
 * read primitive — they import this via the module barrel `./index.ts`.
 */
export async function getTenantById(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"tenants"> | null> {
  return ctx.db.get(tenantId);
}

/**
 * List every tenant in the DB. The KB Admin combobox in the shell switcher
 * consumes this via `api.lib.admin.tenants.listAllTenants` (ADR 0014 §7) —
 * the root-gated exposing wrapper. The CALLER (a `kbAdminQuery` handler)
 * has already proven root access, so this is not a tenancy bypass — same
 * exempt-path discipline as `insertTenant` / `getTenantById`.
 *
 * Returned in `_creationTime` ascending order (Convex default). V1 keeps the
 * search filtering in the caller for simplicity (no compound index needed
 * yet) — the switcher only loads on root open and the tenant count stays low
 * in V1 (PRD 70). If the catalog grows past a few hundred a `by_name` /
 * `by_slug` paginated scan can replace this — the type stays the same.
 */
export async function listAllTenants(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"tenants">[]> {
  return ctx.db.query("tenants").collect();
}

/**
 * Insert a fresh tenant in `pending` lifecycle status (PRD 50 §1.1 — a tenant
 * is `pending` until activated, the wizard's final step is out of this slice).
 * The `customDomain` (public face, norm V1) is stamped when supplied; the
 * bootstrap sub-domain is derived from the slug, never stored as a field.
 * Stamps `createdAt`. The CALLER must have asserted slug uniqueness first.
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

/**
 * B-TENANT-LIFECYCLE [1/4] — apply a settings patch to the tenant row, with
 * DEEP-MERGE semantics on the `branding` sub-object so that patching only
 * `logoUrl` keeps an existing `primaryColor` intact (the D5 élargi pivot,
 * PRD 70 §4.8). Top-level fields (`address`, `phone`, `acceptedModes`) are
 * shallow-merged via `ctx.db.patch` — only the keys present in `patch` are
 * written; absent keys are left untouched. Passing an empty patch is a no-op.
 *
 * The business module stays thin: no validation / transition logic here —
 * the upstream mutation `tenant.updateSettings` handles auth (root-only via
 * `kbAdminMutation`), input shape (Convex validators), and audit.
 */
export async function updateTenantSettings(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  patch: TenantSettingsPatch,
): Promise<void> {
  // Build the actual `ctx.db.patch` payload, with branding deep-merged against
  // the current row's value (if any). Touch only the keys the caller supplied
  // so a partial patch never erases a field it didn't mention.
  const next: {
    address?: string;
    phone?: string;
    acceptedModes?: { delivery: boolean; clickAndCollect: boolean };
    branding?: { logoUrl?: string; primaryColor?: string };
  } = {};

  if (patch.address !== undefined) next.address = patch.address;
  if (patch.phone !== undefined) next.phone = patch.phone;
  if (patch.acceptedModes !== undefined)
    next.acceptedModes = patch.acceptedModes;

  if (patch.branding !== undefined) {
    const current = await ctx.db.get(tenantId);
    const existing = current?.branding ?? {};
    next.branding = { ...existing, ...patch.branding };
  }

  // Empty patch → skip the round-trip entirely (no-op contract).
  if (Object.keys(next).length === 0) return;

  await ctx.db.patch(tenantId, next);
}

/**
 * B-TENANT-LIFECYCLE [1/4] — flip the tenant lifecycle to `"active"`.
 *
 * NO transition check here: the upstream mutation `tenant.activate` (D6, PRD
 * 70 §3.6 step 8) is the sole caller and owns the state-machine guard
 * (`pending → active`, audited, root-only). The seam is intentionally dumb so
 * future transitions (e.g. `suspended → active`) can reuse it without a
 * cascade of conditionals here.
 */
export async function activateTenant(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<void> {
  await ctx.db.patch(tenantId, { status: "active" });
}
