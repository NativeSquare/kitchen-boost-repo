/**
 * PWA cart UX fix — `cartLineModifierLabels` — PURE helper turning a cart
 * line's selected modifiers into a list of concise chip labels.
 *
 * Each selected option renders as its own labelled chip under the item name
 * in `<CartView>`, so two same-item / different-modifier lines (e.g.
 * « Smash Burger · Fromage » vs « Smash Burger · Bacon ») are unmistakable
 * at a glance — the previous single grey ` · `-joined run was too discreet.
 *
 * We surface the OPTION label only (not the verbose group name) to keep the
 * chips short and mobile-friendly; the option label is what differs between
 * variants and is what the customer recognises. Selection order is preserved.
 * Blank / whitespace-only option labels are dropped so the row never renders
 * an empty chip.
 */
import type { CartModifierSelection } from "./cart-store";

export function cartLineModifierLabels(
  modifiers: ReadonlyArray<CartModifierSelection>,
): ReadonlyArray<string> {
  return modifiers
    .map((m) => m.optionLabel.trim())
    .filter((label) => label.length > 0);
}
