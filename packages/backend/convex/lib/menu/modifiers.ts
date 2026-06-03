import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  type ModifierOption,
  modifierOption,
} from "../../table/modifierGroups";
import {
  attachTenantGroupToItem,
  deleteTenantModifierGroup,
  detachTenantGroupFromItem,
  insertTenantModifierGroup,
  listTenantItemModifierGroups,
  listTenantModifierGroupItems,
  listTenantModifierGroups,
  patchTenantModifierGroup,
  reorderTenantItemModifierGroups,
  tenantMutation,
  tenantQuery,
} from "../tenancy";

/**
 * 2.2-B — REUSABLE `modifierGroups` + the N-N item↔group link, tenant-scoped CRUD
 * (PRD 10 §6, client-ordering CONTEXT "Modifier", ADR 0010).
 *
 * Every function goes through a tenancy wrapper (`tenantQuery` / `tenantMutation`,
 * default `allow: ["kb_manager"]`; root override for `kb_admin`). Handlers never
 * touch raw `ctx.db` — only the sanctioned `lib/tenancy/menuStore` seam, scoped
 * to `ctx.tenantId`.
 *
 * REUSE (Uber Eats model): a group is created ONCE (`createGroup`) and attached
 * to N items via `attachGroupToItem`. Because the link references the group BY
 * ID, `updateGroup` reflects on EVERY linked item with a single write — no
 * per-item copy. `detachGroupFromItem` removes ONE edge (siblings + group
 * intact); `removeGroup` deletes the group AND all its edges.
 *
 * Bounds (from the schema / CONTEXT, NOT invented): `minSelect` ≥ 0,
 * `maxSelect` ≥ 1, `maxSelect` ≥ max(1, `minSelect`) (#106-d — a mandatory group
 * can never cap below its own minimum), every option `priceDelta` ≥ 0. Integers
 * throughout.
 */

/** Validate the reusable group bounds (the only product rules, no invention). */
function assertGroupBounds(
  minSelect: number,
  maxSelect: number,
  options: ModifierOption[],
): void {
  if (!Number.isInteger(minSelect) || minSelect < 0) {
    throw new ConvexError({
      code: "INVALID_MODIFIER",
      message: "minSelect must be an integer ≥ 0.",
    });
  }
  if (!Number.isInteger(maxSelect) || maxSelect < 1) {
    throw new ConvexError({
      code: "INVALID_MODIFIER",
      message: "maxSelect must be an integer ≥ 1.",
    });
  }
  // #106-d — maxSelect ≥ max(1, minSelect): a group can never allow FEWER
  // selections than its own minimum (an unsatisfiable mandatory group), and never
  // fewer than 1. maxSelect == minSelect is valid (exact-N choice).
  if (maxSelect < Math.max(1, minSelect)) {
    throw new ConvexError({
      code: "INVALID_MODIFIER",
      message: "maxSelect must be ≥ max(1, minSelect).",
    });
  }
  for (const opt of options) {
    if (!Number.isInteger(opt.priceDelta) || opt.priceDelta < 0) {
      throw new ConvexError({
        code: "INVALID_MODIFIER",
        message:
          "each option priceDelta must be a non-negative integer (centimes).",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Reusable groups
// ---------------------------------------------------------------------------

/** List ALL of the calling tenant's reusable modifier groups. */
export const listGroups = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<Doc<"modifierGroups">[]> =>
    listTenantModifierGroups(ctx, ctx.tenantId),
});

/** Create a reusable modifier group. Refuses out-of-bound select/price. */
export const createGroup = tenantMutation()({
  args: {
    name: v.string(),
    minSelect: v.number(),
    maxSelect: v.number(),
    options: v.array(modifierOption),
  },
  handler: async (ctx, args): Promise<Id<"modifierGroups">> => {
    assertGroupBounds(args.minSelect, args.maxSelect, args.options);
    return insertTenantModifierGroup(ctx, ctx.tenantId, {
      name: args.name,
      minSelect: args.minSelect,
      maxSelect: args.maxSelect,
      options: args.options,
    });
  },
});

/**
 * Edit a reusable group (NOT_FOUND for a foreign id). The edit reflects on EVERY
 * item the group is attached to (the link references it by id). Refuses
 * out-of-bound select/price.
 */
export const updateGroup = tenantMutation()({
  args: {
    modifierGroupId: v.id("modifierGroups"),
    name: v.string(),
    minSelect: v.number(),
    maxSelect: v.number(),
    options: v.array(modifierOption),
  },
  handler: async (ctx, args): Promise<void> => {
    assertGroupBounds(args.minSelect, args.maxSelect, args.options);
    await patchTenantModifierGroup(ctx, ctx.tenantId, args.modifierGroupId, {
      name: args.name,
      minSelect: args.minSelect,
      maxSelect: args.maxSelect,
      options: args.options,
    });
  },
});

/**
 * Hard-delete a reusable group AND all its edges (NOT_FOUND for a foreign id).
 * No item keeps a dangling link.
 */
export const removeGroup = tenantMutation()({
  args: { modifierGroupId: v.id("modifierGroups") },
  handler: async (ctx, args): Promise<void> =>
    deleteTenantModifierGroup(ctx, ctx.tenantId, args.modifierGroupId),
});

// ---------------------------------------------------------------------------
// N-N link (attach / detach / read)
// ---------------------------------------------------------------------------

/**
 * Attach a reusable group to an item (both owned by the tenant; NOT_FOUND for a
 * foreign id on either side). Idempotent — re-attaching the same pair is a no-op.
 */
export const attachGroupToItem = tenantMutation()({
  args: {
    itemId: v.id("menuItems"),
    modifierGroupId: v.id("modifierGroups"),
  },
  handler: async (ctx, args): Promise<void> =>
    attachTenantGroupToItem(
      ctx,
      ctx.tenantId,
      args.itemId,
      args.modifierGroupId,
    ),
});

/**
 * Detach a reusable group from ONE item (siblings + group untouched; NOT_FOUND
 * for a foreign id on either side). No-op if the edge does not exist.
 */
export const detachGroupFromItem = tenantMutation()({
  args: {
    itemId: v.id("menuItems"),
    modifierGroupId: v.id("modifierGroups"),
  },
  handler: async (ctx, args): Promise<void> =>
    detachTenantGroupFromItem(
      ctx,
      ctx.tenantId,
      args.itemId,
      args.modifierGroupId,
    ),
});

/** The reusable groups attached to ONE item (NOT_FOUND for a foreign id). */
export const listItemGroups = tenantQuery()({
  args: { itemId: v.id("menuItems") },
  handler: async (ctx, args): Promise<Doc<"modifierGroups">[]> =>
    listTenantItemModifierGroups(ctx, ctx.tenantId, args.itemId),
});

/**
 * Rewrite the display `order` of the modifier groups attached to ONE item.
 * `orderedGroupIds` MUST list every CURRENTLY-attached group exactly once,
 * else throws INVALID_REORDER — strict mirror of `items.reorder`, no silent
 * partial. Refuses a foreign `itemId` (NOT_FOUND) and a foreign group id
 * (caught by the same set-equality check, ADR 0010). Atomic via the Convex
 * mutation tx: a failure mid-loop rolls back any partial patch.
 *
 * Drives the DnD reorder of the « Personnalisations » tag chips inside the
 * item modal (Alex E2E manuel — « qu'on peut réordonner facilement avec du
 * DnD »). The edge `order` is the customer-facing order, hence reordering
 * here propagates everywhere the item is rendered.
 */
export const reorderItemGroups = tenantMutation()({
  args: {
    itemId: v.id("menuItems"),
    orderedGroupIds: v.array(v.id("modifierGroups")),
  },
  handler: async (ctx, args): Promise<void> =>
    reorderTenantItemModifierGroups(
      ctx,
      ctx.tenantId,
      args.itemId,
      args.orderedGroupIds,
    ),
});

/** The items reusing ONE group — impact set of a group edit (NOT_FOUND foreign). */
export const listGroupItems = tenantQuery()({
  args: { modifierGroupId: v.id("modifierGroups") },
  handler: async (ctx, args): Promise<Doc<"menuItems">[]> =>
    listTenantModifierGroupItems(ctx, ctx.tenantId, args.modifierGroupId),
});
