import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Allergen } from "../../table/menuItems";
import type { ModifierOption } from "../../table/modifierGroups";

/**
 * 2.2-B — the SANCTIONED tenant-scoped data-access seam for the FIVE menu tables
 * (`menuCategories`, `menuItems`, `modifierGroups`, `menuItemModifierGroups`),
 * the isolation discipline of ADR 0010.
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
