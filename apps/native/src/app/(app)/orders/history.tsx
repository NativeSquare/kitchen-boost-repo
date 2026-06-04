import { OrderHistoryScreen } from "@/lib/orders";

/**
 * #417 — Route `/orders/history` (PRD 20 §8).
 *
 * Atteint depuis la home strip via `<OrderHistoryEntry />` (sibling de
 * `<PauseControl />`, `<ClosureControl />`, etc.). Affiche les cmds
 * terminales du tenant courant avec :
 *  - 4 onglets de statut (Toutes / Livrées-Collectées / Refusées / Manquées),
 *  - filtre période (Aujourd'hui / 7j / 30j / Tout),
 *  - recherche par ID cmd (MOAT, ADR 0010 — pas de recherche par nom client).
 *
 * Tap sur une ligne → `/orders/[orderId]` (le detail screen existant gère
 * lecture seule pour les états terminaux via `decideWorkflowButton`).
 *
 * Aucune logique ici — le screen ne fait que monter le composant. Même
 * convention que `disponibilite-items.tsx`, `service-hours.tsx`, etc.
 */
export default function OrderHistoryRoute() {
  return <OrderHistoryScreen />;
}
