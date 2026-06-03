import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

/**
 * #412 — Home « Imprimante cuisine » entry pill (PRD 20 §14).
 *
 * Sibling of `<PauseControl />`, `<ClosureControl />`,
 * `<ItemAvailabilityEntry />` and `<ServiceHoursEntry />` on the home strip.
 * One-tap navigator to `/printer` (the dedicated Settings screen for the
 * Star Micronics WebPRNT config). PRD 20 §10 « Settings #418 » will later
 * mount the same `PrinterSettingsScreen` from a full Settings index — for
 * the V1 KB Orders launch the strip surfaces the printer config alongside
 * the other « disponibilité commerciale » entry points so the gérant can
 * configure everything from the home in one sweep.
 *
 * Loading branch returns null (the home strip stays clean while the active
 * tenant is still resolving). Same convention as the other entry pills.
 */
export function PrinterEntry(): React.ReactElement | null {
  const router = useRouter();
  const tenantId = useActiveTenantId();

  if (tenantId === null) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Configurer l'imprimante cuisine"
      onPress={() => router.push("/printer")}
      className="border-border bg-card mb-4 flex-row items-center justify-between gap-3 rounded-2xl border p-4 active:opacity-70"
    >
      <View className="flex-row items-center gap-3">
        <View className="bg-muted h-10 w-10 items-center justify-center rounded-full">
          <Ionicons name="print-outline" size={20} color="#444" />
        </View>
        <View>
          <Text className="text-foreground text-base font-semibold">
            Imprimante cuisine
          </Text>
          <Text className="text-muted-foreground text-xs">
            Star WebPRNT — auto-impression à l&apos;ack + bouton Réimprimer.
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#666" />
    </Pressable>
  );
}
