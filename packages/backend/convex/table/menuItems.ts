import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";

/**
 * 2.2-A — `menuItems` (PRD 10 §5/§6, client-ordering CONTEXT "Item" /
 * "Allergènes", ADR 0010).
 *
 * A sellable product of a tenant's menu (e.g. "Smash Burger Double"): a base
 * price, allergen declarations, an availability toggle, and an editorial order
 * within its category. TENANT-SCOPED (carries `tenantId`, ADR 0010): every
 * read/write goes through the tenancy wrappers and the `no-untenanted-query`
 * rule applies; the module ships cross-tenant fuzz coverage. Indexed `by_tenant`
 * (full menu of a resto) and `by_category` (one category's items).
 *
 * `basePrice` is in CENTIMES (integer), like every monetary amount in the schema
 * (cf. `pricingRules`, `orders`). Frozen at order time into `orderItems` (2.3-A,
 * a denormalised snapshot — NOT an FK), so editing the menu never mutates a past
 * order (PRD 10 §7).
 *
 * `allergens` is a subset of the FROZEN 14-allergen UE 1169/2011 set (literal
 * union, NOT free text — Q10-Q6 acté 2026-05-24, mandatory declaration for
 * distance selling). The resto ticks the applicable boxes item-by-item from KB
 * Admin (matrice items × 14). KB stores them; the resto stays legally
 * responsible for the truthfulness of the declarations.
 *
 * `available` + `unavailableSince` back the "Item out of stock" toggle (1-tap
 * from the KDS, client-ordering CONTEXT): `available=false` greys the item out
 * on the PWA; `unavailableSince` timestamps the toggle so the next-day
 * auto-reactivation logic (a later 2.2 slice, against `serviceHours`) can flip
 * it back. No physical stock sync in V1.
 */

/**
 * The 14 mandatory allergens of EU Regulation 1169/2011 (FROZEN closed list,
 * canonical FR wording from the client-ordering CONTEXT "Allergènes"). The
 * literal union below is built from this tuple so the persisted values and the
 * later CRUD args share ONE source of truth; the array is exported so a slice /
 * the PWA can render the full checklist without re-declaring it. Order is the
 * canonical regulatory order.
 */
export const ALLERGENS_UE_1169 = [
  "gluten",
  "crustacés",
  "œufs",
  "poissons",
  "arachides",
  "soja",
  "lait",
  "fruits à coque",
  "céleri",
  "moutarde",
  "graines de sésame",
  "sulfites",
  "lupin",
  "mollusques",
] as const;

/** One of the 14 UE 1169/2011 allergens — a frozen literal, never free text. */
export const allergen = v.union(...ALLERGENS_UE_1169.map((a) => v.literal(a)));

export type Allergen = Infer<typeof allergen>;

export const menuItems = defineTable({
  tenantId: v.id("tenants"),
  categoryId: v.id("menuCategories"),
  name: v.string(),
  description: v.string(),
  basePrice: v.number(), // CENTIMES (integer)
  // Optional product photo, stored in Convex file storage (set when uploaded).
  photoStorageId: v.optional(v.id("_storage")),
  // Subset of the 14 frozen UE 1169/2011 allergens (literal union, not strings).
  allergens: v.array(allergen),
  // "Item out of stock" toggle (client-ordering CONTEXT). available=false greys
  // the item on the PWA and blocks add-to-cart.
  available: v.boolean(),
  // Timestamp of the last manual unavailability toggle — drives next-day
  // auto-reactivation (a later 2.2 slice). Absent while available.
  unavailableSince: v.optional(v.number()),
  // Editorial display order within the category.
  order: v.number(),
  createdAt: v.number(),
})
  .index("by_tenant", ["tenantId"])
  .index("by_category", ["categoryId"]);
