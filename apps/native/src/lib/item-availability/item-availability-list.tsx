import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useDeviceId } from "@/hooks/use-device-id";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { cn } from "@/lib/utils";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal as GorhomBottomSheetModal } from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Toast from "react-native-toast-message";
import {
  ITEM_TOGGLE_TOOLTIP_BODY,
  ITEM_TOGGLE_TOOLTIP_TITLE,
  decideTooltipGate,
} from "./decide-item-availability";

/**
 * #408 — « Toggle dispo item » list screen (PRD 20 §7c + ADR 0018).
 *
 * Lecture-seule du menu publié + toggle dispo par item. ADR 0018 trace la
 * frontière : édition catalogue (prix, photo, modifiers, création) reste
 * KB Admin seul. Ici on n'a QUE le switch + le badge état.
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
 * Trois invariants UX (PRD 20 §7c, reworded 2026-06-07 post-test E2E
 * KBO-DIS3) :
 *
 *  1. **Badge état visuel par item** — à côté de chaque toggle, un badge
 *     icône + label colorisé lève l'ambiguïté « ON = dispo ou indispo ? » :
 *     `checkmark-circle` vert KB (`text-primary`) + « Disponible » OU
 *     `close-circle` rouge destructive (`text-destructive`) + « Indisponible ».
 *     Aligné sur le pattern badges historique (commit `d06cdd3` — couleur
 *     texte + icône Ionicon, sans background coloré, pour rester discret
 *     dans la liste scrollable).
 *
 *  2. **Tooltip first-usage asymétrique (sens OFF uniquement)** — la
 *     première fois que le gérant tape un toggle dans le sens DISPONIBLE
 *     → INDISPONIBLE sur ce device, on intercepte le tap et on affiche
 *     le bottom-sheet pédagogique avec le title + body EXACT spec'd
 *     (`ITEM_TOGGLE_TOOLTIP_TITLE` + `ITEM_TOGGLE_TOOLTIP_BODY`). Une
 *     fois le gérant « OK compris », on stamp
 *     `device.itemToggleTooltipSeen` via `markItemToggleTooltipSeen` + on
 *     enchaîne la mutation initiale qu'il avait demandée. Le sens INVERSE
 *     (indisponible → disponible) n'a JAMAIS de tooltip — flip direct,
 *     pas de pédagogie nécessaire pour la réactivation. Les toggles
 *     suivants sont silencieux dans les deux sens (decision pure
 *     `decideTooltipGate`).
 *
 *  3. **Optimistic update + per-item disabled state** — le tap d'un toggle
 *     flip immédiatement la valeur affichée via le pattern Convex natif
 *     `useMutation(...).withOptimisticUpdate` sur `api.lib.menu.items.list`,
 *     et SEUL ce toggle passe en `disabled` pendant le round-trip (Set
 *     `submittingItemIds` par-item, pas un boolean global). Les autres
 *     items restent interactifs. Rollback automatique sur erreur (Convex
 *     replay la query serveur) + toast d'erreur « Mise à jour échouée ».
 *
 *     **Pas de spinner pendant la mutation** (reword 2026-06-07 post-test
 *     KBO-DIS3-bis) : le Switch reste toujours rendu, jamais remplacé par
 *     un `<ActivityIndicator />`. C'est ce qui donne l'illusion d'instantanéité
 *     — le Switch affiche la valeur optimistic IMMÉDIATEMENT au tap (cache
 *     local Convex patché synchronement). Un spinner ferait perdre cette
 *     illusion en signalant un état « en cours » alors que l'UX vise « déjà
 *     fait ». Le `disabled={isSubmittingThisItem}` reste, anti-fat-finger
 *     pour bloquer un re-tap pendant le round-trip, mais sans feedback visuel.
 *
 *  4. **Touch target = toute la card item** (post-test KBO-DIS3-bis) — la
 *     row item entière (nom + badge + Switch) est wrappée dans un `<Pressable>`
 *     qui flip l'item. Le Switch reste visible comme indicateur d'état mais
 *     n'a plus de handler propre (toute interaction passe par le Pressable
 *     parent). Pattern courant cuisine : grand hit-target pour gants / doigts
 *     gras. A11y : `accessibilityRole="switch"` + `accessibilityState` portés
 *     par le Pressable lui-même.
 *
 * Trois branches d'état :
 *
 *  - aucun tenant résolu / Convex sub encore en cours → spinner + label
 *    « Chargement du menu… » (mirror du home #401).
 *  - tenant résolu mais aucune catégorie / aucun item → empty state qui
 *    pointe vers KB Admin (édition catalogue, ADR 0018).
 *  - tenant résolu + items chargés → liste de cards groupées par catégorie,
 *    chaque card carry le badge état + le switch.
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

  // `withOptimisticUpdate` Convex natif (cf. docs.convex.dev/client/react/
  // optimistic-updates). Patch la query `api.lib.menu.items.list` localement
  // dès le tap → le badge + le switch flip avant le round-trip. Le store
  // revertit automatiquement si la mutation throw. Synchronous handler
  // obligatoire (cf. type contraint dans `convex/react/client.d.ts`).
  const setItemAvailability = useMutation(
    api.lib.menu.availability.setItemAvailability,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.lib.menu.items.list, {
      tenantId: args.tenantId,
    });
    if (current === undefined) {
      // La query n'a pas encore été chargée localement — rien à patcher.
      // Le tap n'a pas pu partir de toute façon (les guards UI empêchent
      // un tap pendant loading), mais on défense en profondeur.
      return;
    }
    localStore.setQuery(
      api.lib.menu.items.list,
      { tenantId: args.tenantId },
      current.map((item) =>
        item._id === args.itemId
          ? {
              ...item,
              available: args.available,
              // Stamp local approx de `unavailableSince` pour cohérence visuelle
              // immédiate (le backend stampe la valeur faisante autorité,
              // qui écrasera celle-ci au prochain push serveur).
              unavailableSince:
                args.available === false ? Date.now() : undefined,
            }
          : item,
      ),
    );
  });
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
  // Per-item disabled state. Replaces the previous global `submitting:
  // boolean` (qui freezait TOUS les toggles pendant le round-trip d'UN
  // toggle — UX bug rapporté lors du test E2E 2026-06-07). Chaque item
  // s'affiche disabled UNIQUEMENT pendant son propre round-trip.
  const [submittingItemIds, setSubmittingItemIds] = useState<
    Set<Id<"menuItems">>
  >(() => new Set());
  // Tooltip acknowledgement is its own slot (the replay touches device + item
  // mutations sequentially, the bottom-sheet button needs its own busy flag).
  const [tooltipAcknowledging, setTooltipAcknowledging] = useState(false);

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

  function addSubmitting(itemId: Id<"menuItems">): void {
    setSubmittingItemIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  }

  function removeSubmitting(itemId: Id<"menuItems">): void {
    setSubmittingItemIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }

  async function fireToggle(itemId: Id<"menuItems">, nextAvailable: boolean) {
    if (tenantId === null) return;
    addSubmitting(itemId);
    try {
      await setItemAvailability({ tenantId, itemId, available: nextAvailable });
    } catch (error) {
      // L'optimistic update Convex rollback automatiquement la query locale
      // dès que la mutation throw (le store revertit au snapshot serveur le
      // plus récent). Ici on ne fait que surface le toast d'erreur — pas de
      // rollback manuel à orchestrer (sinon on dérive de la valeur serveur).
      Toast.show({
        type: "error",
        position: "top",
        topOffset: 32,
        text1: "Mise à jour échouée",
        text2: getConvexErrorMessage(error),
      });
    } finally {
      removeSubmitting(itemId);
    }
  }

  async function handleTogglePress(
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) {
    const gate = decideTooltipGate({
      device: tooltipInputDevice,
      targetAvailable: nextAvailable,
    });
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
    // gate.kind === "proceed" — soit subsequent usage, soit sens ON (asymétrie
    // OFF/ON, PRD 20 §7c reword 2026-06-07) : flip direct sans tooltip.
    await fireToggle(itemId, nextAvailable);
  }

  async function handleTooltipAcknowledge() {
    // Three preconditions must hold — narrowing all three FIRST so the
    // toggle call below stays type-clean (no `as Id<"tenants">` shortcut).
    if (deviceId === null || pendingToggle === null || tenantId === null) {
      tooltipSheetRef.current?.dismiss();
      setPendingToggle(null);
      return;
    }
    const { itemId, nextAvailable } = pendingToggle;
    setTooltipAcknowledging(true);
    addSubmitting(itemId);
    try {
      // Stamp the per-device flag FIRST so a crash mid-stream still skips the
      // tooltip on the next launch — re-prompting would be more annoying than
      // missing one toggle.
      await markTooltipSeen({ deviceId });
      // Then replay the toggle the gérant initiated (avec optimistic update).
      await setItemAvailability({
        tenantId,
        itemId,
        available: nextAvailable,
      });
      tooltipSheetRef.current?.dismiss();
      setPendingToggle(null);
    } catch (error) {
      Toast.show({
        type: "error",
        position: "top",
        topOffset: 32,
        text1: "Mise à jour échouée",
        text2: getConvexErrorMessage(error),
      });
    } finally {
      setTooltipAcknowledging(false);
      removeSubmitting(itemId);
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
                {categoryItems.map((item, index) => {
                  const isSubmittingThisItem = submittingItemIds.has(item._id);
                  // Loading device → on bloque tous les toggles defensively
                  // (on ne sait pas encore si on doit afficher le tooltip).
                  // Per-item submitting → anti-fat-finger sur ce toggle
                  // précis pendant son round-trip (les autres restent
                  // interactifs).
                  const isToggleDisabled =
                    tooltipInputDevice === undefined || isSubmittingThisItem;
                  return (
                    <Pressable
                      key={item._id}
                      onPress={() => {
                        if (isToggleDisabled) return;
                        // Toggle target = NOT current value (le Pressable
                        // déclenche un flip simple).
                        void handleTogglePress(item._id, !item.available);
                      }}
                      disabled={isToggleDisabled}
                      // A11y : le Pressable EST le toggle (le Switch interne
                      // n'a plus de handler propre — c'est un indicateur
                      // visuel). Screen readers le voient comme un switch.
                      accessibilityRole="switch"
                      accessibilityState={{
                        checked: item.available,
                        disabled: isToggleDisabled,
                      }}
                      accessibilityLabel={
                        item.available
                          ? `Rendre ${item.name} indisponible`
                          : `Rendre ${item.name} disponible`
                      }
                      className={cn(
                        "flex-row items-center justify-between gap-3 p-4 active:opacity-70",
                        index !== 0 && "border-border border-t",
                      )}
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
                        <AvailabilityBadge available={item.available} />
                      </View>
                      {/*
                       * Switch = indicateur visuel d'état UNIQUEMENT (post-
                       * KBO-DIS3-bis). Pas de `onCheckedChange` : tout le tap
                       * passe par le `<Pressable>` parent (touch target = card
                       * entière). `value={item.available}` lit la valeur
                       * optimistic du cache local Convex → flip instantané au
                       * tap, sans spinner intermédiaire.
                       *
                       * `disabled` propage le visuel grisé (opacity 50) mais
                       * c'est le Pressable qui bloque réellement le tap.
                       */}
                      <Switch
                        checked={item.available}
                        disabled={isToggleDisabled}
                        // Pas de handler — le Pressable parent gère le tap.
                        // RN-primitives Switch accepte un onCheckedChange no-op
                        // (le tap natif sur le thumb propage au Pressable parent).
                        onCheckedChange={() => {
                          /* noop — handled by Pressable parent */
                        }}
                      />
                    </Pressable>
                  );
                })}
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
            <Text
              className="text-foreground text-center text-xl font-semibold"
              accessibilityLabel="Tooltip disponibilité item — titre"
            >
              {ITEM_TOGGLE_TOOLTIP_TITLE}
            </Text>
          </View>
          <Text
            className="text-muted-foreground text-center text-base leading-6"
            accessibilityLabel="Tooltip disponibilité item — sous-titre"
          >
            {ITEM_TOGGLE_TOOLTIP_BODY}
          </Text>
          <View className="gap-2 pt-2">
            <Button
              onPress={() => {
                void handleTooltipAcknowledge();
              }}
              disabled={tooltipAcknowledging}
              accessibilityLabel="OK, j'ai compris — appliquer le toggle"
              className="h-12"
            >
              {tooltipAcknowledging ? (
                <ActivityIndicator />
              ) : (
                <Text>OK, j&apos;ai compris</Text>
              )}
            </Button>
            <Button
              variant="outline"
              onPress={handleTooltipCancel}
              disabled={tooltipAcknowledging}
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

/**
 * Badge état dispo / indispo (post-test E2E 2026-06-07 KBO-DIS3). Pattern
 * aligné sur les badges historique (commit `d06cdd3`) : icône Ionicon +
 * label colorisé via `text-primary` (vert KB #1B7A3D) ou `text-destructive`
 * (rouge), SANS background coloré pour rester discret dans la liste.
 *
 * Pourquoi ici (pas dans `decide-item-availability.ts`) : le mapping est
 * trivial sur un boolean (closed-set de 2 valeurs) et le helper ne porte
 * aucune décision branchante. Le badge historique a sa propre fonction
 * pure (`decideHistoryStatusBadgeStyle`) parce qu'il branchait sur 4
 * statuts + un fallback null — ici un ternaire suffit.
 */
function AvailabilityBadge({
  available,
}: {
  available: boolean;
}): React.ReactElement {
  const toneClass = available ? "text-primary" : "text-destructive";
  const iconName = available ? "checkmark-circle" : "close-circle";
  const label = available ? "Disponible" : "Indisponible";
  return (
    <View
      className="flex-row items-center gap-1"
      accessibilityLabel={`État : ${label}`}
    >
      <Ionicons name={iconName} size={14} className={toneClass} />
      <Text className={cn("text-xs font-medium", toneClass)}>{label}</Text>
    </View>
  );
}

function Header(): React.ReactElement {
  return (
    <View className="mb-4 gap-1">
      <Text className="text-foreground text-xl font-semibold">
        Disponibilité des items
      </Text>
      <Text className="text-muted-foreground text-sm">
        Masque temporairement un item du menu côté client.
      </Text>
    </View>
  );
}
