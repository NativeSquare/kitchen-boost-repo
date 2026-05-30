import {
  listTenantCategories,
  listTenantItemModifierGroups,
  listTenantItemsByCategory,
  tenantMutation,
  writePublishedMenu,
} from "../tenancy";
import type { PublishedMenuPayload } from "../../table/publishedMenus";

/**
 * B-MENU-PUBLICATION slice 2 — `publishMenu` global atomic snapshot build
 * (ADR 0015 « édition brouillon → publication globale atomique » + ADR 0010
 * isolation multi-tenant applicative).
 *
 * The KB Manager edits the menu LIVE in the draft tables (`menuCategories` /
 * `menuItems` / `modifierGroups` / `menuItemModifierGroups`); the public PWA
 * mangeur (slice 6) will read instead from the [[Instantané publié]] of the
 * tenant. `publishMenu` is the SINGLE entry point that turns the current draft
 * into the published snapshot — atomically, inside ONE Convex mutation tx:
 *  1. Walk the draft via the sanctioned `lib/tenancy/menuStore` seam
 *     (`listTenantCategories` → `listTenantItemsByCategory` →
 *     `listTenantItemModifierGroups`), so isolation is structural (no raw
 *     `ctx.db` here, `no-untenanted-query` enforces it).
 *  2. Project the rows to the `PublishedMenuPayload` shape — categories ordered,
 *     items with name / description / basePrice / allergens / photoStorageId,
 *     modifier groups resolved with min/max + options.
 *  3. Call `writePublishedMenu` ONCE — the seam atomic-replaces the previous
 *     snapshot row of the tenant (delete-old + insert-new in the same tx,
 *     « écrasé atomiquement », ADR 0015 « pas de versioning V1 »).
 *
 * KEY INVARIANT (ADR 0015 pivot): the snapshot does NOT carry the `available`
 * flag. `available` stays a LIVE overlay read from `menuItems` at PWA read time
 * (slice 6) so toggling « out of stock » never requires a republication — the
 * resto's 1-tap [[Item out of stock]] from the KDS keeps its sub-second feel.
 * The projection here therefore reads `item.available` deliberately NOT and the
 * payload validator on `publishedMenus.payload` would reject any
 * accidentally-added field anyway.
 *
 * RBAC: `tenantMutation` with `allow: ["kb_manager"]` (kb_admin always passes
 * via the root override of `requireTenantAccess`, for assistance — cohérent
 * avec le reste de `lib/menu`). Staff is rejected (publication is an editorial
 * decision, not a service operation).
 */
export const publishMenu = tenantMutation({ allow: ["kb_manager"] })({
  args: {},
  handler: async (ctx): Promise<void> => {
    const categories = await listTenantCategories(ctx, ctx.tenantId);

    const payload: PublishedMenuPayload = { categories: [] };
    for (const category of categories) {
      const items = await listTenantItemsByCategory(
        ctx,
        ctx.tenantId,
        category._id,
      );
      const projectedItems: PublishedMenuPayload["categories"][number]["items"] =
        [];
      for (const item of items) {
        const groups = await listTenantItemModifierGroups(
          ctx,
          ctx.tenantId,
          item._id,
        );
        projectedItems.push({
          _id: item._id,
          name: item.name,
          description: item.description,
          basePrice: item.basePrice,
          allergens: item.allergens,
          photoStorageId: item.photoStorageId,
          modifierGroups: groups.map((g) => ({
            _id: g._id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options,
          })),
        });
      }
      payload.categories.push({
        _id: category._id,
        name: category.name,
        items: projectedItems,
      });
    }

    await writePublishedMenu(ctx, ctx.tenantId, payload, Date.now());
  },
});
