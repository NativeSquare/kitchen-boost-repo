/**
 * PWA-S4 (#452) — `decideVisibleItems` — front-side dietary filter over the
 * 14 UE 1169/2011 allergens carried by every `PublicMenuItem` (CONTEXT
 * client-ordering "Allergènes", decisions-log Q2).
 *
 * V1 design: the eater PWA toggles 3 client-side filters (`sans-gluten`,
 * `vegetarien`, `vegan`); `getPublicMenu` returns the full allergen set per
 * item with NO server-side filtering (no filter query, no filter arg). This
 * decision applies the active filter set client-side, composing AND across
 * filters.
 *
 * The « 5 animal allergens » set used for végétarien / vegan is the UE 1169
 * subset that ACTUALLY marks an animal-derived ingredient: `crustacés`,
 * `œufs`, `poissons`, `lait`, `mollusques`. UE 1169 doesn't carry a generic
 * « animal » or « miel » marker; this 5-tuple is the regulatory proxy V1.
 */
import type { ALLERGENS_UE_1169 } from "@packages/backend/convex/table/menuItems";

/** The 14 UE 1169/2011 allergens — frozen literal union (imported for typing). */
export type Allergen = (typeof ALLERGENS_UE_1169)[number];

/** Subset of `PublicMenuItem` this decision needs — keeps it framework-agnostic. */
export type FilterableMenuItem = {
  _id: string;
  name: string;
  allergens: ReadonlyArray<Allergen>;
};

/** The 3 V1 dietary filters surfaced as checkboxes on `/menu` home. */
export type DietaryFilter = "sans-gluten" | "vegetarien" | "vegan";

/**
 * The UE 1169 allergens whose presence proves an animal-derived ingredient.
 * Used as the regulatory proxy for végétarien / vegan exclusion V1.
 */
const ANIMAL_ALLERGENS: ReadonlySet<Allergen> = new Set<Allergen>([
  "crustacés",
  "œufs",
  "poissons",
  "lait",
  "mollusques",
]);

/** True iff the item carries `gluten` in its allergen declaration. */
function hasGluten(item: FilterableMenuItem): boolean {
  return item.allergens.includes("gluten");
}

/** True iff the item carries ANY of the 5 animal allergens. */
function hasAnyAnimalAllergen(item: FilterableMenuItem): boolean {
  for (const a of item.allergens) {
    if (ANIMAL_ALLERGENS.has(a)) return true;
  }
  return false;
}

/**
 * Apply the active dietary filter set to a list of items. Empty set ⇒ every
 * item is visible. Multiple active filters compose AND. The output is a new
 * array (the input is never mutated).
 */
export function decideVisibleItems<T extends FilterableMenuItem>(
  items: ReadonlyArray<T>,
  active: ReadonlySet<DietaryFilter>,
): T[] {
  if (active.size === 0) return [...items];
  return items.filter((item) => {
    if (active.has("sans-gluten") && hasGluten(item)) return false;
    // végétarien + vegan share the same exclusion set V1 (see file header).
    const requiresNoAnimal = active.has("vegetarien") || active.has("vegan");
    if (requiresNoAnimal && hasAnyAnimalAllergen(item)) return false;
    return true;
  });
}
