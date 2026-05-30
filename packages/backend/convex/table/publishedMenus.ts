import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";
import { allergen } from "./menuItems";
import { modifierOption } from "./modifierGroups";

/**
 * B-MENU-PUBLICATION slice 1 — `publishedMenus` (ADR 0015 + ADR 0010).
 *
 * The [[Instantané publié]] of a tenant: the source-of-truth structured payload
 * the PWA mangeur reads from once the publication pipeline is wired (slices 2–6).
 *
 * Decision (ADR 0015): **one doc per tenant**, holding the full structured
 * snapshot (categories ordered → items → resolved modifier groups +
 * `photoStorageId`). Rebuilt entirely from the live brouillon (`menuCategories`
 * / `menuItems` / `modifierGroups` / `menuItemModifierGroups`) at every publish,
 * atomically inside ONE Convex tx (delete-old + insert-new). No per-entity
 * publication, no versioning V1 (ADR 0015 § Considered options 3 + 4 deferred V2).
 *
 * KEY INVARIANT (ADR 0015 pivot, « la rupture ne doit pas exiger une
 * republication globale »): the snapshot does **NOT** carry `available`. The
 * `available` flag stays an overlay read LIVE from `menuItems` at PWA read time
 * (slice 6) — so toggling « out of stock » never triggers a republication. Photos
 * are stored as `photoStorageId` (not resolved URLs) so the snapshot stays
 * immutable while URLs are resolved at read time by `ctx.storage.getUrl`.
 *
 * TENANT-SCOPED (carries `tenantId`, ADR 0010): the table is reached ONLY through
 * the sanctioned seam `lib/tenancy/menuStore.ts` — never raw `ctx.db` in business
 * code (lint rule `no-untenanted-query`). Uniqueness « one doc per tenant » is a
 * STRUCTURAL invariant of the seam: `writePublishedMenu` always deletes any
 * existing row before inserting the new one in the same tx. Indexed `by_tenant`
 * — the only access path.
 */

/**
 * One modifier group inside the snapshot — the form the PWA consumes. The eater
 * never edits these, only renders them; persisting the form already projected to
 * the public shape (vs an FK into `modifierGroups`) is what makes the snapshot
 * a true source of truth: a later edit on the live brouillon group never mutates
 * a past published version (cohérent avec `orderItems` qui est aussi un snapshot
 * figé, ADR 0015 « Pourquoi ce choix »).
 */
export const publishedModifierGroup = v.object({
  _id: v.id("modifierGroups"),
  name: v.string(),
  minSelect: v.number(),
  maxSelect: v.number(),
  options: v.array(modifierOption),
});

/**
 * One item inside the snapshot — base price, allergens, the OPTIONAL stored
 * photo (resolved to a URL only at PWA read time), and the resolved attached
 * modifier groups. Deliberately NO `available` field — `available` stays a live
 * overlay read from `menuItems` (ADR 0015 pivot, enforced by the type-level
 * assertion in `menuStore.test.ts`).
 */
export const publishedMenuItem = v.object({
  _id: v.id("menuItems"),
  name: v.string(),
  description: v.string(),
  basePrice: v.number(), // CENTIMES (integer), same units as `menuItems.basePrice`
  allergens: v.array(allergen),
  photoStorageId: v.optional(v.id("_storage")),
  modifierGroups: v.array(publishedModifierGroup),
});

/** One category inside the snapshot, in display order. */
export const publishedMenuCategory = v.object({
  _id: v.id("menuCategories"),
  name: v.string(),
  items: v.array(publishedMenuItem),
});

/** The full structured snapshot payload of one tenant. */
export const publishedMenuPayload = v.object({
  categories: v.array(publishedMenuCategory),
});

/** TS-level shape inferred from the validator (single source of truth). */
export type PublishedMenuPayload = Infer<typeof publishedMenuPayload>;

export const publishedMenus = defineTable({
  tenantId: v.id("tenants"),
  publishedAt: v.number(), // ms epoch, stamped at write time
  payload: publishedMenuPayload,
}).index("by_tenant", ["tenantId"]);
