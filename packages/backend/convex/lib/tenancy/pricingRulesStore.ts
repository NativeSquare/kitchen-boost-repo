import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { PricingAction, PricingCondition } from "../../table/pricingRules";

/**
 * 2.4-B — the SANCTIONED tenant-scoped data-access seam for the `pricingRules`
 * table (the MOAT discipline of ADR 0010).
 *
 * `pricingRules` carries `tenantId`, so business code must reach it ONLY through
 * the tenancy wrappers — never raw `ctx.db.query("pricingRules")` (the
 * `no-untenanted-query` rule, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path (the single sanctioned `ctx.db` site for the
 * table), exactly like `customerFiche.ts` for the GLOBAL `customers` fiche or
 * `lib/crypto/credentials.ts` for per-tenant secrets. The business module
 * `lib/pricing/**` (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * Every helper is TENANT-SCOPED by construction: it takes the caller's resolved
 * `tenantId` (sourced from `ctx.tenantId` inside a tenant wrapper handler) and
 * keys reads on the `by_tenant` index, and re-checks `tenantId` ownership before
 * any mutation of a row fetched by id — so a `ruleId` from another tenant can
 * never be read, patched or deleted from here.
 */

/** Fields a rule carries beyond its identity + timestamps. */
export type PricingRuleBody = {
  conditions: PricingCondition[];
  action: PricingAction;
};

/** List ALL rules of one tenant (active + inactive), keyed on `by_tenant`. */
export async function listTenantPricingRules(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"pricingRules">[]> {
  return ctx.db
    .query("pricingRules")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

/**
 * Read one rule by id ONLY IF it belongs to `tenantId`; else `null`. The
 * tenant-ownership re-check is what makes a cross-tenant `ruleId` unreachable
 * even though Convex ids are not themselves tenant-scoped.
 */
export async function getTenantPricingRule(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  ruleId: Id<"pricingRules">,
): Promise<Doc<"pricingRules"> | null> {
  const row = await ctx.db.get(ruleId);
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/**
 * Like `getTenantPricingRule`, but throws a typed `NOT_FOUND` `ConvexError` when
 * the rule is absent OR belongs to another tenant — so a foreign `ruleId` is
 * indistinguishable from a missing one (no cross-tenant existence oracle). The
 * single ownership gate the write mutations share.
 */
export async function requireTenantPricingRule(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  ruleId: Id<"pricingRules">,
): Promise<Doc<"pricingRules">> {
  const row = await getTenantPricingRule(ctx, tenantId, ruleId);
  if (row === null) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Pricing rule not found for this tenant.",
    });
  }
  return row;
}

/** Insert a new ACTIVE rule for `tenantId`. Returns the new row id. */
export async function insertTenantPricingRule(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  body: PricingRuleBody,
): Promise<Id<"pricingRules">> {
  const now = Date.now();
  return ctx.db.insert("pricingRules", {
    tenantId,
    conditions: body.conditions,
    action: body.action,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Patch the conditions + action of a rule the caller already resolved as owned
 * by `tenantId` (the `ruleId` MUST come from `getTenantPricingRule`). Bumps
 * `updatedAt`. Throws if the row vanished or is foreign (defence in depth).
 */
export async function patchTenantPricingRuleBody(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  ruleId: Id<"pricingRules">,
  body: PricingRuleBody,
): Promise<void> {
  await requireTenantPricingRule(ctx, tenantId, ruleId);
  await ctx.db.patch(ruleId, {
    conditions: body.conditions,
    action: body.action,
    updatedAt: Date.now(),
  });
}

/** Flip a rule's `active` flag (owned by `tenantId`). Bumps `updatedAt`. */
export async function setTenantPricingRuleActive(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  ruleId: Id<"pricingRules">,
  active: boolean,
): Promise<void> {
  await requireTenantPricingRule(ctx, tenantId, ruleId);
  await ctx.db.patch(ruleId, { active, updatedAt: Date.now() });
}

/** Hard-delete a rule owned by `tenantId`. */
export async function deleteTenantPricingRule(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  ruleId: Id<"pricingRules">,
): Promise<void> {
  await requireTenantPricingRule(ctx, tenantId, ruleId);
  await ctx.db.delete(ruleId);
}
