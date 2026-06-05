import { OrderHistoryScreen } from "@/lib/orders";
import { QuickStats } from "@/lib/quick-stats";
import { View } from "react-native";

/**
 * KB Orders « Historique » section (PRD 20 §8 + §9).
 *
 * Section dédiée du shell (drawer tablette OU bottom tab téléphone) qui
 * combine deux surfaces déjà existantes :
 *
 *  1. **Quick stats EN HAUT** — les 4 KPIs (`<QuickStats />`, #410). Donne
 *     un recap chiffré de l'activité en un coup d'œil avant de drill-down
 *     dans une cmd précise. Duplication assumée avec l'onglet « Stats »
 *     dédié (cf. brief reorg) car le contexte ici est DIFFÉRENT — recap
 *     de l'activité passée plutôt qu'écran KPIs analytique pur.
 *
 *  2. **Écran historique 4 onglets EN DESSOUS** — `<OrderHistoryScreen />`
 *     (#417) avec ses 4 onglets (Toutes / Livrées-Collectées / Refusées /
 *     Manquées), filtre période et recherche par ID. Le screen est
 *     auto-suffisant côté empty/loading state ; on le mount tel quel.
 *
 * Pas de logique métier ici — c'est un pur agrégat de surfaces existantes.
 * Les deux composants gèrent leur propre subscription Convex et leur
 * propre tenant scoping via `useActiveTenantId`.
 */
export default function HistoryScreen() {
  return (
    <View className="bg-background flex-1">
      <View className="px-4 pt-4 sm:px-6 sm:pt-6">
        <QuickStats />
      </View>
      <View className="flex-1">
        <OrderHistoryScreen />
      </View>
    </View>
  );
}
