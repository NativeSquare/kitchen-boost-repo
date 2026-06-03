import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { decideItemListEntryPoint } from "./decide-item-availability";

/**
 * #408 — Home « Disponibilité des items » entry pill (PRD 20 §7c + ADR 0018).
 *
 * Sibling of `<PauseControl />` (#406) and `<ClosureControl />` (#407) on the
 * home strip. Differs from those two in that we don't surface the state
 * here (no live badge) — the toggle list is a dedicated route. The entry
 * pill is a one-tap navigator to `/disponibilite-items`.
 *
 * Why a route, not a bottom sheet :
 *
 *  - The list grows with the catalogue. A bottom sheet expanded to fit
 *    20+ items doesn't read well; a full route gives the gérant a proper
 *    screen + back nav.
 *  - The PRD 20 §7c demands an EXACT first-usage tooltip text — the
 *    tooltip itself lives in the list component as a modal, so the entry
 *    stays minimal.
 *  - Matches the parallel design of the KB Admin web side : the
 *    `DisponibiliteView` 7c section is a card with a link out to
 *    `/menu`, not an inline editor.
 *
 * Loading branch returns null (the home strip stays clean while the active
 * tenant is still resolving). Same convention as the loading branches of
 * `<PauseControl />` and `<ClosureControl />`.
 */
export function ItemAvailabilityEntry(): React.ReactElement | null {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const decision = decideItemListEntryPoint({ activeTenantId: tenantId });

  if (decision.kind === "loading") {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Gérer la disponibilité des items"
      onPress={() => router.push("/disponibilite-items")}
      className="border-border bg-card mb-4 flex-row items-center justify-between gap-3 rounded-2xl border p-4 active:opacity-70"
    >
      <View className="flex-row items-center gap-3">
        <View className="bg-muted h-10 w-10 items-center justify-center rounded-full">
          <Ionicons name="restaurant-outline" size={20} color="#444" />
        </View>
        <View>
          <Text className="text-foreground text-base font-semibold">
            Disponibilité des items
          </Text>
          <Text className="text-muted-foreground text-xs">
            Rupture éclair — masque temporairement un item du menu.
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#666" />
    </Pressable>
  );
}
