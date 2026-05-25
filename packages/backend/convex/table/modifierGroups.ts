import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";

/**
 * 2.2-A — `modifierGroups` (REUSABLE) (PRD 10 §6, client-ordering CONTEXT
 * "Modifier", ADR 0010).
 *
 * A group of choices applied to an item when added to the cart, on the Uber
 * Manager model (Q10-Q8a acté 2026-05-24):
 *  - `minSelect` ≥ 0 — 0 = optional, ≥ 1 = mandatory (the PWA disables
 *    "Ajouter au panier" until satisfied).
 *  - `maxSelect` ≥ 1 — 1 = single-choice, > 1 = multi-choice.
 *  - `options` — each `{ label, priceDelta }`, `priceDelta` in CENTIMES and ≥ 0
 *    (positive or null; modifiers never DISCOUNT in V1, client-ordering CONTEXT).
 *
 * REUSABLE (acté 2026-05-25, Uber Eats model): a group is created once and
 * attached to N items via the `menuItemModifierGroups` link table — it does NOT
 * "belong" to an item. There is therefore no `itemId` here. Modifiers are never
 * "parfums" (each flavour is a distinct item — feedback_no_modifier_parfum).
 *
 * TENANT-SCOPED (carries `tenantId`, ADR 0010): every read/write goes through
 * the tenancy wrappers, the `no-untenanted-query` rule applies, and the module
 * ships cross-tenant fuzz coverage. Indexed `by_tenant` (the resto's groups).
 */

/**
 * One selectable option of a modifier group. `priceDelta` is in CENTIMES and
 * ≥ 0 (an upcharge or free; never negative in V1). The validators here are the
 * source of truth reused by the later CRUD slice.
 */
export const modifierOption = v.object({
  label: v.string(),
  priceDelta: v.number(), // CENTIMES, ≥ 0
});

export type ModifierOption = Infer<typeof modifierOption>;

export const modifierGroups = defineTable({
  tenantId: v.id("tenants"),
  name: v.string(),
  minSelect: v.number(), // ≥ 0 — 0 = optional, ≥ 1 = mandatory
  maxSelect: v.number(), // ≥ 1 — 1 = single-choice, > 1 = multi-choice
  options: v.array(modifierOption),
  createdAt: v.number(),
}).index("by_tenant", ["tenantId"]);
