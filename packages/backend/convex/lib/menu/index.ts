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
 *    `update` / `reorder` / `remove` (allergens = subset of the 14 frozen
 *    UE 1169/2011; delete cascades N-N links + stored photo, leaving shared
 *    groups intact). `reorder({ categoryId, orderedIds })` (#209) is the
 *    strict mirror of `categories.reorder`: refuses partial / duplicate /
 *    foreign id sets.
 *  - `modifiers.*` — REUSABLE modifier groups + the N-N item↔group link:
 *    `listGroups` / `createGroup` / `updateGroup` / `removeGroup` /
 *    `attachGroupToItem` / `detachGroupFromItem` / `listItemGroups` /
 *    `listGroupItems`. A group is created once and reused across N items; an edit
 *    reflects on every linked item, a detach leaves siblings + the group intact.
 *
 * 2.2-C — the PUBLIC (unauthenticated) eater-facing READ on top of the same
 * tables, via the foundation `publicTenantQuery` (NO kb_manager rights), still
 * tenant-scoped through the `menuStore` seam. Sourced from the [[Instantané
 * publié]] since B-MENU-PUBLICATION slice 3 (#160, ADR 0015):
 *  - `catalog.getPublicMenu` — the UNIQUE eater surface: categories ordered →
 *    items (incl. unavailable, with the availability flag) → modifier groups
 *    resolved via the N-N link (options + priceDelta + min/max). Read-only, no
 *    public mutation twin. Reads the snapshot (`getPublishedMenu`) — a tenant
 *    that has never published returns `{ categories: [] }`. `available` is read
 *    LIVE from `menuItems` via `readTenantItemsAvailability` (ADR 0015 pivot:
 *    the rupture toggle does NOT trigger a republication). `photoUrl` is
 *    resolved at read time from the snapshot `photoStorageId`.
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
 * 2.2-D / 2.2-fix (#105) — [[Item out of stock]] toggle + auto-réactivation à la
 * première ouverture de service après `unavailableSince` (PRD 10 §edge "Item out
 * of stock", client-ordering CONTEXT, multi-tenant CONTEXT `staff`, ADR 0010):
 * 2.2-F — [[Item]] photos via NATIVE Convex file storage (PRD 10 §5/§6,
 * client-ordering CONTEXT, ADR 0010). The KB Manager uploads a photo and
 * attaches it to an item; the URL is served read-side (already wired into
 * `getPublicMenu`):
 *  - `photos.generateUploadUrl` — `tenantMutation` (kb_manager) minting a
 *    short-lived upload URL (tenant-scoped, unlike the ungated template twin).
 *  - `photos.attachPhoto` — records the `_storage` id on one of the caller's
 *    items via the `menuStore` seam; replacing deletes the previous blob.
 *  - `photos.removePhoto` — deletes the blob + clears the field. Item deletion
 *    (slice B) and replacement leave no orphan blob.
 *
 *  - `availability.setItemAvailability` — `tenantMutation` (kb_manager + staff)
 *    flipping an item's `available` and stamping / clearing `unavailableSince`.
 *  - The auto-reactivation runs from the `crons.ts` Convex cron, which calls this
 *    module's `reactivateAllTenantsUnavailableItems` per tenant; the decision is
 *    the pure `itemsToReactivate` (windows + items + Europe/Paris clock → ids):
 *    an item returns at the FIRST service-opening boundary strictly after its
 *    `unavailableSince` (#105 — corrects #56's hardcoded "lendemain"), so an item
 *    toggled off before the day's opening comes back the SAME day. Tested in
 *    isolation. The reactivation helpers are plain functions (NOT registered
 *    Convex functions) — re-exported here for the cron.
 *
 * B-MENU-PUBLICATION slice 2 — atomic snapshot build for the [[Instantané publié]]
 * (ADR 0015 « édition brouillon → publication globale atomique »):
 *  - `publication.publishMenu` — `tenantMutation({ allow: ["kb_manager"] })`
 *    (kb_admin via root override) that walks the draft via the sanctioned
 *    `menuStore` seam, projects it to `PublishedMenuPayload` (categories ordered,
 *    items minus `available`, modifier groups resolved with min/max + options),
 *    and calls `writePublishedMenu` once — the seam atomic-replaces the previous
 *    snapshot in the same Convex tx. Republication = écrasement atomique (no
 *    versioning V1, ADR 0015). `available` stays a LIVE overlay, NOT snapshotted
 *    (the rupture 1-tap from the KDS never triggers a republication).
 *
 * B-MENU-PUBLICATION slice 4 (#166) — admin « Aperçu » reads the live draft as
 * the PWA would render the published snapshot (ADR 0015 « Aperçu admin lit le
 * brouillon »):
 *  - `publication.previewMenu` — `tenantQuery({ allow: ["kb_manager"] })`
 *    (kb_admin via root override, staff REJECTED) that walks the draft via the
 *    SAME shared `buildSnapshotPayload` helper used by `publishMenu` (DRY
 *    enforced — the two surfaces can never drift), then applies the same
 *    READ-time overlays as `getPublicMenu` (`photoUrl` via `ctx.storage.getUrl`,
 *    live `available` from `menuItems`). Returns the same `PublicMenu` wire
 *    contract as `getPublicMenu`, so the front renders it through the exact
 *    same component. Lets the gérant verify unpublished changes before clicking
 *    « Publier ».
 *
 * B-MENU-PUBLICATION slice 5 (#176) — editor « modifications non publiées »
 * indicator (ADR 0015 « Un indicateur "modifications non publiées" »):
 *  - `publication.hasUnpublishedChanges` — `tenantQuery({ allow: ["kb_manager"] })`
 *    (kb_admin via root override, staff REJECTED). Returns
 *    `{ hasChanges, lastPublishedAt, changedSince }`. Computes `hasChanges` by
 *    projecting the live draft via the SHARED `buildSnapshotPayload` and
 *    deep-equating with the published payload — so renames/edits/attach/detach
 *    flip the flag even though Convex doesn't refresh `_creationTime` on
 *    patches. The `available` toggle is NOT considered an unpublished change
 *    (live overlay, not in payload — ADR 0015 pivot). `changedSince` is a
 *    best-effort lower bound (earliest draft `_creationTime` strictly newer
 *    than `lastPublishedAt`), `null` when undeterminable from `_creationTime`.
 */
export * as availability from "./availability";
export * as catalog from "./catalog";
export * as categories from "./categories";
export * as items from "./items";
export * as modifiers from "./modifiers";
export * as photos from "./photos";
export * as publication from "./publication";
export * as serviceHours from "./serviceHours";
