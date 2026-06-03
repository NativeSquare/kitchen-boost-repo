import { ServiceHoursScreen } from "@/lib/service-hours";

/**
 * #409 — KB Orders « Horaires d'ouverture » route (PRD 20 §7d + ADR 0018).
 *
 * Atteint depuis la home strip via `<ServiceHoursEntry />` (sibling de
 * `<PauseControl />`, `<ClosureControl />` et `<ItemAvailabilityEntry />`).
 * Toggle « Aujourd'hui » / « Cette semaine » + éditeur de créneaux.
 * Édition complète des horaires permanents (jours fériés annuels) reste
 * KB Admin seul (ADR 0018).
 *
 * Aucune logique ici — le screen route ne fait que monter le composant.
 * Même convention que `disponibilite-items.tsx` (#408).
 */
export default function ServiceHoursRoute() {
  return <ServiceHoursScreen />;
}
