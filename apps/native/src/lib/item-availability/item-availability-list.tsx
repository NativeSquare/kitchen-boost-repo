import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useDeviceId } from "@/hooks/use-device-id";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal as GorhomBottomSheetModal } from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import {
  ITEM_TOGGLE_TOOLTIP_TEXT,
  decideTooltipGate,
} from "./decide-item-availability";

/**
 * #408 — « Toggle dispo item » list screen (PRD 20 §7c + ADR 0018).
 *
 * Lecture-seule du menu publié + toggle dispo par item. ADR 0018 trace la
 * frontière : édition catalogue (prix, photo, modifiers, création) reste
 * KB Admin seul. Ici on n'a QUE le switch.
 *
 * State Convex partagé (#397 / ADR 0018) — le toggle déclenche la mutation
 * `setItemAvailability` (chantier 2.2-D, déjà câblée + tests cross-tenant).
 * Le composant ne touche jamais raw `ctx.db`, et le backend gate
 * `placeOrder` / `createOrderFromCart` rejette déjà les items
 * `available=false` au moment du checkout (cf. cart.ts ligne 145-147).
 *
 * Granularité item uniquement V1 (acté Q3.7a, PRD 20 §7c). Pas de toggle
 * catégorie entière.
 *
 * Tooltip premier usage (PRD 20 §7c, OBLIGATOIRE) — la première fois que
 * le gérant tape un toggle sur ce device, on intercepte le tap et on
 * affiche le bottom-sheet pédagogique avec le texte EXACT spec'd. Une
 * fois le gérant « OK compris », on stamp `device.itemToggleTooltipSeen`
 * via `markItemToggleTooltipSeen` + on enchaîne la mutation initiale qu'il
 * avait demandée. Les toggles suivants sont silencieux (decision pure
 * `decideTooltipGate`).
 *
 * Trois branches d'état :
 *
 *  - aucun tenant résolu / Convex sub encore en cours → spinner + label
 *    « Chargement du menu… » (mirror du home #401).
 *  - tenant résolu mais aucune catégorie / aucun item → empty state qui
 *    pointe vers KB Admin (édition catalogue, ADR 0018).
 *  - tenant résolu + items chargés → liste de cards groupées par catégorie,
 *    chaque card carry le switch + l'état dispo/indispo.
 */
export function ItemAvailabilityList(): React.ReactElement {
  const tenantId = useActiveTenantId();
  const deviceId = useDeviceId();

  const categories = useQuery(
    api.lib.menu.categories.list,
    tenantId !== null ? { tenantId } : "skip",
  );
  const items = useQuery(
    api.lib.menu.items.list,
    tenantId !== null ? { tenantId } : "skip",
  );
  const device = useQuery(
    api.lib.devices.devices.getMyDevice,
    deviceId !== null ? { deviceId } : "skip",
  );

  const setItemAvailability = useMutation(
    api.lib.menu.availability.setItemAvailability,
  );
  const markTooltipSeen = useMutation(
    api.lib.devices.devices.markItemToggleTooltipSeen,
  );

  // The toggle the gérant is mid-firing (item id + intent). Held so we can:
  //   1) suspend the actual mutation while the tooltip is shown,
  //   2) replay it when the gérant taps « OK, j'ai compris » in the sheet.
  const [pendingToggle, setPendingToggle] = useState<{
    itemId: Id<"menuItems">;
    nextAvailable: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState<
    Id<"menuItems"> | "tooltip" | null
  >(null);

  const tooltipSheetRef = useRef<GorhomBottomSheetModal | null>(null);

  // Project the loaded `devices` row to the shape `decideTooltipGate` consumes.
  // `device === undefined` (Convex loading) → forward as loading sentinel;
  // `null` (no row yet) → forward as null; otherwise project the bool flag.
  const tooltipInputDevice =
    device === undefined
      ? undefined
      : device === null
        ? null
        : { itemToggleTooltipSeen: device.itemToggleTooltipSeen };

  async function fireToggle(itemId: Id<"menuItems">, nextAvailable: boolean) {
    if (tenantId === null) return;
    setSubmitting(itemId);
    try {
      await setItemAvailability({ tenantId, itemId, available: nextAvailable });
    } catch (error) {
      Alert.alert(
        "Impossible de mettre à jour l'item",
        getConvexErrorMessage(error),
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function handleTogglePress(
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) {
    const gate = decideTooltipGate({ device: tooltipInputDevice });
    if (gate.kind === "loading") {
      // Race-defensive: do nothing while we cannot tell whether to show the
      // tooltip. The switch's `disabled` prop also blocks the tap, this is
      // just defense in depth.
      return;
    }
    if (gate.kind === "show-tooltip") {
      setPendingToggle({ itemId, nextAvailable });
      tooltipSheetRef.current?.present();
      return;
    }
    // gate.kind === "proceed" — subsequent usage, no tooltip.
    await fireToggle(itemId, nextAvailable);
  }

  async function handleTooltipAcknowledge() {
    if (deviceId === null || pendingToggle === null) {
      tooltipSheetRef.current?.dismiss();
      setPendingToggle(null);
      return;
    }
    setSubmitting("tooltip");
    try {
      // Stamp the per-device flag FIRST so a crash mid-stream still skips the
      // tooltip on the next launch — re-prompting would be more annoying than
      // missing one toggle.
      await markTooltipSeen({ deviceId });
      // Then replay the toggle the gérant initiated.
      await setItemAvailability({
        tenantId: tenantId as Id<"tenants">,
        itemId: pendingToggle.itemId,
        available: pendingToggle.nextAvailable,
      });
      tooltipSheetRef.current?.dismiss();
      setPendingToggle(null);
    } catch (error) {
      Alert.alert(
        "Impossible de mettre à jour l'item",
        getConvexErrorMessage(error),
      );
    } finally {
      setSubmitting(null);
    }
  }

  function handleTooltipCancel() {
    tooltipSheetRef.current?.dismiss();
    setPendingToggle(null);
  }

  // --- Render branches ------------------------------------------------------

  if (tenantId === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Chargement du restaurant…
        </Text>
      </View>
    );
  }

  if (categories === undefined || items === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Chargement du menu…
        </Text>
      </View>
    );
  }

  if (categories.length === 0 || items.length === 0) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="p-4 sm:p-6"
      >
        <Header />
        <View className="items-center gap-2 py-12">
          <View className="bg-muted h-16 w-16 items-center justify-center rounded-2xl">
            <Text className="text-3xl">📋</Text>
          </View>
          <Text className="text-foreground text-base font-semibold">
            Aucun item au catalogue
          </Text>
          <Text className="text-muted-foreground max-w-sm text-center text-sm">
            Le catalogue se gère depuis KB Admin (prix, photos, modifiers).
          </Text>
        </View>
      </ScrollView>
    );
  }

  // Group items by category for display. Order matches the categories order
  // (already sorted server-side via `listTenantCategories`).
  const itemsByCategory = new Map<Id<"menuCategories">, Doc<"menuItems">[]>();
  for (const item of items) {
    const bucket = itemsByCategory.get(item.categoryId) ?? [];
    bucket.push(item);
    itemsByCategory.set(item.categoryId, bucket);
  }

  return (
    <>
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="p-4 sm:p-6"
      >
        <Header />
        {categories.map((category) => {
          const categoryItems = itemsByCategory.get(category._id) ?? [];
          if (categoryItems.length === 0) return null;
          return (
            <View key={category._id} className="mb-6">
              <Text className="text-foreground mb-2 text-base font-semibold">
                {category.name}
              </Text>
              <View className="border-border bg-card overflow-hidden rounded-2xl border">
                {categoryItems.map((item, index) => (
                  <View
                    key={item._id}
                    className={
                      index === 0
                        ? "flex-row items-center justify-between gap-3 p-4"
                        : "border-border flex-row items-center justify-between gap-3 border-t p-4"
                    }
                  >
                    <View className="flex-1 gap-0.5">
                      <Text
                        className={
                          item.available
                            ? "text-foreground text-base font-medium"
                            : "text-muted-foreground text-base font-medium line-through"
                        }
                      >
                        {item.name}
                      </Text>
                      <Text className="text-muted-foreground text-xs">
                        {item.available
                          ? "Disponible côté client"
                          : "Indisponible côté client"}
                      </Text>
                    </View>
                    {submitting === item._id ? (
                      <ActivityIndicator />
                    ) : (
                      <Switch
                        checked={item.available}
                        onCheckedChange={(next) => {
                          void handleTogglePress(item._id, next);
                        }}
                        disabled={
                          submitting !== null ||
                          tooltipInputDevice === undefined
                        }
                        accessibilityLabel={
                          item.available
                            ? `Rendre ${item.name} indisponible`
                            : `Rendre ${item.name} disponible`
                        }
                      />
                    )}
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <BottomSheetModal ref={tooltipSheetRef}>
        <View className="gap-4 px-6 pb-4 pt-2">
          <View className="items-center gap-2">
            <View className="bg-muted h-12 w-12 items-center justify-center rounded-full">
              <Ionicons name="information-circle" size={28} color="#1B7A3D" />
            </View>
            <Text className="text-center text-xl font-semibold">
              Disponibilité « ici et maintenant »
            </Text>
          </View>
          <Text
            className="text-foreground text-center text-base leading-6"
            accessibilityLabel="Tooltip disponibilité item"
          >
            {ITEM_TOGGLE_TOOLTIP_TEXT}
          </Text>
          <View className="gap-2 pt-2">
            <Button
              onPress={() => {
                void handleTooltipAcknowledge();
              }}
              disabled={submitting !== null}
              accessibilityLabel="OK, j'ai compris — appliquer le toggle"
              className="h-12"
            >
              {submitting === "tooltip" ? (
                <ActivityIndicator />
              ) : (
                <Text>OK, j&apos;ai compris</Text>
              )}
            </Button>
            <Button
              variant="outline"
              onPress={handleTooltipCancel}
              disabled={submitting !== null}
              accessibilityLabel="Annuler"
              className="h-12"
            >
              <Text>Annuler</Text>
            </Button>
          </View>
        </View>
      </BottomSheetModal>
    </>
  );
}

function Header(): React.ReactElement {
  return (
    <View className="mb-4 gap-1">
      <Text className="text-foreground text-xl font-semibold">
        Disponibilité des items
      </Text>
      <Text className="text-muted-foreground text-sm">
        Masque temporairement un item du menu côté client. L&apos;édition (prix,
        photo) reste dans KB Admin.
      </Text>
    </View>
  );
}
