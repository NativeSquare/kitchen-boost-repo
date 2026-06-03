/**
 * Public API of the `item-availability` native module (#408 KB Orders,
 * PRD 20 §7c + ADR 0018 frontière disponibilité commerciale / édition
 * catalogue).
 *
 * Three concerns surface here, sharing the « Toggle dispo item » spec :
 *
 *  - `ItemAvailabilityEntry` — React entry pill mounted on the home strip,
 *    sibling of `<PauseControl />` (#406) and `<ClosureControl />` (#407).
 *    One-tap navigator to the list route. Hidden while the active tenant
 *    is still resolving.
 *
 *  - `ItemAvailabilityList` — React screen for `/disponibilite-items`.
 *    Lists every category + items of the active tenant with a per-item
 *    switch (lecture + toggle, PAS d'édition catalogue, ADR 0018). The
 *    first usage on a device surfaces the PRD-frozen tooltip
 *    (`ITEM_TOGGLE_TOOLTIP_TEXT`) BEFORE firing the mutation; subsequent
 *    usages are silent (flag `device.itemToggleTooltipSeen`,
 *    `markItemToggleTooltipSeen`).
 *
 *  - `decideTooltipGate` / `decideItemListEntryPoint` /
 *    `ITEM_TOGGLE_TOOLTIP_TEXT` — the PURE decision functions + the
 *    PRD-frozen tooltip constant. Truth tables pinned in the next-door
 *    vitest. Same split convention as `decideClosureControl` (#407),
 *    `decidePauseControl` (#406), `decideTenantSwitcher` (#399).
 *
 * Backend SoT — REUSE :
 *
 *  - `api.lib.menu.availability.setItemAvailability` (chantier 2.2-D /
 *    #105) — `tenantMutation({ allow: ["kb_manager", "staff"] })`. Stamps
 *    `unavailableSince` on toggle-off, clears it on toggle-on. Cross-tenant
 *    fuzz already pinned. The auto-réactivation at next service opening
 *    (Convex cron `crons.reactivateUnavailableItems` + pure
 *    `itemsToReactivate`) is independent of this story.
 *  - `api.lib.menu.categories.list` + `api.lib.menu.items.list`
 *    (chantier 2.2-B) — tenant-scoped reads, sorted by `order`.
 *  - `api.lib.cart.cart.createOrderFromCart` (chantier 2.3-B) — already
 *    rejects an unavailable item with `INVALID_CART`
 *    « Item "<name>" is out of stock. » (cart.ts ligne 145-147), so the
 *    PWA client backend gate is satisfied by the EXISTING contract.
 *    This story doesn't need to touch `apps/web` because the customer
 *    surface is still a starter (no checkout wired yet) — the contract
 *    pin lives in `cart.test.ts` (#43 / 2.3-B test suite).
 *  - `api.lib.devices.devices.markItemToggleTooltipSeen` (#408 new) —
 *    self-scoped per-(user, device) flag (PRD 20 §7c). Upserts a fresh
 *    row when none exists; idempotent. Tested next door.
 *
 * ADR 0018 — frontière édition catalogue / disponibilité commerciale :
 * édition catalogue (création, prix, photos, modifiers, toggle catégorie
 * entière) reste KB Admin seul V1 + V2. KB Orders n'a JAMAIS de
 * formulaire d'édition de menu — uniquement lecture + toggle dispo.
 */
export {
  ITEM_TOGGLE_TOOLTIP_TEXT,
  decideItemListEntryPoint,
  decideTooltipGate,
  type ItemListEntryPointDecision,
  type ItemListEntryPointInputs,
  type TooltipGateDecision,
  type TooltipGateInputs,
} from "./decide-item-availability";
export { ItemAvailabilityEntry } from "./item-availability-entry";
export { ItemAvailabilityList } from "./item-availability-list";
