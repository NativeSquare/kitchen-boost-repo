import type { Doc, Id } from "../../_generated/dataModel";
import type { ModifierOption } from "../../table/modifierGroups";
import {
  getPublishedMenu,
  publicTenantQuery,
  readTenantItemsAvailability,
} from "../tenancy";

/**
 * 2.2-C — PUBLIC read of a tenant's menu for the PWA eater (PRD 10 §5/§6,
 * client-ordering CONTEXT, ADR 0010). Source pivoted to the [[Instantané publié]]
 * by B-MENU-PUBLICATION slice 3 (#160, ADR 0015) — see below.
 *
 * `getPublicMenu` is the UNIQUE eater-facing surface of the menu. It is an
 * UNAUTHENTICATED, read-only query exposed via the foundation `publicTenantQuery`
 * wrapper (1.x-D): no `kb_manager` rights, no `getCurrentActor` — just a valid
 * `tenantId` (the sub-domain's tenant) that must resolve to an existing tenant,
 * else the wrapper throws `Forbidden`. There is deliberately NO public mutation
 * twin: the eater never writes the menu.
 *
 * SOURCE OF TRUTH (ADR 0015, slice 3 / #160): reads from the [[Instantané
 * publié]] (`publishedMenus`) of the tenant, NOT from the live draft tables. The
 * KB Manager edits the live `menuCategories` / `menuItems` / `modifierGroups`
 * tables as their brouillon; the eater only sees what was last published via
 * `publishMenu` (slice 2). A tenant that has NEVER published returns
 * `{ categories: [] }` — no throw — and the front PWA renders its "menu en cours
 * de préparation" state (ADR 0015 § Conséquences, EPIC #132 § User Stories #10).
 *
 * Two overlays are resolved at READ time on top of the snapshot payload:
 *  1. `photoUrl` — resolved via `ctx.storage.getUrl(item.photoStorageId)` so the
 *     snapshot stays immutable while the URL can rotate (storage-controlled).
 *     **Tolerant read** (B-MENU-PUBLICATION slice 8, #224): the draft cascade
 *     `deleteTenantItem` DOES delete the photo blob but does NOT touch this
 *     snapshot — the snapshot can therefore transiently reference an orphan
 *     `photoStorageId` (until the next `publishMenu` rebuilds it). Convex
 *     `ctx.storage.getUrl(<missing id>)` returns `null` (not an error), and we
 *     surface it as `photoUrl: null` so the PWA degrades gracefully without
 *     the read throwing — pinned by the cross-suite slice 8 tests.
 *  2. `available` — read LIVE from `menuItems` via the tenant-scoped seam
 *     `readTenantItemsAvailability`. The snapshot does NOT carry `available`
 *     (ADR 0015 pivot « la rupture ne doit pas exiger une republication
 *     globale »), so the staff's 1-tap [[Item out of stock]] is reflected on the
 *     PWA without a republication. An item whose live row has been deleted (or
 *     belongs to another tenant — structurally impossible since the snapshot is
 *     tenant-scoped) defaults to `available: false` (safe: the eater never sees
 *     a phantom item as orderable).
 *
 * The wire contract `PublicMenu` (categories ORDERED → items with name /
 * description / basePrice / allergens / available / photoUrl, modifierGroups
 * with min / max / options) is BYTE-EQUIVALENT to the pre-slice contract — front
 * PWA stays rétro-compatible (ADR 0015 « `getPublicMenu` migration »).
 *
 * It NEVER touches raw `ctx.db` — it composes the sanctioned, tenant-scoped
 * `lib/tenancy` seams (`getPublishedMenu`, `readTenantItemsAvailability`),
 * always passing `ctx.tenantId` (resolved by the public wrapper). So a single
 * tenant's menu is returned and nothing else is reachable: the cross-tenant
 * isolation (ADR 0010) is STRUCTURAL, and the `getPublicMenu(A)` ≠ B suite
 * pins it.
 *
 * Shape (PRD §5/§6): categories ORDERED → items → their reusable modifier groups
 * (already resolved at publication time). Items are returned even when
 * UNAVAILABLE ([[Item out of stock]]): the front greys them out from the
 * `available` flag — it does NOT hide them (PRD §5). Each item carries name /
 * description / `basePrice` (centimes) / 14-allergen subset / `available` /
 * resolved photo URL; each modifier group carries `name` / `minSelect` /
 * `maxSelect` / `options` (`label` + `priceDelta`). No search / no allergen
 * filter in V1.
 */

/** One reusable modifier group as the PWA consumes it (front renders min/max). */
export type PublicModifierGroup = {
  _id: Doc<"modifierGroups">["_id"];
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
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

/**
 * Public, unauthenticated, read-only menu of the tenant resolved from `tenantId`,
 * sourced from the [[Instantané publié]] (`publishedMenus`, ADR 0015) with the
 * live `available` overlay applied per item. Tenant-scoped by construction
 * (snapshot read + availability read both keyed on `ctx.tenantId` through the
 * sanctioned `lib/tenancy` seam), so it can NEVER surface another tenant's data.
 */
export const getPublicMenu = publicTenantQuery({
  args: {},
  handler: async (ctx): Promise<PublicMenu> => {
    const snapshot = await getPublishedMenu(ctx, ctx.tenantId);
    // Tenant never published → empty menu, no throw (ADR 0015 edge, EPIC #132
    // User Story #10). The front PWA renders its "menu en cours de préparation".
    if (snapshot === null) return { categories: [] };

    // Collect every snapshotted item id so we can bulk-read the live `available`
    // overlay in a single tenant-scoped seam call (ADR 0015 pivot — `available`
    // is NOT in the snapshot, it's read live so the 1-tap rupture is reflected
    // without republication). Missing from the map ⇒ default `false` (safe).
    const allItemIds: Id<"menuItems">[] = [];
    for (const category of snapshot.payload.categories) {
      for (const item of category.items) {
        allItemIds.push(item._id);
      }
    }
    const availability = await readTenantItemsAvailability(
      ctx,
      ctx.tenantId,
      allItemIds,
    );

    const publicCategories: PublicMenuCategory[] = [];
    for (const category of snapshot.payload.categories) {
      const publicItems: PublicMenuItem[] = [];
      for (const item of category.items) {
        // Tolerant read (slice 8, #224): the snapshot can reference a
        // `photoStorageId` whose blob was cascaded by `deleteTenantItem`
        // before the next `publishMenu` rebuild. Convex `getUrl(<missing>)`
        // returns null — we surface `photoUrl: null` rather than letting any
        // edge case (null / throw) bubble up to the eater PWA.
        const photoUrl =
          item.photoStorageId === undefined
            ? null
            : ((await ctx.storage.getUrl(item.photoStorageId)) ?? null);
        publicItems.push({
          _id: item._id,
          name: item.name,
          description: item.description,
          basePrice: item.basePrice,
          allergens: item.allergens,
          // Live overlay (ADR 0015 pivot). Default `false` when the live row is
          // missing (deleted from the draft post-publish, or — structurally
          // impossible — foreign tenant id): the eater never sees a phantom
          // item as orderable.
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
  },
});
