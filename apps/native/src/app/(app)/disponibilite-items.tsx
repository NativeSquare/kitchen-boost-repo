import { ItemAvailabilityList } from "@/lib/item-availability";

/**
 * #408 — KB Orders « Disponibilité des items » screen (PRD 20 §7c +
 * ADR 0018 frontière disponibilité commerciale / édition catalogue).
 *
 * Atteint depuis le home strip via `<ItemAvailabilityEntry />` (sibling de
 * `<PauseControl />` et `<ClosureControl />`). Lecture du menu + toggle
 * dispo/indispo par item, AVEC tooltip obligatoire au premier usage sur
 * un device (PRD 20 §7c, texte EXACT spec'd dans
 * `ITEM_TOGGLE_TOOLTIP_TEXT`). Édition catalogue (prix, photo, modifiers)
 * reste KB Admin seul (ADR 0018).
 *
 * Aucune logique ici — le screen route ne fait que monter le composant.
 * Même convention que les autres routes du shell `(app)/*`.
 */
export default function DisponibiliteItemsScreen() {
  return <ItemAvailabilityList />;
}
