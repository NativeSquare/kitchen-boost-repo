import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  deleteTenantCategory,
  insertTenantCategory,
  listTenantCategories,
  renameTenantCategory,
  reorderTenantCategories,
  tenantMutation,
  tenantQuery,
} from "../tenancy";

/**
 * 2.2-B — `menuCategories` tenant-scoped CRUD (PRD 10 §5, client-ordering
 * CONTEXT "Category", ADR 0010).
 *
 * Every function goes through a tenancy wrapper (`tenantQuery` / `tenantMutation`,
 * default `allow: ["kb_manager"]`; a `kb_admin` passes via the root override,
 * `staff` does not). The handlers never touch raw `ctx.db` — they reach the table
 * only through the sanctioned `lib/tenancy/menuStore` seam, scoped to
 * `ctx.tenantId`, so a resto can only ever read/modify its OWN categories
 * (`no-untenanted-query` + the cross-tenant fuzz suite enforce this).
 *
 * Flat list, no hierarchy V1 (Q10-Q8b). New categories append at the end; the
 * display order is rewritten atomically by `reorder`.
 */

/** List the calling tenant's categories, ordered for display. */
export const list = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<Doc<"menuCategories">[]> =>
    listTenantCategories(ctx, ctx.tenantId),
});

/** Create a category (appended at the end). Returns the new id. */
export const create = tenantMutation()({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<Id<"menuCategories">> =>
    insertTenantCategory(ctx, ctx.tenantId, args.name),
});

/** Rename one of the tenant's own categories (NOT_FOUND for a foreign id). */
export const rename = tenantMutation()({
  args: { categoryId: v.id("menuCategories"), name: v.string() },
  handler: async (ctx, args): Promise<void> =>
    renameTenantCategory(ctx, ctx.tenantId, args.categoryId, args.name),
});

/**
 * Rewrite the display order of the tenant's categories. `orderedIds` MUST list
 * every category of the tenant exactly once (else throws) — no silent partial.
 */
export const reorder = tenantMutation()({
  args: { orderedIds: v.array(v.id("menuCategories")) },
  handler: async (ctx, args): Promise<void> =>
    reorderTenantCategories(ctx, ctx.tenantId, args.orderedIds),
});

/** Hard-delete one of the tenant's categories (NOT_FOUND for a foreign id). */
export const remove = tenantMutation()({
  args: { categoryId: v.id("menuCategories") },
  handler: async (ctx, args): Promise<void> =>
    deleteTenantCategory(ctx, ctx.tenantId, args.categoryId),
});
