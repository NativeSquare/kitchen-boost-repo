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
 */
export * as categories from "./categories";
export * as items from "./items";
export * as modifiers from "./modifiers";
