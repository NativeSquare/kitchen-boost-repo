import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { PublishedMenuPayload } from "../../table/publishedMenus";
import {
  listTenantCategories,
  listTenantItemModifierGroups,
  listTenantItemsByCategory,
  readTenantItemsAvailability,
  tenantMutation,
  tenantQuery,
  writePublishedMenu,
} from "../tenancy";
import type { PublicMenu, PublicMenuCategory, PublicMenuItem } from "./catalog";

/**
 * B-MENU-PUBLICATION slices 2 (#155) + 4 (#166) — publication pipeline of the
 * [[Instantané publié]] (ADR 0015 « édition brouillon → publication globale
 * atomique » + ADR 0010 isolation multi-tenant applicative).
 *
 * Two surfaces share the SAME projection of the live draft (DRY enforced):
 *  - `publishMenu` (slice 2) — the gérant clicks « Publier »: rebuild the
 *    snapshot from the draft and atomically replace the published one.
 *  - `previewMenu` (slice 4) — the gérant opens the « Aperçu » in the editor:
 *    project the draft EXACTLY as the PWA mangeur would render the snapshot,
 *    without writing anything. Lets the gérant verify unpublished changes
 *    before clicking « Publier » (ADR 0015 « Aperçu admin lit le brouillon »).
 *
 * The shared projection is `buildSnapshotPayload` below — it walks the draft
 * via the sanctioned `lib/tenancy/menuStore` seam (no raw `ctx.db` in this
 * module, `no-untenanted-query` enforces it) and produces a
 * `PublishedMenuPayload` that is BYTE-IDENTICAL whether it's then written by
 * `publishMenu` or rendered on the fly by `previewMenu`.
 */

/**
 * Project the calling tenant's LIVE draft (`menuCategories` / `menuItems` /
 * `modifierGroups` / `menuItemModifierGroups`) into a `PublishedMenuPayload`
 * — the exact shape persisted in `publishedMenus` AND rendered by `previewMenu`.
 *
 * Shared by `publishMenu` (slice 2 — writes the result) and `previewMenu`
 * (slice 4 — renders the result with the same overlays as `getPublicMenu`),
 * so the two surfaces can never drift (a change here propagates to both).
 *
 * KEY INVARIANT (ADR 0015 pivot, « la rupture ne doit pas exiger une
 * republication globale »): the payload does NOT carry the `available` flag.
 * `available` stays a LIVE overlay read from `menuItems` at READ time (both
 * surfaces apply it identically: `getPublicMenu` on the snapshot,
 * `previewMenu` on the draft). The `publishedMenus.payload` validator would
 * reject any accidentally-added field anyway.
 */
export async function buildSnapshotPayload(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<PublishedMenuPayload> {
  const categories = await listTenantCategories(ctx, tenantId);
  const payload: PublishedMenuPayload = { categories: [] };
  for (const category of categories) {
    const items = await listTenantItemsByCategory(ctx, tenantId, category._id);
    const projectedItems: PublishedMenuPayload["categories"][number]["items"] =
      [];
    for (const item of items) {
      const groups = await listTenantItemModifierGroups(
        ctx,
        tenantId,
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
  return payload;
}

/**
 * Resolve a `PublishedMenuPayload` to a `PublicMenu` by applying the two
 * read-time overlays that `getPublicMenu` also applies on top of the snapshot:
 *   1. `photoUrl` — resolved from `photoStorageId` via `ctx.storage.getUrl(…)`
 *      so the payload stays immutable while URLs are storage-controlled.
 *   2. `available` — read LIVE from `menuItems` via
 *      `readTenantItemsAvailability`; the payload does NOT carry `available`
 *      (ADR 0015 pivot). Missing from the map ⇒ default `false` (safe: never
 *      surface a phantom item as orderable).
 *
 * Tenant-scoped by construction (the availability seam is keyed on `tenantId`).
 * Reused by `previewMenu` to keep the wire contract IDENTICAL to
 * `getPublicMenu` (modulo overlays both compute live — `available` on the
 * snapshot vs the draft is the only legit divergence, by design).
 */
export async function resolvePublicMenuFromPayload(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  payload: PublishedMenuPayload,
): Promise<PublicMenu> {
  const allItemIds: Id<"menuItems">[] = [];
  for (const category of payload.categories) {
    for (const item of category.items) {
      allItemIds.push(item._id);
    }
  }
  const availability = await readTenantItemsAvailability(
    ctx,
    tenantId,
    allItemIds,
  );

  const publicCategories: PublicMenuCategory[] = [];
  for (const category of payload.categories) {
    const publicItems: PublicMenuItem[] = [];
    for (const item of category.items) {
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
        available: availability.get(item._id) ?? false,
        photoUrl,
        modifierGroups: item.modifierGroups.map((g) => ({
          _id: g._id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: g.options,
        })),
      });
    }
    publicCategories.push({
      _id: category._id,
      name: category.name,
      items: publicItems,
    });
  }

  return { categories: publicCategories };
}

/**
 * B-MENU-PUBLICATION slice 2 — `publishMenu` global atomic snapshot build
 * (ADR 0015 + ADR 0010).
 *
 * Inside ONE Convex mutation tx:
 *  1. Walk the draft via `buildSnapshotPayload` (shared with `previewMenu`).
 *  2. Call `writePublishedMenu` ONCE — the seam atomic-replaces the previous
 *     snapshot row of the tenant (delete-old + insert-new in the same tx,
 *     « écrasé atomiquement », ADR 0015 « pas de versioning V1 »).
 *
 * RBAC: `tenantMutation` with `allow: ["kb_manager"]` (kb_admin always passes
 * via the root override of `requireTenantAccess`, for assistance — cohérent
 * avec le reste de `lib/menu`). Staff is rejected (publication is an editorial
 * decision, not a service operation).
 */
export const publishMenu = tenantMutation({ allow: ["kb_manager"] })({
  args: {},
  handler: async (ctx): Promise<void> => {
    const payload = await buildSnapshotPayload(ctx, ctx.tenantId);
    await writePublishedMenu(ctx, ctx.tenantId, payload, Date.now());
  },
});

/**
 * B-MENU-PUBLICATION slice 4 (#166) — `previewMenu` admin reads the DRAFT as
 * the PWA would render the published snapshot (ADR 0015 « Aperçu admin lit le
 * brouillon » + ADR 0010).
 *
 * Returns the same `PublicMenu` wire contract as `getPublicMenu` (categories
 * ordered → items with name / description / basePrice / allergens / available /
 * photoUrl, modifier groups with min / max / options) but built from the LIVE
 * draft tables (`menuCategories` / `menuItems` / …) instead of the published
 * snapshot. The shared `buildSnapshotPayload` enforces DRY with `publishMenu`
 * — a future change to the snapshot shape propagates to both surfaces.
 *
 * Two overlays applied at READ time (same rule as `getPublicMenu`):
 *  - `photoUrl` resolved from the draft's `photoStorageId` via
 *    `ctx.storage.getUrl(…)`.
 *  - `available` read LIVE from `menuItems` via `readTenantItemsAvailability`
 *    — toggling « out of stock » affects both surfaces immediately, no
 *    republication needed (ADR 0015 pivot).
 *
 * RBAC: `tenantQuery({ allow: ["kb_manager"] })` (kb_admin via root override,
 * staff REJECTED — preview is an editor surface, not a service one). Anonymous
 * callers and customers are rejected by the wrapper. A tenant with NO draft
 * returns `{ categories: [] }` (independent of the snapshot state — if there's
 * no draft yet, neither preview nor publish can surface anything).
 */
export const previewMenu = tenantQuery({ allow: ["kb_manager"] })({
  args: {},
  handler: async (ctx): Promise<PublicMenu> => {
    const payload = await buildSnapshotPayload(ctx, ctx.tenantId);
    return resolvePublicMenuFromPayload(ctx, ctx.tenantId, payload);
  },
});
