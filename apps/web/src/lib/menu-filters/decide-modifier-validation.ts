/**
 * PWA-S4 (#452) — `decideModifierValidation` — UI gate state for the item
 * modal (US 19, CONTEXT client-ordering "Modifier", decisions-log Q2).
 *
 * For each required modifier group (`minSelect >= 1`), decide whether the
 * user has selected enough options. The output drives:
 *  - inline « À choisir » badge on each unsatisfied required group, and
 *  - the disabled state of « Ajouter au panier ».
 *
 * Optional groups (`minSelect = 0`) never block. The
 * `maxSelect >= max(1, minSelect)` invariant is enforced backend-side
 * (`packages/backend/convex/lib/menu/modifiers.ts`); this decision consumes
 * already-valid groups.
 */

/** Subset of `PublicModifierGroup` this decision needs — framework-agnostic. */
export type ModifierGroupView = {
  groupId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ReadonlyArray<{
    label: string;
    priceDeltaCentimes: number;
  }>;
};

/** Map keyed by `groupId` carrying the user's selected option labels. */
export type ModifierSelectionMap = Record<string, ReadonlyArray<string>>;

/** Verdict pinning the add-to-cart gate + the unsatisfied required groups. */
export type ModifierValidation = {
  /** True iff every required group has at least `minSelect` selections. */
  canAddToCart: boolean;
  /**
   * Ids of REQUIRED groups whose selection count is below their `minSelect`.
   * The form renders an « À choisir » badge on each entry; order is the
   * input order so the badge layout is stable.
   */
  unsatisfiedGroupIds: string[];
};

/**
 * Decide the gate state for the modal of one item, given its required +
 * optional groups and the user's current selections.
 */
export function decideModifierValidation(
  groups: ReadonlyArray<ModifierGroupView>,
  selections: ModifierSelectionMap,
): ModifierValidation {
  const unsatisfied: string[] = [];
  for (const group of groups) {
    if (group.minSelect <= 0) continue; // optional ⇒ never blocks
    const selectedCount = selections[group.groupId]?.length ?? 0;
    if (selectedCount < group.minSelect) {
      unsatisfied.push(group.groupId);
    }
  }
  return {
    canAddToCart: unsatisfied.length === 0,
    unsatisfiedGroupIds: unsatisfied,
  };
}
