import { ItemAvailabilityList } from "@/lib/item-availability";

/**
 * #408 — KB Orders « Disponibilité des items » screen (PRD 20 §7c +
 * ADR 0018 frontière disponibilité commerciale / édition catalogue).
 *
 * Atteint depuis le home strip via `<ItemAvailabilityEntry />` (sibling de
 * `<PauseControl />` et `<ClosureControl />`). Lecture du menu + toggle
 * dispo/indispo par item, AVEC tooltip obligatoire au premier usage SUR
 * LE SENS OFF (PRD 20 §7c reword 2026-06-07, texte EXACT spec'd dans
 * `ITEM_TOGGLE_TOOLTIP_TITLE` + `ITEM_TOGGLE_TOOLTIP_BODY`). Le sens ON
 * (réactivation) est un flip direct sans modal. Édition catalogue (prix,
 * photo, modifiers) reste KB Admin seul (ADR 0018).
 *
 * Aucune logique ici — le screen route ne fait que monter le composant.
 * Même convention que les autres routes du shell `(app)/*`.
 */
export default function DisponibiliteItemsScreen() {
  return <ItemAvailabilityList />;
}
