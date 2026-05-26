/**
 * Public API of the `menu` backend module (chantier 2.2 — Menu edition côté
 * [[KB Manager]], PRD 10 §5/§6, client-ordering CONTEXT, ADR 0010).
 *
 * 2.2-B — the TENANT-SCOPED CRUD on top of the menu schema (#43). Every function
 * goes through the tenancy wrappers (`tenantQuery` / `tenantMutation`, default
 * `allow: ["kb_manager"]`, root override for `kb_admin`) and reaches the five
 * menu tables ONLY through the sanctioned `lib/tenancy/menuStore` seam — never
 * raw `ctx.db` in this business module (ADR 0010 / `no-untenanted-query`). Each
 * module ships its cross-tenant fuzz suite.
 *
 * Convex registers functions by their module PATH, so callers invoke the CRUD as
 * `api.lib.menu.{categories,items,modifiers}.<fn>`; re-exporting here does not
 * change those paths — it states the module's contract in one place.
 *
 *  - `categories.*` — flat editorial groups: `list` / `create` / `rename` /
 *    `reorder` / `remove` (no hierarchy V1).
 *  - `items.*` — sellable products: `list` / `listByCategory` / `create` /
 *    `update` / `remove` (allergens = subset of the 14 frozen UE 1169/2011;
 *    delete cascades N-N links + stored photo, leaving shared groups intact).
 *  - `modifiers.*` — REUSABLE modifier groups + the N-N item↔group link:
 *    `listGroups` / `createGroup` / `updateGroup` / `removeGroup` /
 *    `attachGroupToItem` / `detachGroupFromItem` / `listItemGroups` /
 *    `listGroupItems`. A group is created once and reused across N items; an edit
 *    reflects on every linked item, a detach leaves siblings + the group intact.
 *
 * 2.2-C — the PUBLIC (unauthenticated) eater-facing READ on top of the same
 * tables, via the foundation `publicTenantQuery` (NO kb_manager rights), still
 * tenant-scoped through the `menuStore` seam:
 *  - `catalog.getPublicMenu` — the UNIQUE eater surface: categories ordered →
 *    items (incl. unavailable, with the availability flag) → modifier groups
 *    resolved via the N-N link (options + priceDelta + min/max). Read-only, no
 *    public mutation twin.
 *
 * 2.2-E — [[Plage horaire de service]] + `isOpenNow` (PRD 10 §4 / edge "resto
 * fermé", delivery CONTEXT, ADR 0010). KB is the SOURCE OF TRUTH of the resto's
 * opening:
 *  - `serviceHours.get` / `serviceHours.set` — tenant-scoped CRUD (kb_manager) of
 *    the single shared delivery + C&C slot (Europe/Paris).
 *  - `serviceHours.isOpenNow` — PUBLIC, unauthenticated gate read by the checkout
 *    (out of window ⇒ payment blocked). Decision is a pure function
 *    (`isWithinServiceHours`), tested deterministically on injected clocks.
 *
 * 2.2-D — [[Item out of stock]] toggle + auto-réactivation au lendemain (PRD 10
 * §edge "Item out of stock", client-ordering CONTEXT, multi-tenant CONTEXT
 * `staff`, ADR 0010):
 *  - `availability.setItemAvailability` — `tenantMutation` (kb_manager + staff)
 *    flipping an item's `available` and stamping / clearing `unavailableSince`.
 *  - The next-day auto-reactivation runs from the `crons.ts` Convex cron, which
 *    calls this module's `reactivateAllTenantsUnavailableItems` per tenant; the
 *    decision is the pure `itemsToReactivate` (windows + items + Europe/Paris
 *    clock → ids), tested in isolation. The reactivation helpers are plain
 *    functions (NOT registered Convex functions) — re-exported here for the cron.
 */
export * as availability from "./availability";
export * as catalog from "./catalog";
export * as categories from "./categories";
export * as items from "./items";
export * as modifiers from "./modifiers";
export * as serviceHours from "./serviceHours";
