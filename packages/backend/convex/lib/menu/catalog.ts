import type { Doc } from "../../_generated/dataModel";
import {
  listTenantCategories,
  listTenantItemModifierGroups,
  listTenantItemsByCategory,
  publicTenantQuery,
} from "../tenancy";

/**
 * 2.2-C — PUBLIC read of a tenant's menu for the PWA eater (PRD 10 §5/§6,
 * client-ordering CONTEXT, ADR 0010).
 *
 * `getPublicMenu` is the UNIQUE eater-facing surface of the menu. It is an
 * UNAUTHENTICATED, read-only query exposed via the foundation `publicTenantQuery`
 * wrapper (1.x-D): no `kb_manager` rights, no `getCurrentActor` — just a valid
 * `tenantId` (the sub-domain's tenant) that must resolve to an existing tenant,
 * else the wrapper throws `Forbidden`. There is deliberately NO public mutation
 * twin: the eater never writes the menu.
 *
 * It NEVER touches raw `ctx.db` — it composes the sanctioned, tenant-scoped
 * `lib/tenancy/menuStore` read seam, always passing `ctx.tenantId` (resolved by
 * the public wrapper). So a single tenant's menu is returned and nothing else is
 * reachable: the cross-tenant isolation (ADR 0010) is STRUCTURAL, and the
 * `getPublicMenu(A)` ≠ B suite pins it.
 *
 * Shape (PRD §5/§6): categories ORDERED → items → their reusable modifier groups
 * resolved via the N-N link table. Items are returned even when UNAVAILABLE
 * ([[Item out of stock]]): the front greys them out from the `available` flag —
 * it does NOT hide them (PRD §5). Each item carries name / description /
 * `basePrice` (centimes) / 14-allergen subset / `available` / resolved photo URL;
 * each modifier group carries `name` / `minSelect` / `maxSelect` / `options`
 * (`label` + `priceDelta`). No search / no draft-publish split in V1.
 */

/** One reusable modifier group as the PWA consumes it (front renders min/max). */
export type PublicModifierGroup = {
  _id: Doc<"modifierGroups">["_id"];
  name: string;
  minSelect: number;
  maxSelect: number;
  options: Doc<"modifierGroups">["options"];
};

/** One menu item with its resolved photo URL + attached modifier groups. */
export type PublicMenuItem = {
  _id: Doc<"menuItems">["_id"];
  name: string;
  description: string;
  basePrice: number;
  allergens: Doc<"menuItems">["allergens"];
  available: boolean;
  /** Resolved file-storage URL of the product photo, or `null` if none. */
  photoUrl: string | null;
  modifierGroups: PublicModifierGroup[];
};

/** One category with its ordered items. */
export type PublicMenuCategory = {
  _id: Doc<"menuCategories">["_id"];
  name: string;
  items: PublicMenuItem[];
};

/** The full structured menu of ONE tenant. */
export type PublicMenu = {
  categories: PublicMenuCategory[];
};

/** Project a stored modifier group to its public (eater-facing) shape. */
function toPublicModifierGroup(
  group: Doc<"modifierGroups">,
): PublicModifierGroup {
  return {
    _id: group._id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: group.options,
  };
}

/**
 * Public, unauthenticated, read-only menu of the tenant resolved from `tenantId`.
 * Tenant-scoped by construction (every read keyed on `ctx.tenantId` through the
 * sanctioned store seam), so it can NEVER surface another tenant's data.
 */
export const getPublicMenu = publicTenantQuery({
  args: {},
  handler: async (ctx): Promise<PublicMenu> => {
    const categories = await listTenantCategories(ctx, ctx.tenantId);
    const publicCategories: PublicMenuCategory[] = [];

    for (const category of categories) {
      // Items of this category (ordered), incl. unavailable ones — the front
      // greys them out from `available`, it does not hide them (PRD §5).
      const items = await listTenantItemsByCategory(
        ctx,
        ctx.tenantId,
        category._id,
      );
      const publicItems: PublicMenuItem[] = [];

      for (const item of items) {
        const groups = await listTenantItemModifierGroups(
          ctx,
          ctx.tenantId,
          item._id,
        );
        const photoUrl =
          item.photoStorageId === undefined
            ? null
            : await ctx.storage.getUrl(item.photoStorageId);
        publicItems.push({
          _id: item._id,
          name: item.name,
          description: item.description,
          basePrice: item.basePrice,
          allergens: item.allergens,
          available: item.available,
          photoUrl,
          modifierGroups: groups.map(toPublicModifierGroup),
        });
      }

      publicCategories.push({
        _id: category._id,
        name: category.name,
        items: publicItems,
      });
    }

    return { categories: publicCategories };
  },
});
