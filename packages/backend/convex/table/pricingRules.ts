import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";

/**
 * 2.4-B — `pricingRules` (PRD 35 §1 / §7, pricing CONTEXT, ADR 0013).
 *
 * A tenant-scoped, configurable rule that determines who pays what on the
 * delivery fee. The shape MIRRORS the pure engine in `@packages/shared/pricing`
 * (#29): a list of `conditions` (the 6 V1 condition variants, AND-ed) + one
 * `action` (the 3 V1 action variants). The validators below are the source of
 * truth for BOTH the persisted row and the CRUD mutation args, kept structurally
 * aligned with the engine's `Condition` / `Action` discriminated unions.
 *
 * TENANT-SCOPED (carries `tenantId`, ADR 0010): every read/write goes through
 * the tenancy wrappers (`tenantQuery` / `tenantMutation`, `allow: ["kb_manager"]`)
 * and the `no-untenanted-query` rule applies; the module ships a cross-tenant
 * fuzz test. Indexed `by_tenant` (the only access path — a resto only ever sees
 * its OWN rules).
 *
 * NO order/priority field by design: among matching rules the engine picks the
 * winner DETERMINISTICALLY (the one minimising the client fee, Q35-Q2 / ADR
 * 0013), so there is nothing for the resto to order. No product limit either
 * (a generous technical ceiling only — acté 2026-05-25, PRD 35 notes).
 */

/** Comparison operator for the numeric/threshold conditions (engine: `ComparisonOperator`). */
export const comparisonOperator = v.union(v.literal("gte"), v.literal("lte"));

/** Days of the week, as used by `jour_semaine` (engine: `JourSemaine`). */
export const jourSemaine = v.union(
  v.literal("LU"),
  v.literal("MA"),
  v.literal("ME"),
  v.literal("JE"),
  v.literal("VE"),
  v.literal("SA"),
  v.literal("DI"),
);

/**
 * The 6 V1 conditions (closed list, AND-ed). Structurally identical to the
 * engine's `Condition` union so a persisted row deserialises straight into the
 * engine input. Retired V1: `mode_livraison`, `distance_livraison_km` (PRD §1).
 */
export const pricingCondition = v.union(
  v.object({
    kind: v.literal("total_panier"),
    operator: comparisonOperator,
    valueCents: v.number(),
  }),
  v.object({
    kind: v.literal("premiere_cmd_client"),
    value: v.boolean(),
  }),
  v.object({
    kind: v.literal("nombre_cmds_client"),
    operator: comparisonOperator,
    value: v.number(),
  }),
  v.object({
    kind: v.literal("plage_horaire"),
    start: v.string(), // "HH:MM"
    end: v.string(), // "HH:MM"
  }),
  v.object({
    kind: v.literal("jour_semaine"),
    days: v.array(jourSemaine),
  }),
  v.object({
    kind: v.literal("contient_item"),
    category: v.optional(v.string()),
    itemId: v.optional(v.string()),
  }),
);

/**
 * The 3 V1 actions (closed list — the share the resto absorbs; the client pays
 * the remainder, capped at the gross cost). Mirrors the engine's `Action` union.
 * `livraison_offerte_client` is deliberately ABSENT — KB never subsidises
 * delivery in V1 (Q35-Q1).
 */
export const pricingAction = v.union(
  v.object({ kind: v.literal("livraison_offerte_resto") }),
  v.object({
    kind: v.literal("frais_livraison_part_resto_fixe"),
    valueCents: v.number(),
  }),
  v.object({
    kind: v.literal("frais_livraison_part_resto_pourcentage_panier"),
    percent: v.number(),
  }),
);

export type PricingCondition = Infer<typeof pricingCondition>;
export type PricingAction = Infer<typeof pricingAction>;

export const pricingRules = defineTable({
  tenantId: v.id("tenants"),
  conditions: v.array(pricingCondition),
  action: pricingAction,
  active: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_tenant", ["tenantId"]);
