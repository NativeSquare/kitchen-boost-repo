import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Allergen } from "../../table/menuItems";
import type { ModifierOption } from "../../table/modifierGroups";
import type { PublishedMenuPayload } from "../../table/publishedMenus";

/**
 * 2.2-B — the SANCTIONED tenant-scoped data-access seam for the FIVE menu tables
 * (`menuCategories`, `menuItems`, `modifierGroups`, `menuItemModifierGroups`),
 * the isolation discipline of ADR 0010.
 *
 * B-MENU-PUBLICATION slice 1 (ADR 0015) extends this seam with the THREE
 * `publishedMenus` helpers (`getPublishedMenu` / `writePublishedMenu` /
 * `deletePublishedMenu`) — same tenant-scoping discipline, the snapshot table is
 * « one doc per tenant » and the writer is atomic-replace inside a single tx.
 *
 * All carry `tenantId`, so business code must reach them ONLY through the tenancy
 * wrappers — never raw `ctx.db.query("menuItems")` (the `no-untenanted-query`
 * rule, 1.x-H). This file lives in the EXEMPT `convex/lib/tenancy/**` path (the
 * single sanctioned `ctx.db` site for these tables), exactly like
 * `pricingRulesStore.ts` for `pricingRules`. The business module `lib/menu/**`
 * (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * Every helper is TENANT-SCOPED by construction: it takes the caller's resolved
 * `tenantId` (sourced from `ctx.tenantId` inside a tenant wrapper handler), keys
 * reads on the `by_tenant` / `by_category` / `by_item` / `by_group` /
 * `by_item_group` indexes, and re-checks `tenantId` ownership before reading or
 * writing a row fetched by id — so a category/item/group id from another tenant
 * is never reachable from here.
 */

const notFound = (what: string) =>
  new ConvexError({
    code: "NOT_FOUND",
    message: `${what} not found for this tenant.`,
  });

// ---------------------------------------------------------------------------
// tenants (GLOBAL table) — system-job fan-out
// ---------------------------------------------------------------------------

/**
 * Every tenant id, for a SYSTEM job that fans out per tenant (the next-day
 * reactivation cron, which has no actor and processes each tenant in turn). The
 * `tenants` table is GLOBAL (identity/lifecycle, no `tenantId` scoping key), and
 * this read lives in the sanctioned `lib/tenancy/**` seam — never raw `ctx.db`
 * in the cron business code (ADR 0010). Each id is then fed BACK through the
 * tenant-scoped helpers, so isolation still holds per tenant.
 */
export async function listAllTenantIds(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"tenants">[]> {
  const rows = await ctx.db.query("tenants").collect();
  return rows.map((t) => t._id);
}

// ---------------------------------------------------------------------------
// menuCategories
// ---------------------------------------------------------------------------

/** List ALL categories of one tenant, ordered by their display `order`. */
export async function listTenantCategories(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"menuCategories">[]> {
  const rows = await ctx.db
    .query("menuCategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return rows.sort((a, b) => a.order - b.order);
}

/** Read one category by id ONLY IF it belongs to `tenantId`; else `null`. */
export async function getTenantCategory(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  categoryId: Id<"menuCategories">,
): Promise<Doc<"menuCategories"> | null> {
  const row = await ctx.db.get(categoryId);
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/** Like `getTenantCategory` but throws NOT_FOUND for a missing/foreign id. */
export async function requireTenantCategory(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  categoryId: Id<"menuCategories">,
): Promise<Doc<"menuCategories">> {
  const row = await getTenantCategory(ctx, tenantId, categoryId);
  if (row === null) throw notFound("Category");
  return row;
}

/** Append a category at the end (next `order`). Returns the new id. */
export async function insertTenantCategory(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  name: string,
): Promise<Id<"menuCategories">> {
  const existing = await listTenantCategories(ctx, tenantId);
  const order = existing.length;
  return ctx.db.insert("menuCategories", {
    tenantId,
    name,
    order,
    createdAt: Date.now(),
  });
}

/** Rename a category owned by `tenantId`. */
export async function renameTenantCategory(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  categoryId: Id<"menuCategories">,
  name: string,
): Promise<void> {
  await requireTenantCategory(ctx, tenantId, categoryId);
  await ctx.db.patch(categoryId, { name });
}

/**
 * Rewrite the display `order` of the tenant's categories to match `orderedIds`.
 * Refuses unless `orderedIds` is EXACTLY the set of the tenant's category ids
 * (same length, all owned, no duplicates) — a partial set is a client bug, not a
 * silent partial reorder.
 */
export async function reorderTenantCategories(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderedIds: Id<"menuCategories">[],
): Promise<void> {
  const existing = await listTenantCategories(ctx, tenantId);
  const existingIds = new Set(existing.map((c) => c._id));
  const seen = new Set<string>();
  if (orderedIds.length !== existing.length) {
    throw new ConvexError({
      code: "INVALID_REORDER",
      message:
        "orderedIds must list every category of the tenant exactly once.",
    });
  }
  for (const id of orderedIds) {
    if (!existingIds.has(id) || seen.has(id)) {
      throw new ConvexError({
        code: "INVALID_REORDER",
        message:
          "orderedIds must list every category of the tenant exactly once.",
      });
    }
    seen.add(id);
  }
  for (let i = 0; i < orderedIds.length; i += 1) {
    await ctx.db.patch(orderedIds[i] as Id<"menuCategories">, { order: i });
  }
}

/** Hard-delete a category owned by `tenantId`. */
export async function deleteTenantCategory(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  categoryId: Id<"menuCategories">,
): Promise<void> {
  await requireTenantCategory(ctx, tenantId, categoryId);
  await ctx.db.delete(categoryId);
}

// ---------------------------------------------------------------------------
// menuItems
// ---------------------------------------------------------------------------

/** The mutable fields of an item (beyond identity / order / timestamps). */
export type ItemBody = {
  categoryId: Id<"menuCategories">;
  name: string;
  description: string;
  basePrice: number;
  allergens: Allergen[];
};

/** List ALL items of one tenant, keyed on `by_tenant`, ordered by `order`. */
export async function listTenantItems(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"menuItems">[]> {
  const rows = await ctx.db
    .query("menuItems")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return rows.sort((a, b) => a.order - b.order);
}

/**
 * List the items of ONE category, scoped to `tenantId` (the category must be
 * owned by the tenant). Keyed on `by_category`, ordered by `order`.
 */
export async function listTenantItemsByCategory(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  categoryId: Id<"menuCategories">,
): Promise<Doc<"menuItems">[]> {
  await requireTenantCategory(ctx, tenantId, categoryId);
  const rows = await ctx.db
    .query("menuItems")
    .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
    .collect();
  return rows.sort((a, b) => a.order - b.order);
}

/**
 * Rewrite the display `order` of the items of ONE category, scoped to
 * `tenantId`. Strict mirror of `reorderTenantCategories`: `orderedIds` MUST be
 * EXACTLY the set of the category's item ids (same length, all owned, no
 * duplicates) — a partial set is a client bug, not a silent partial reorder.
 *
 * The category must be owned by `tenantId` (NOT_FOUND otherwise via
 * `listTenantItemsByCategory`). After validation the patches all happen inside
 * the same Convex mutation tx, so a failure mid-loop rolls back any partial
 * write (atomicity contract pinned by the items.reorder test suite).
 */
export async function reorderTenantItems(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  categoryId: Id<"menuCategories">,
  orderedIds: Id<"menuItems">[],
): Promise<void> {
  const existing = await listTenantItemsByCategory(ctx, tenantId, categoryId);
  const existingIds = new Set(existing.map((i) => i._id));
  const seen = new Set<string>();
  if (orderedIds.length !== existing.length) {
    throw new ConvexError({
      code: "INVALID_REORDER",
      message: "orderedIds must list every item of the category exactly once.",
    });
  }
  for (const id of orderedIds) {
    if (!existingIds.has(id) || seen.has(id)) {
      throw new ConvexError({
        code: "INVALID_REORDER",
        message:
          "orderedIds must list every item of the category exactly once.",
      });
    }
    seen.add(id);
  }
  for (let i = 0; i < orderedIds.length; i += 1) {
    await ctx.db.patch(orderedIds[i] as Id<"menuItems">, { order: i });
  }
}

/** Read one item by id ONLY IF it belongs to `tenantId`; else `null`. */
export async function getTenantItem(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
): Promise<Doc<"menuItems"> | null> {
  const row = await ctx.db.get(itemId);
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/** Like `getTenantItem` but throws NOT_FOUND for a missing/foreign id. */
export async function requireTenantItem(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
): Promise<Doc<"menuItems">> {
  const row = await getTenantItem(ctx, tenantId, itemId);
  if (row === null) throw notFound("Item");
  return row;
}

/**
 * Insert a new item (created AVAILABLE, appended within its category). The
 * caller has already validated `body.categoryId` belongs to `tenantId`.
 */
export async function insertTenantItem(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  body: ItemBody,
): Promise<Id<"menuItems">> {
  const sameCategory = await listTenantItemsByCategory(
    ctx,
    tenantId,
    body.categoryId,
  );
  return ctx.db.insert("menuItems", {
    tenantId,
    categoryId: body.categoryId,
    name: body.name,
    description: body.description,
    basePrice: body.basePrice,
    allergens: body.allergens,
    available: true,
    order: sameCategory.length,
    createdAt: Date.now(),
  });
}

/** Patch an item's editable body + availability (owned by `tenantId`). */
export async function patchTenantItem(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
  body: ItemBody & { available: boolean },
): Promise<void> {
  const existing = await requireTenantItem(ctx, tenantId, itemId);
  const patch: Partial<Doc<"menuItems">> = {
    categoryId: body.categoryId,
    name: body.name,
    description: body.description,
    basePrice: body.basePrice,
    allergens: body.allergens,
    available: body.available,
  };
  // Stamp / clear the unavailability timestamp on a transition (drives the
  // later next-day auto-reactivation slice).
  if (existing.available && !body.available) {
    patch.unavailableSince = Date.now();
  } else if (!existing.available && body.available) {
    patch.unavailableSince = undefined;
  }
  await ctx.db.patch(itemId, patch);
}

/**
 * List the UNAVAILABLE items of one tenant (the candidate set the next-day
 * auto-reactivation walks). Keyed on `by_tenant`, filtered in memory to
 * `available === false` (the toggle-off rows). Scoped to `tenantId` by
 * construction — the cron passes each tenant id explicitly (ADR 0010).
 */
export async function listTenantUnavailableItems(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"menuItems">[]> {
  const rows = await ctx.db
    .query("menuItems")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return rows.filter((r) => !r.available);
}

/**
 * Flip ONE of the tenant's items between available / unavailable, stamping
 * `unavailableSince` on the off transition and clearing it on the on transition
 * (idempotent — re-setting the same value is a no-op patch). Re-checks tenant
 * ownership (NOT_FOUND for a missing/foreign id), so a foreign item is never
 * reachable. `nowMs` is injected so the stamp is deterministic in tests.
 */
export async function setTenantItemAvailability(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
  available: boolean,
  nowMs: number,
): Promise<void> {
  const item = await requireTenantItem(ctx, tenantId, itemId);
  const patch: Partial<Doc<"menuItems">> = { available };
  if (item.available && !available) {
    patch.unavailableSince = nowMs;
  } else if (!item.available && available) {
    patch.unavailableSince = undefined;
  }
  await ctx.db.patch(itemId, patch);
}

/**
 * Attach (or REPLACE) the stored photo of one of the tenant's items (2.2-F).
 * Re-checks tenant ownership (NOT_FOUND for a missing/foreign id), then — if the
 * item already had a photo — deletes the PREVIOUS blob before recording the new
 * `storageId`, so a replace never leaves an orphan blob in file storage. The new
 * `storageId` is only ever stored on a row the caller owns (ADR 0010).
 */
export async function setTenantItemPhoto(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
  storageId: Id<"_storage">,
): Promise<void> {
  const item = await requireTenantItem(ctx, tenantId, itemId);
  if (item.photoStorageId !== undefined && item.photoStorageId !== storageId) {
    await ctx.storage.delete(item.photoStorageId);
  }
  await ctx.db.patch(itemId, { photoStorageId: storageId });
}

/**
 * Remove the stored photo of one of the tenant's items (2.2-F): deletes the blob
 * (if any) and clears `photoStorageId`. Re-checks tenant ownership (NOT_FOUND for
 * a missing/foreign id). A no-op blob delete when the item has no photo.
 */
export async function clearTenantItemPhoto(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
): Promise<void> {
  const item = await requireTenantItem(ctx, tenantId, itemId);
  if (item.photoStorageId === undefined) return;
  await ctx.storage.delete(item.photoStorageId);
  await ctx.db.patch(itemId, { photoStorageId: undefined });
}

/**
 * Hard-delete an item owned by `tenantId`, cascading its N-N modifier links and
 * deleting its stored photo (if any). The shared modifier GROUPS are NOT touched
 * — only the edges referencing this item.
 */
export async function deleteTenantItem(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
): Promise<void> {
  const item = await requireTenantItem(ctx, tenantId, itemId);
  const links = await ctx.db
    .query("menuItemModifierGroups")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  if (item.photoStorageId !== undefined) {
    await ctx.storage.delete(item.photoStorageId);
  }
  await ctx.db.delete(itemId);
}

// ---------------------------------------------------------------------------
// modifierGroups (reusable)
// ---------------------------------------------------------------------------

/** The mutable body of a reusable modifier group. */
export type ModifierGroupBody = {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
};

/** List ALL reusable modifier groups of one tenant, keyed on `by_tenant`. */
export async function listTenantModifierGroups(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"modifierGroups">[]> {
  return ctx.db
    .query("modifierGroups")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

/** Read one group by id ONLY IF it belongs to `tenantId`; else `null`. */
export async function getTenantModifierGroup(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  modifierGroupId: Id<"modifierGroups">,
): Promise<Doc<"modifierGroups"> | null> {
  const row = await ctx.db.get(modifierGroupId);
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/** Like `getTenantModifierGroup` but throws NOT_FOUND for a missing/foreign id. */
export async function requireTenantModifierGroup(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  modifierGroupId: Id<"modifierGroups">,
): Promise<Doc<"modifierGroups">> {
  const row = await getTenantModifierGroup(ctx, tenantId, modifierGroupId);
  if (row === null) throw notFound("Modifier group");
  return row;
}

/** Insert a new reusable modifier group for `tenantId`. Returns the new id. */
export async function insertTenantModifierGroup(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  body: ModifierGroupBody,
): Promise<Id<"modifierGroups">> {
  return ctx.db.insert("modifierGroups", {
    tenantId,
    name: body.name,
    minSelect: body.minSelect,
    maxSelect: body.maxSelect,
    options: body.options,
    createdAt: Date.now(),
  });
}

/**
 * Patch a reusable group owned by `tenantId`. Because the link table references
 * the group BY ID, this single write is what makes the edit reflect on EVERY
 * item the group is attached to (no per-item copy).
 */
export async function patchTenantModifierGroup(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  modifierGroupId: Id<"modifierGroups">,
  body: ModifierGroupBody,
): Promise<void> {
  await requireTenantModifierGroup(ctx, tenantId, modifierGroupId);
  await ctx.db.patch(modifierGroupId, {
    name: body.name,
    minSelect: body.minSelect,
    maxSelect: body.maxSelect,
    options: body.options,
  });
}

/**
 * Hard-delete a reusable group owned by `tenantId`, cascading EVERY edge that
 * references it (so no item keeps a dangling group). Keyed on `by_group`.
 */
export async function deleteTenantModifierGroup(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  modifierGroupId: Id<"modifierGroups">,
): Promise<void> {
  await requireTenantModifierGroup(ctx, tenantId, modifierGroupId);
  const edges = await ctx.db
    .query("menuItemModifierGroups")
    .withIndex("by_group", (q) => q.eq("modifierGroupId", modifierGroupId))
    .collect();
  for (const edge of edges) {
    await ctx.db.delete(edge._id);
  }
  await ctx.db.delete(modifierGroupId);
}

// ---------------------------------------------------------------------------
// menuItemModifierGroups (N-N link)
// ---------------------------------------------------------------------------

/** The single (item, group) edge, scoped to `tenantId`; `null` if absent. */
async function getTenantLink(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
  modifierGroupId: Id<"modifierGroups">,
): Promise<Doc<"menuItemModifierGroups"> | null> {
  const row = await ctx.db
    .query("menuItemModifierGroups")
    .withIndex("by_item_group", (q) =>
      q.eq("itemId", itemId).eq("modifierGroupId", modifierGroupId),
    )
    .unique();
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/**
 * Attach `modifierGroupId` to `itemId` (both owned by `tenantId`). Idempotent:
 * a second attach of the same pair is a no-op. The new edge is appended at the
 * end of the item's group order.
 */
export async function attachTenantGroupToItem(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
  modifierGroupId: Id<"modifierGroups">,
): Promise<void> {
  await requireTenantItem(ctx, tenantId, itemId);
  await requireTenantModifierGroup(ctx, tenantId, modifierGroupId);
  const existing = await getTenantLink(ctx, tenantId, itemId, modifierGroupId);
  if (existing !== null) return; // idempotent
  const itemLinks = await ctx.db
    .query("menuItemModifierGroups")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .collect();
  await ctx.db.insert("menuItemModifierGroups", {
    tenantId,
    itemId,
    modifierGroupId,
    order: itemLinks.length,
  });
}

/**
 * Detach `modifierGroupId` from `itemId` (owned by `tenantId`): removes ONLY
 * that single edge — sibling links and the group itself are untouched. A no-op
 * if the edge does not exist.
 */
export async function detachTenantGroupFromItem(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
  modifierGroupId: Id<"modifierGroups">,
): Promise<void> {
  await requireTenantItem(ctx, tenantId, itemId);
  await requireTenantModifierGroup(ctx, tenantId, modifierGroupId);
  const edge = await getTenantLink(ctx, tenantId, itemId, modifierGroupId);
  if (edge === null) return;
  await ctx.db.delete(edge._id);
}

/**
 * The reusable groups attached to ONE item (owned by `tenantId`), ordered by the
 * edge `order`. Resolves each edge's group BY ID, so an edit on a shared group is
 * reflected here for every item it is attached to.
 */
export async function listTenantItemModifierGroups(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  itemId: Id<"menuItems">,
): Promise<Doc<"modifierGroups">[]> {
  await requireTenantItem(ctx, tenantId, itemId);
  const edges = await ctx.db
    .query("menuItemModifierGroups")
    .withIndex("by_item", (q) => q.eq("itemId", itemId))
    .collect();
  edges.sort((a, b) => a.order - b.order);
  const groups: Doc<"modifierGroups">[] = [];
  for (const edge of edges) {
    const group = await getTenantModifierGroup(
      ctx,
      tenantId,
      edge.modifierGroupId,
    );
    if (group !== null) groups.push(group);
  }
  return groups;
}

/**
 * The items reusing ONE group (owned by `tenantId`) — the impact set of a group
 * edit. Keyed on `by_group`, resolves each edge's item BY ID.
 */
export async function listTenantModifierGroupItems(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  modifierGroupId: Id<"modifierGroups">,
): Promise<Doc<"menuItems">[]> {
  await requireTenantModifierGroup(ctx, tenantId, modifierGroupId);
  const edges = await ctx.db
    .query("menuItemModifierGroups")
    .withIndex("by_group", (q) => q.eq("modifierGroupId", modifierGroupId))
    .collect();
  const items: Doc<"menuItems">[] = [];
  for (const edge of edges) {
    const item = await getTenantItem(ctx, tenantId, edge.itemId);
    if (item !== null) items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// publishedMenus — B-MENU-PUBLICATION slice 1 (ADR 0015 + ADR 0010)
// ---------------------------------------------------------------------------
//
// The [[Instantané publié]] table is one-doc-per-tenant: the structured payload
// the PWA mangeur reads from once the publication pipeline is wired (slices
// 2–6). The « one doc per tenant » uniqueness is a STRUCTURAL invariant of
// these helpers — `writePublishedMenu` always deletes any existing row before
// inserting the new one in the same Convex tx (atomic replace, no leftover).
// The snapshot does NOT carry `available` (ADR 0015 pivot, enforced at the
// schema level + a type-level assertion in `menuStore.test.ts`).

/**
 * Read the current [[Instantané publié]] of `tenantId`, or `null` if the tenant
 * has never been published. Keyed on `by_tenant`, `unique()` since the helpers
 * keep at most one row per tenant (structural invariant of `writePublishedMenu`).
 */
export async function getPublishedMenu(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"publishedMenus"> | null> {
  return ctx.db
    .query("publishedMenus")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
}

/**
 * Atomically REPLACE the [[Instantané publié]] of `tenantId` with `payload`,
 * stamping `publishedAt = nowMs`. Inside ONE Convex mutation tx: delete any
 * existing snapshot row of this tenant, then insert the new one — so a second
 * call to the same tenant fully replaces the previous snapshot (no leftover old
 * rows, ADR 0015 atomicity contract). `nowMs` is injected so the timestamp is
 * deterministic in tests (mirror of `setTenantItemAvailability`).
 *
 * The caller has already validated the `payload` shape (the schema validator on
 * `publishedMenus.payload` would reject anything else at write time anyway).
 */
export async function writePublishedMenu(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  payload: PublishedMenuPayload,
  nowMs: number,
): Promise<void> {
  const existing = await ctx.db
    .query("publishedMenus")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const row of existing) {
    await ctx.db.delete(row._id);
  }
  await ctx.db.insert("publishedMenus", {
    tenantId,
    publishedAt: nowMs,
    payload,
  });
}

/**
 * Wipe the [[Instantané publié]] of `tenantId` (idempotent — a no-op if the
 * tenant has never been published). Used by the slice 8 tenant-lifecycle cleanup
 * paths (a tenant suspended / off-boarded must not keep a published menu
 * indexed). Tenant-scoped via the `by_tenant` index — never reaches another
 * tenant's row.
 */
export async function deletePublishedMenu(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<void> {
  const existing = await ctx.db
    .query("publishedMenus")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const row of existing) {
    await ctx.db.delete(row._id);
  }
}

/**
 * B-MENU-PUBLICATION slice 5 (#176) — earliest `_creationTime` strictly greater
 * than `sinceMs` across the FOUR live draft tables of `tenantId`
 * (`menuCategories`, `menuItems`, `modifierGroups`, `menuItemModifierGroups`),
 * or `null` if none.
 *
 * Powers the `changedSince` field of `hasUnpublishedChanges` (ADR 0015 «
 * indicateur modifications non publiées »): it's a best-effort LOWER bound on
 * « when did unpublished changes first appear » since Convex doesn't refresh
 * `_creationTime` on a patch (so pure renames/edits don't bump it, by design).
 * The boolean answer is computed elsewhere via deep-equality of the projection
 * — this seam only supplies the timestamp hint.
 *
 * Tenant-scoped by construction: each table is read on its `by_tenant` index
 * (the link table carries `tenantId` denormalised for exactly this kind of fan
 * read, cf. table comment), so a foreign row is never reachable.
 */
export async function earliestDraftCreationTimeSince(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  sinceMs: number,
): Promise<number | null> {
  let earliest: number | null = null;
  const consider = (t: number) => {
    if (t > sinceMs && (earliest === null || t < earliest)) {
      earliest = t;
    }
  };
  const cats = await ctx.db
    .query("menuCategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const c of cats) consider(c._creationTime);
  const items = await ctx.db
    .query("menuItems")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const i of items) consider(i._creationTime);
  const groups = await ctx.db
    .query("modifierGroups")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const g of groups) consider(g._creationTime);
  // The N-N link table has no `by_tenant` index (it's normally walked by item or
  // group) — but it CARRIES `tenantId`, so we walk per-item to stay tenant-scoped
  // (ADR 0010): an attacker can never reach a foreign edge from here because we
  // only enter via items already filtered on `tenantId`.
  for (const i of items) {
    const edges = await ctx.db
      .query("menuItemModifierGroups")
      .withIndex("by_item", (q) => q.eq("itemId", i._id))
      .collect();
    for (const e of edges) consider(e._creationTime);
  }
  return earliest;
}

/**
 * B-MENU-PUBLICATION slice 5 (#176) — "is there any DRAFT row at all for this
 * tenant?" across the FOUR live draft tables. Powers the V1 indicator's
 * `hasChanges` answer in the « never published » edge:
 *   - never published + empty draft  ⇒ hasChanges = false
 *   - never published + non-empty   ⇒ hasChanges = true
 *
 * Tenant-scoped via `by_tenant` (same discipline as `earliestDraftCreationTimeSince`).
 */
export async function hasAnyDraftRow(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<boolean> {
  const oneCat = await ctx.db
    .query("menuCategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .first();
  if (oneCat !== null) return true;
  const oneItem = await ctx.db
    .query("menuItems")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .first();
  if (oneItem !== null) return true;
  const oneGroup = await ctx.db
    .query("modifierGroups")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .first();
  if (oneGroup !== null) return true;
  return false;
}

/**
 * B-MENU-PUBLICATION slice 3 (#160) — bulk-read the LIVE `available` flag for a
 * set of item ids OWNED by `tenantId`, returned as a `Map<itemId, boolean>`.
 *
 * Why a dedicated helper: ADR 0015's pivot keeps `available` OFF the snapshot
 * (« la rupture ne doit pas exiger une republication globale »), so
 * `getPublicMenu` reads each item's availability LIVE on top of the snapshot
 * payload. This seam is the sanctioned bulk-read used by that overlay — same
 * tenant-scoping discipline as every other helper here (re-checks ownership
 * before reporting, so a foreign id is silently omitted, never leaked).
 *
 * Missing rows (foreign / deleted live row) are deliberately omitted from the
 * map — the caller treats "not in map" as `available: false` (safe default:
 * the eater never sees a phantom item as orderable, and a tenant boundary
 * cross is structurally impossible from here).
 */
export async function readTenantItemsAvailability(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  itemIds: Id<"menuItems">[],
): Promise<Map<Id<"menuItems">, boolean>> {
  const map = new Map<Id<"menuItems">, boolean>();
  for (const id of itemIds) {
    const row = await ctx.db.get(id);
    if (row === null || row.tenantId !== tenantId) continue;
    map.set(id, row.available);
  }
  return map;
}
