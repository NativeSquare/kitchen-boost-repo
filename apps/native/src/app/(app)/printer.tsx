import { PrinterSettingsScreen } from "@/lib/printing";

/**
 * #412 — KB Orders « Imprimante cuisine » route (PRD 20 §14 + §10).
 *
 * Atteint depuis la home strip via `<PrinterEntry />` (sibling of
 * `<PauseControl />`, `<ClosureControl />`, `<ItemAvailabilityEntry />`,
 * `<ServiceHoursEntry />`). Champ « Adresse imprimante » + boutons
 * « Enregistrer » / « Tester l'impression » / « Retirer l'imprimante ».
 *
 * Aucune logique ici — le screen route ne fait que monter le composant.
 * Même convention que `disponibilite-items.tsx` (#408) et
 * `service-hours.tsx` (#409).
 */
export default function PrinterRoute() {
  return <PrinterSettingsScreen />;
}
