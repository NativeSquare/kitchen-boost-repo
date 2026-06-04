import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

/**
 * #417 — Home « Historique des commandes » entry pill (PRD 20 §8).
 *
 * Sibling of `<PauseControl />` (#406), `<ClosureControl />` (#407),
 * `<ItemAvailabilityEntry />` (#408) and `<ServiceHoursEntry />` (#409) on
 * the home strip. One-tap navigator to the dedicated `/orders/history`
 * screen (Stack route declared in `(app)/_layout.tsx`).
 *
 * Why a route, not a bottom sheet :
 *  - The list is potentially long (50+ cmds over a month) and carries
 *    a search bar + 4 tabs + a period filter row — a bottom sheet would
 *    crowd the home and steal vertical space from the live queue.
 *  - The full route lets the cuisinier scroll comfortably with proper
 *    back navigation, mirroring the design of `/disponibilite-items` and
 *    `/printer`.
 *
 * Loading branch returns null (the home strip stays clean while the
 * active tenant is still resolving). Same convention as the other entry
 * components.
 */
export function OrderHistoryEntry(): React.ReactElement | null {
  const router = useRouter();
  const tenantId = useActiveTenantId();

  if (tenantId === null) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ouvrir l'historique des commandes"
      onPress={() => router.push("/orders/history")}
      className="border-border bg-card mb-4 flex-row items-center justify-between gap-3 rounded-2xl border p-4 active:opacity-70"
    >
      <View className="flex-row items-center gap-3">
        <View className="bg-muted h-10 w-10 items-center justify-center rounded-full">
          <Ionicons name="time-outline" size={20} color="#444" />
        </View>
        <View>
          <Text className="text-foreground text-base font-semibold">
            Historique des commandes
          </Text>
          <Text className="text-muted-foreground text-xs">
            Livrées, refusées, manquées — recherche par ID.
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#666" />
    </Pressable>
  );
}
