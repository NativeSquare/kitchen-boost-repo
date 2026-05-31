import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { PublishedMenuPayload } from "../../table/publishedMenus";
import {
  earliestDraftCreationTimeSince,
  getPublishedMenu,
  hasAnyDraftRow,
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
 * B-MENU-PUBLICATION slices 2 (#155) + 4 (#166) + 5 (#176) + 8 (#224) —
 * publication pipeline of the [[Instantané publié]] (ADR 0015 « édition
 * brouillon → publication globale atomique » + ADR 0010 isolation multi-tenant
 * applicative).
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
 *
 * SNAPSHOT ↔ DRAFT EDGE CONTRACT (B-MENU-PUBLICATION slice 8, #224, ADR 0015
 * « pas de versioning V1 »): the snapshot row in `publishedMenus` is NEVER
 * touched by draft-side cascades. Concretely, `deleteTenantItem` deletes the
 * photo blob; `deleteTenantCategory` and `deleteTenantModifierGroup` drop draft
 * rows and their edges — none of these touch the existing snapshot. The
 * snapshot is therefore allowed to TRANSIENTLY reference draft ids (items,
 * categories, modifier groups) that no longer exist in the live tables, and a
 * `photoStorageId` whose blob has been cascaded. The next `publishMenu` is the
 * only thing that reconciles the snapshot with the current draft (and, by
 * dropping the deleted row, makes the reference disappear).
 *
 * Consequence on the read side: BOTH `getPublicMenu` (the eater PWA, sourced
 * on the snapshot) and `previewMenu` (the gérant, sourced on the draft) are
 * tolerant reads: they ABSORB an orphan `photoStorageId` as `photoUrl: null`
 * (Convex `storage.getUrl(<missing>)` returns null, NOT a throw), so an admin
 * who deletes a draft item between two `publishMenu` calls never bricks the
 * PWA. The « tolerant read » invariant is pinned cross-suite by slice 8's
 * `items.test.ts` (delete item referenced by snapshot ⇒ `photoUrl: null`,
 * republish ⇒ row dropped) and the consolidated cross-tenant fuzz here.
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
      // Tolerant read (slice 8, #224): same contract as `getPublicMenu` — an
      // orphan `photoStorageId` (blob deleted between two `publishMenu` calls)
      // resolves to `null`, never throws. Pinned cross-suite by `items.test.ts`.
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

/**
 * Structural deep-equality between two `PublishedMenuPayload`s. The payload is
 * a closed, finite shape (categories → items → modifierGroups → options;
 * numbers, strings, optional `Id<"_storage">` for the photo) — no Dates, no
 * functions, no cycles — so a depth-first walk over the known fields is exact
 * AND cheap. We don't use `JSON.stringify` deliberately: an `undefined`
 * `photoStorageId` would be stringified inconsistently, and key order would
 * matter; this walk treats `undefined` vs absent identically (both sides go
 * through the same validator) and ignores key order.
 */
function arraysEqualBy<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!eq(a[i] as T, b[i] as T)) return false;
  }
  return true;
}

function payloadsEqual(
  a: PublishedMenuPayload,
  b: PublishedMenuPayload,
): boolean {
  return arraysEqualBy(a.categories, b.categories, (ca, cb) => {
    if (ca._id !== cb._id) return false;
    if (ca.name !== cb.name) return false;
    return arraysEqualBy(ca.items, cb.items, (ia, ib) => {
      if (ia._id !== ib._id) return false;
      if (ia.name !== ib.name) return false;
      if (ia.description !== ib.description) return false;
      if (ia.basePrice !== ib.basePrice) return false;
      if (ia.photoStorageId !== ib.photoStorageId) return false;
      if (!arraysEqualBy(ia.allergens, ib.allergens, (x, y) => x === y)) {
        return false;
      }
      return arraysEqualBy(ia.modifierGroups, ib.modifierGroups, (ga, gb) => {
        if (ga._id !== gb._id) return false;
        if (ga.name !== gb.name) return false;
        if (ga.minSelect !== gb.minSelect) return false;
        if (ga.maxSelect !== gb.maxSelect) return false;
        return arraysEqualBy(ga.options, gb.options, (oa, ob) => {
          return oa.label === ob.label && oa.priceDelta === ob.priceDelta;
        });
      });
    });
  });
}

/**
 * B-MENU-PUBLICATION slice 5 (#176) — `hasUnpublishedChanges` editor indicator
 * (ADR 0015 « indicateur "modifications non publiées" » + ADR 0010).
 *
 * The KB Admin editor displays this signal continuously (« X modifications non
 * publiées »): it MUST be `true` whenever the draft would project to a payload
 * different from the last published snapshot, and `false` again after the next
 * `publishMenu`. The « ruptures » (`available` toggle) DO NOT count as
 * unpublished changes — `available` is a LIVE overlay, NOT part of the payload
 * (ADR 0015 pivot « la rupture ne doit pas exiger une republication globale »).
 *
 * Decision approach (issue § Decision to lock in this slice):
 * approach (a) literally (compare `publishedAt` with `_creationTime` of draft
 * rows) wouldn't catch in-place updates — Convex doesn't refresh
 * `_creationTime` on a patch — so renames/edits would falsely report no
 * changes. We use the cheapest variant that handles updates: project the live
 * draft via the SHARED `buildSnapshotPayload` (DRY with `publishMenu` /
 * `previewMenu`) and deep-compare with the published payload. The projection
 * is already O(menu) and runs once per call; the comparison adds no
 * indexes/queries. This is approach (b) but free because the projection is
 * already there for the two sibling surfaces.
 *
 * Edge cases pinned by the test suite:
 *  - Never published + empty draft        ⇒ hasChanges = false (« nothing to publish »).
 *  - Never published + non-empty draft    ⇒ hasChanges = true  (« needs first publication »).
 *  - After publishMenu                    ⇒ hasChanges = false.
 *  - After any draft mutation             ⇒ hasChanges = true.
 *  - After republish                      ⇒ hasChanges = false again, `lastPublishedAt` updates.
 *  - `available` toggle (out-of-stock)    ⇒ hasChanges UNCHANGED (overlay, not in payload).
 *
 * Return:
 *  - `hasChanges` — the boolean the front renders. Load-bearing field.
 *  - `lastPublishedAt` — `publishedMenus.publishedAt` of the tenant, `null` if
 *    never published.
 *  - `changedSince` — best-effort LOWER bound on when changes first appeared:
 *    earliest `_creationTime` of any draft row strictly newer than
 *    `lastPublishedAt`, else `null`. Pure renames/edits don't surface here
 *    (Convex doesn't refresh `_creationTime` on patch) — V1 informational only.
 *
 * RBAC: `tenantQuery({ allow: ["kb_manager"] })` with root override for
 * `kb_admin` (assistance). Staff REJECTED — the indicator is editor-only,
 * cohérent avec `publishMenu` / `previewMenu`.
 */
export const hasUnpublishedChanges = tenantQuery({ allow: ["kb_manager"] })({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    hasChanges: boolean;
    lastPublishedAt: number | null;
    changedSince: number | null;
  }> => {
    const snapshot = await getPublishedMenu(ctx, ctx.tenantId);
    const lastPublishedAt = snapshot?.publishedAt ?? null;

    if (snapshot === null) {
      // Never published: hasChanges iff the draft is non-empty (else nothing to
      // signal). `changedSince` is the earliest draft row creation time (>0
      // sentinel selects every row).
      const draftHasRows = await hasAnyDraftRow(ctx, ctx.tenantId);
      const changedSince = draftHasRows
        ? await earliestDraftCreationTimeSince(ctx, ctx.tenantId, 0)
        : null;
      return {
        hasChanges: draftHasRows,
        lastPublishedAt,
        changedSince,
      };
    }

    // Has been published — project the LIVE draft via the shared helper and
    // deep-equate with the snapshot payload. Equal ⇒ nothing to publish.
    const currentProjection = await buildSnapshotPayload(ctx, ctx.tenantId);
    const equal = payloadsEqual(currentProjection, snapshot.payload);
    if (equal) {
      return { hasChanges: false, lastPublishedAt, changedSince: null };
    }
    const changedSince = await earliestDraftCreationTimeSince(
      ctx,
      ctx.tenantId,
      snapshot.publishedAt,
    );
    return { hasChanges: true, lastPublishedAt, changedSince };
  },
});
