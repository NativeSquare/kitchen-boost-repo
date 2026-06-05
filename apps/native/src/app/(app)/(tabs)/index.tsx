import { Text } from "@/components/ui/text";
import { OrderCard } from "@/lib/orders";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";

/**
 * KB Orders « Accueil » (PRD 20 §2 « Écran d'accueil cmds en cours »).
 *
 * Focus opérationnel cuisine : la liste des commandes en cours DU TENANT
 * COURANT et RIEN d'autre. Les widgets de disponibilité commerciale
 * (pause / fermeture / dispo items / horaires), la config imprimante,
 * les quick stats et l'entry historique vivent maintenant dans les
 * autres sections du shell (drawer tablette OU bottom tabs téléphone) :
 *  - « Historique » (Quick stats + écran historique 4 onglets)
 *  - « Stats » (les 4 KPIs Quick stats)
 *  - « Paramètres » (Ouverture & horaires + Imprimante + le reste)
 *
 * Avant cette refonte, l'index empilait tout dans le même ScrollView et
 * la cmd qui arrivait se retrouvait cachée sous 8 widgets — insupportable
 * sur la tablette cuisine. L'Accueil est désormais le focus
 * opérationnel : la cmd qui arrive est la première chose visible.
 *
 * Transport (PRD 20 §13) — la subscription Convex EST la source de vérité.
 * Le push APNs/FCM wakeup (notifications chantier) ne sert qu'à réveiller
 * l'app ; la cmd elle-même arrive via ce `useQuery` sub en < 5s p95
 * (PRD 20 AC9 transverse).
 *
 * Pull-to-refresh (PRD 20 §2) — gardé comme « geste rassurant même si
 * Convex sub temps réel ». Le client Convex n'expose pas de `refetch`
 * manuel pour une query subscribed (il sert toujours le dernier état
 * serveur), donc le PTR est surtout une UX affordance ; on toggle un
 * spinner court pour acknowledger le geste.
 *
 * Tenant scoping (#399 + ADR 0010) — `useActiveTenantId` résout le tenant
 * actif depuis le device row + la session attachment list (kiosque pin
 * wins, else lastSelected, else first attached). `null` pendant le
 * loading ou si aucun tenant n'est résolvable ; dans ce cas un placeholder
 * discret remplace la liste plutôt que d'afficher un faux « 0 cmds ».
 */
export default function HomeScreen() {
  const activeTenantId = useActiveTenantId();
  const orders = useQuery(
    api.lib.orders.workflow.tenantOrders,
    activeTenantId !== null ? { tenantId: activeTenantId } : "skip",
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  };

  if (activeTenantId === null) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Chargement du restaurant…
        </Text>
      </View>
    );
  }

  if (orders === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Réception des commandes…
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-foreground text-xl font-semibold">
          Commandes en cours
        </Text>
        <Text className="text-muted-foreground text-sm">
          {orders.length} en cours
        </Text>
      </View>

      {orders.length === 0 ? (
        <View className="items-center gap-2 py-12">
          <View className="bg-muted h-16 w-16 items-center justify-center rounded-2xl">
            <Text className="text-3xl">🍳</Text>
          </View>
          <Text className="text-foreground text-base font-semibold">
            Aucune commande en cours
          </Text>
          <Text className="text-muted-foreground max-w-sm text-center text-sm">
            Les nouvelles commandes apparaissent ici dès qu&apos;elles sont
            payées.
          </Text>
        </View>
      ) : (
        orders.map((order) => <OrderCard key={order._id} order={order} />)
      )}
    </ScrollView>
  );
}
