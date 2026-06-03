import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

/**
 * #409 — Home « Modif horaires d'ouverture » entry pill (PRD 20 §7d +
 * ADR 0018).
 *
 * Sibling of `<PauseControl />` (#406), `<ClosureControl />` (#407) and
 * `<ItemAvailabilityEntry />` (#408) sur la home strip. Pareil que
 * `<ItemAvailabilityEntry />` : la surface est riche (grille 7 jours ×
 * N créneaux), donc plutôt qu'un bottom sheet on route vers un écran
 * dédié `/service-hours`. Le tap est one-shot, pas de live badge ici (les
 * horaires sont par essence le « état normal » du resto, pas un signal
 * éphémère à surfacer en permanence sur la home).
 *
 * Loading branch returns null (la home strip reste propre pendant que le
 * tenant résout, même convention que les siblings).
 */
export function ServiceHoursEntry(): React.ReactElement | null {
  const router = useRouter();
  const tenantId = useActiveTenantId();

  // Pas de tenant résolu encore — render null, comme les siblings.
  if (tenantId === null) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Modifier les horaires d'ouverture"
      onPress={() => router.push("/service-hours")}
      className="border-border bg-card mb-4 flex-row items-center justify-between gap-3 rounded-2xl border p-4 active:opacity-70"
    >
      <View className="flex-row items-center gap-3">
        <View className="bg-muted h-10 w-10 items-center justify-center rounded-full">
          <Ionicons name="time-outline" size={20} color="#444" />
        </View>
        <View>
          <Text className="text-foreground text-base font-semibold">
            Horaires d&apos;ouverture
          </Text>
          <Text className="text-muted-foreground text-xs">
            Ajuste les créneaux d&apos;aujourd&apos;hui ou de la semaine.
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#666" />
    </Pressable>
  );
}
