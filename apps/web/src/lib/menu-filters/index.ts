/**
 * PWA-S4 (#452) — `menu-filters` module API.
 *
 * Two pure decisions consumed by `<MenuView>` and `<ItemModal>`:
 *  - `decideVisibleItems(items, activeFilters)` — V1 front-side
 *    sans-gluten/végétarien/vegan filter over `getPublicMenu` results.
 *  - `decideModifierValidation(groups, selections)` — gate state for the
 *    item modal's « Ajouter au panier » button + « À choisir » badge.
 */
export {
  decideVisibleItems,
  type Allergen,
  type DietaryFilter,
  type FilterableMenuItem,
} from "./decide-visible-items";
export {
  decideModifierValidation,
  type ModifierGroupView,
  type ModifierSelectionMap,
  type ModifierValidation,
} from "./decide-modifier-validation";
