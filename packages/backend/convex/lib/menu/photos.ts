import { v } from "convex/values";
import {
  clearTenantItemPhoto,
  setTenantItemPhoto,
  tenantMutation,
} from "../tenancy";

/**
 * 2.2-F — item photos via the NATIVE Convex file storage (no external bucket V1;
 * PRD 10 §5/§6, client-ordering CONTEXT "Item", ADR 0010).
 *
 * The [[KB Manager]] flow is the standard Convex two-step upload, kept fully
 * tenant-scoped:
 *  1. `generateUploadUrl` — a `kb_manager` `tenantMutation` minting a short-lived
 *     upload URL. The browser POSTs the file bytes directly to that URL (the blob
 *     never transits this backend) and gets back a `_storage` id. The wrapper
 *     gate is what makes minting an upload URL a tenant-scoped, kb_manager-only
 *     privilege — unlike the template's ungated `api.storage.generateUploadUrl`.
 *  2. `attachPhoto` — records that `_storage` id on one of the CALLER's items
 *     through the sanctioned `menuStore` seam (NOT raw `ctx.db`). Re-attaching
 *     replaces the photo and the store deletes the previous blob, so no orphan.
 *
 * `removePhoto` deletes the blob and clears the field. The READ side is already
 * wired: `catalog.getPublicMenu` (slice C) resolves `item.photoStorageId` to a
 * URL via `ctx.storage.getUrl`, and item deletion (slice B) cleans the blob.
 *
 * Cross-tenant isolation is STRUCTURAL: every mutation goes through
 * `requireTenantItem(ctx.tenantId, …)` in the store, so a kb_manager of tenant A
 * can never attach/replace/remove a photo on tenant B's item (NOT_FOUND), and the
 * wrapper itself throws Forbidden for any actor without the role on the tenant
 * (ADR 0010, fuzzed in `photos.test.ts`). No file content-type / size limit is
 * enforced here — the PRD specifies none for V1 (do not invent one).
 */

/**
 * Mint a short-lived upload URL for a tenant's photo (kb_manager). The client
 * uploads the file to this URL directly; the returned `_storage` id is then
 * passed to `attachPhoto`.
 */
export const generateUploadUrl = tenantMutation()({
  args: {},
  handler: async (ctx): Promise<string> => ctx.storage.generateUploadUrl(),
});

/**
 * Attach (or REPLACE) the photo of one of the tenant's items. Replacing an
 * existing photo deletes the previous blob (no orphan). Refuses a foreign
 * `itemId` (NOT_FOUND).
 */
export const attachPhoto = tenantMutation()({
  args: {
    itemId: v.id("menuItems"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<void> =>
    setTenantItemPhoto(ctx, ctx.tenantId, args.itemId, args.storageId),
});

/**
 * Remove the photo of one of the tenant's items: deletes the blob and clears the
 * field (no-op if the item has none). Refuses a foreign `itemId` (NOT_FOUND).
 */
export const removePhoto = tenantMutation()({
  args: { itemId: v.id("menuItems") },
  handler: async (ctx, args): Promise<void> =>
    clearTenantItemPhoto(ctx, ctx.tenantId, args.itemId),
});
