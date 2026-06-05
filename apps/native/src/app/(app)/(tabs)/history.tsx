import { OrderHistoryScreen } from "@/lib/orders";
import { View } from "react-native";

/**
 * KB Orders « Historique » section (PRD 20 §8 + §9).
 *
 * Section dédiée du shell (drawer tablette OU bottom tab téléphone) qui
 * monte **uniquement** `<OrderHistoryScreen />` (#417) — 4 onglets
 * (Toutes / Livrées-Collectées / Refusées / Manquées), filtre période et
 * recherche par ID. Le screen est auto-suffisant côté empty/loading state.
 *
 * Les Quick stats (`<QuickStats />`, #410) sont volontairement absents
 * ici : l'onglet « Stats » dédié les expose déjà, dupliquer le bloc en
 * tête d'« Historique » n'apportait pas de valeur supplémentaire et
 * ajoutait du bruit visuel avant la liste.
 *
 * Pas de logique métier ici — c'est un pur wrapper autour du screen
 * historique, qui gère lui-même sa subscription Convex et son tenant
 * scoping via `useActiveTenantId`.
 */
export default function HistoryScreen() {
  return (
    <View className="bg-background flex-1">
      <OrderHistoryScreen />
    </View>
  );
}
