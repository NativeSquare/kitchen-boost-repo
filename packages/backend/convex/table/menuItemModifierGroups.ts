import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.2-A — `menuItemModifierGroups` (N-N link item ↔ group) (PRD 10 §6,
 * client-ordering CONTEXT "Modifier", ADR 0010).
 *
 * Materialises the REUSABLE modifier relationship (acté 2026-05-25, Uber Eats
 * model): a `modifierGroups` row is created ONCE and attached to N `menuItems`,
 * one edge per (item, group). `order` is the display order of the group within
 * the item's detail screen (a group may sit at a different position on each item
 * it is attached to, hence the order lives on the EDGE, not on the group).
 *
 * TENANT-SCOPED (carries `tenantId`, ADR 0010): both `itemId` and
 * `modifierGroupId` already belong to one tenant, but `tenantId` is denormalised
 * here so the link is reachable / fuzzable through the tenancy wrappers like
 * every other menu table (the `no-untenanted-query` rule applies). Three indexes:
 *  - `by_item` — the groups attached to one item (render an item's detail).
 *  - `by_group` — the items reusing one group (impact analysis on group edit).
 *  - `by_item_group` — the unique (item, group) edge (idempotent attach/detach).
 */
export const menuItemModifierGroups = defineTable({
  tenantId: v.id("tenants"),
  itemId: v.id("menuItems"),
  modifierGroupId: v.id("modifierGroups"),
  order: v.number(), // display order of this group on this item
})
  .index("by_item", ["itemId"])
  .index("by_group", ["modifierGroupId"])
  .index("by_item_group", ["itemId", "modifierGroupId"]);
