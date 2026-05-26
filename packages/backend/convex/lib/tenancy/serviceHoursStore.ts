import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { ServiceWindow } from "../../table/serviceHours";

/**
 * 2.2-E — the SANCTIONED tenant-scoped data-access seam for the `serviceHours`
 * table ([[Plage horaire de service]], the isolation discipline of ADR 0010).
 *
 * `serviceHours` carries `tenantId`, so business code must reach it ONLY through
 * the tenancy wrappers — never raw `ctx.db.query("serviceHours")` (the
 * `no-untenanted-query` rule, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path (the single sanctioned `ctx.db` site for the
 * table), exactly like `menuStore.ts` for the other menu tables. The business
 * module `lib/menu/serviceHours.ts` (NOT exempt) — and the PUBLIC `isOpenNow`
 * read — call THESE helpers instead of `ctx.db`.
 *
 * V1 models ONE row per tenant carrying the full `windows` list (a SINGLE shared
 * slot for delivery + click & collect, Q40-Q acté 2026-05-24); `set` is an UPSERT
 * keyed on the `by_tenant` index, so the per-tenant uniqueness is enforced
 * applicatively. Every helper is TENANT-SCOPED by construction: it keys on
 * `tenantId` (sourced from `ctx.tenantId` inside a wrapper handler), so a tenant
 * can only ever read/replace its OWN hours.
 */

/** The single service-hours row of `tenantId`, or `null` if none configured. */
export async function getTenantServiceHours(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"serviceHours"> | null> {
  return ctx.db
    .query("serviceHours")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
}

/**
 * The tenant's open windows, or `[]` when no row exists yet — the safe default a
 * non-configured resto reads as "always closed" (no window can ever match).
 */
export async function listTenantServiceWindows(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<ServiceWindow[]> {
  const row = await getTenantServiceHours(ctx, tenantId);
  return row?.windows ?? [];
}

/**
 * Replace `tenantId`'s service hours with `windows` (UPSERT): patch the single
 * existing row, or insert one. Bumps `updatedAt`. The caller has already
 * validated `windows` (`assertServiceWindows`). Keeps exactly one row per tenant.
 */
export async function upsertTenantServiceHours(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  windows: ServiceWindow[],
): Promise<void> {
  const existing = await getTenantServiceHours(ctx, tenantId);
  const updatedAt = Date.now();
  if (existing === null) {
    await ctx.db.insert("serviceHours", { tenantId, windows, updatedAt });
    return;
  }
  await ctx.db.patch(existing._id, { windows, updatedAt });
}
