import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { allergen } from "../../table/menuItems";
import {
  deleteTenantItem,
  insertTenantItem,
  listTenantItems,
  listTenantItemsByCategory,
  patchTenantItem,
  requireTenantCategory,
  requireTenantItem,
  tenantMutation,
  tenantQuery,
} from "../tenancy";

/**
 * 2.2-B — `menuItems` tenant-scoped CRUD (PRD 10 §5/§6, client-ordering CONTEXT
 * "Item" / "Allergènes", ADR 0010).
 *
 * Every function goes through a tenancy wrapper (`tenantQuery` / `tenantMutation`,
 * default `allow: ["kb_manager"]`; root override for `kb_admin`). Handlers never
 * touch raw `ctx.db` — only the sanctioned `lib/tenancy/menuStore` seam, scoped
 * to `ctx.tenantId`. `allergens` is a subset of the 14 frozen UE 1169/2011
 * literals (reused validator, never free text). `basePrice` is in CENTIMES and
 * must be ≥ 0. Deleting an item cascades its N-N modifier links and deletes its
 * stored photo, WITHOUT touching the shared modifier groups.
 */

/** Guard: a price (centimes) must be a non-negative integer. */
function assertNonNegativePrice(basePrice: number): void {
  if (!Number.isInteger(basePrice) || basePrice < 0) {
    throw new ConvexError({
      code: "INVALID_PRICE",
      message: "basePrice must be a non-negative integer (centimes).",
    });
  }
}

/** List ALL of the calling tenant's items, ordered. */
export const list = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<Doc<"menuItems">[]> =>
    listTenantItems(ctx, ctx.tenantId),
});

/** List the items of ONE of the tenant's categories (NOT_FOUND for a foreign id). */
export const listByCategory = tenantQuery()({
  args: { categoryId: v.id("menuCategories") },
  handler: async (ctx, args): Promise<Doc<"menuItems">[]> =>
    listTenantItemsByCategory(ctx, ctx.tenantId, args.categoryId),
});

/**
 * Create an item in one of the tenant's categories (created AVAILABLE). Refuses
 * a foreign `categoryId` (NOT_FOUND) and a negative `basePrice`.
 */
export const create = tenantMutation()({
  args: {
    categoryId: v.id("menuCategories"),
    name: v.string(),
    description: v.string(),
    basePrice: v.number(),
    allergens: v.array(allergen),
  },
  handler: async (ctx, args): Promise<Id<"menuItems">> => {
    await requireTenantCategory(ctx, ctx.tenantId, args.categoryId);
    assertNonNegativePrice(args.basePrice);
    return insertTenantItem(ctx, ctx.tenantId, {
      categoryId: args.categoryId,
      name: args.name,
      description: args.description,
      basePrice: args.basePrice,
      allergens: args.allergens,
    });
  },
});

/**
 * Edit one of the tenant's items: name / description / price / allergens /
 * availability, and optionally move it to another of the tenant's categories.
 * Refuses a foreign `itemId` or a foreign target `categoryId` (NOT_FOUND), and a
 * negative `basePrice`.
 */
export const update = tenantMutation()({
  args: {
    itemId: v.id("menuItems"),
    name: v.string(),
    description: v.string(),
    basePrice: v.number(),
    allergens: v.array(allergen),
    available: v.boolean(),
    // Optional re-categorisation; when omitted the item keeps its category.
    categoryId: v.optional(v.id("menuCategories")),
  },
  handler: async (ctx, args): Promise<void> => {
    // Ownership of the item is checked FIRST (NOT_FOUND for a missing/foreign id)
    // so an attacker probing a foreign itemId never reaches the price/category
    // guards below.
    const item = await requireTenantItem(ctx, ctx.tenantId, args.itemId);
    assertNonNegativePrice(args.basePrice);
    const targetCategory = args.categoryId ?? item.categoryId;
    await requireTenantCategory(ctx, ctx.tenantId, targetCategory);
    await patchTenantItem(ctx, ctx.tenantId, args.itemId, {
      categoryId: targetCategory,
      name: args.name,
      description: args.description,
      basePrice: args.basePrice,
      allergens: args.allergens,
      available: args.available,
    });
  },
});

/**
 * Hard-delete one of the tenant's items: cascades its N-N modifier links and
 * deletes its stored photo, leaving the shared modifier groups intact (NOT_FOUND
 * for a foreign id).
 */
export const remove = tenantMutation()({
  args: { itemId: v.id("menuItems") },
  handler: async (ctx, args): Promise<void> =>
    deleteTenantItem(ctx, ctx.tenantId, args.itemId),
});
