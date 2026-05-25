import type { Condition } from "@packages/shared/pricing";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { pricingAction, pricingCondition } from "../../table/pricingRules";
import {
  deleteTenantPricingRule,
  getTenantPricingRule,
  insertTenantPricingRule,
  listTenantPricingRules,
  patchTenantPricingRuleBody,
  setTenantPricingRuleActive,
  tenantMutation,
  tenantQuery,
} from "../tenancy";
import { findConditionContradiction } from "./contradictions";

/**
 * 2.4-B — `pricingRules` tenant-scoped CRUD (PRD 35 §1, ADR 0013, ADR 0010).
 *
 * Every function goes through a tenancy wrapper (`tenantQuery` / `tenantMutation`,
 * `allow: ["kb_manager"]`; a `kb_admin` passes via the root override, `staff`
 * does not). The handlers never touch raw `ctx.db` — they reach the table only
 * through the sanctioned `lib/tenancy/pricingRulesStore` seam, scoped to
 * `ctx.tenantId`, so a resto can only ever read/modify its OWN rules
 * (`no-untenanted-query` + the cross-tenant fuzz suite enforce this).
 *
 * Backend-only (ADR 0013): NO UI here. The rule shape is the engine's
 * (`@packages/shared/pricing`, #29), so a persisted row feeds the evaluator as-is.
 *
 * `create` / `update` REFUSE a rule whose conditions are contradictory (PRD 35
 * edge case) — a dead rule that could never match is a configuration bug, caught
 * at save rather than silently ignored at evaluation.
 */

/** The contradiction guard, throwing a typed `ConvexError` the front can branch on. */
function assertSatisfiable(conditions: Condition[]): void {
  const reason = findConditionContradiction(conditions);
  if (reason !== null) {
    throw new ConvexError({
      code: "CONTRADICTORY_CONDITIONS",
      message: reason,
    });
  }
}

/** List all of the calling tenant's rules (active + inactive). */
export const list = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<Doc<"pricingRules">[]> =>
    listTenantPricingRules(ctx, ctx.tenantId),
});

/**
 * Create a rule on the calling tenant. Created ACTIVE by default. Refuses
 * contradictory conditions. Returns the new rule id.
 */
export const create = tenantMutation()({
  args: {
    conditions: v.array(pricingCondition),
    action: pricingAction,
  },
  handler: async (ctx, args): Promise<Id<"pricingRules">> => {
    assertSatisfiable(args.conditions);
    return insertTenantPricingRule(ctx, ctx.tenantId, {
      conditions: args.conditions,
      action: args.action,
    });
  },
});

/**
 * Replace the conditions + action of one of the tenant's rules. Refuses
 * contradictory conditions, and a `ruleId` not owned by the calling tenant.
 */
export const update = tenantMutation()({
  args: {
    ruleId: v.id("pricingRules"),
    conditions: v.array(pricingCondition),
    action: pricingAction,
  },
  handler: async (ctx, args): Promise<void> => {
    const existing = await getTenantPricingRule(ctx, ctx.tenantId, args.ruleId);
    if (existing === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Pricing rule not found for this tenant.",
      });
    }
    assertSatisfiable(args.conditions);
    await patchTenantPricingRuleBody(ctx, ctx.tenantId, args.ruleId, {
      conditions: args.conditions,
      action: args.action,
    });
  },
});

/** Activate / deactivate a rule WITHOUT deleting it. */
export const setActive = tenantMutation()({
  args: { ruleId: v.id("pricingRules"), active: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    const existing = await getTenantPricingRule(ctx, ctx.tenantId, args.ruleId);
    if (existing === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Pricing rule not found for this tenant.",
      });
    }
    await setTenantPricingRuleActive(
      ctx,
      ctx.tenantId,
      args.ruleId,
      args.active,
    );
  },
});

/**
 * Hard-delete one of the tenant's rules. (Named `remove`, not `delete`, which is
 * a reserved word; the public CRUD verb is "delete".)
 */
export const remove = tenantMutation()({
  args: { ruleId: v.id("pricingRules") },
  handler: async (ctx, args): Promise<void> => {
    const existing = await getTenantPricingRule(ctx, ctx.tenantId, args.ruleId);
    if (existing === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Pricing rule not found for this tenant.",
      });
    }
    await deleteTenantPricingRule(ctx, ctx.tenantId, args.ruleId);
  },
});
