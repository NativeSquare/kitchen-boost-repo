import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { notifyAction } from "@/lib/toast";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal as GorhomBottomSheetModal } from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Toast from "react-native-toast-message";
import {
  DEFAULT_NEW_SLOT,
  WEEK_DAYS,
  decideServiceHoursScreen,
  minutesToTimeString,
  validateServiceWindows,
  type ServiceHoursValidationError,
  type ServiceWindow,
} from "./decide-service-hours";
import { TimeWheelPickerSheet } from "./time-wheel-picker-sheet";

/**
 * #409 — KB Orders « Modif horaires d'ouverture » screen (PRD 20 §7d +
 * ADR 0018 frontière disponibilité commerciale).
 *
 * Surface jumelle de la carte « Horaires d'ouverture » côté KB Admin
 * (#397 `DisponibiliteView` 7d → lien vers `service-hours-editor.tsx`).
 * Même mutation backend (`api.lib.menu.serviceHours.set`, posée par 2.2-E
 * et réutilisée par #236 sur l'admin), même validation, même format
 * windows[]. Le state Convex partagé fait le reste — un changement KB
 * Admin se reflète en temps réel ici, et inversement.
 *
 * Vue unique « Cette semaine »
 * ---------------------------
 * Grille hebdo Lun → Dim (FR order). Édition posée mais terrain : un
 * gérant peut ajuster ses créneaux depuis l'app sans ouvrir KB Admin sur
 * grand écran. Le toggle « Aujourd'hui / Cette semaine » a été retiré
 * comme redondant — la vue semaine expose déjà la ligne du jour en
 * première position via l'ordre FR, et un gérant qui veut faire un
 * ajustement « ce soir » trouve son jour en haut sans changer de mode.
 * Cleanup secondaire : le segment switcher portait `accessibilityRole="tab"`
 * / `"tablist"` non supporté par React Native sans NavigationContainer
 * parent, ce qui crashait au tap sur « Cette semaine ».
 *
 * Édition complète des horaires permanents (jours fériés annuels) reste
 * **KB Admin seul** (ADR 0018) — pas dans cette story.
 *
 * Persistance immédiate per-slot (refactor 2026-06-07)
 * ----------------------------------------------------
 * Avant : pattern « draft + Save global » — chaque édition (tap Valider
 * wheel / Ajouter / Supprimer) mutait un `draft` local, et un bouton
 * « Enregistrer » global tout en bas fire la mutation `set` une fois.
 * Modèle copié de KB Admin où l'éditeur a un Save global cohérent avec
 * d'autres écrans desktop.
 *
 * Après : chaque édition fire `setHours` IMMÉDIATEMENT avec le nouveau
 * `windows[]` complet — pas de draft global, pas de bouton Save. Même
 * pattern que `ItemAvailabilityList` (commit `f016467`) : `withOptimisticUpdate`
 * patche la query `serviceHours.get` locale dès le tap pour un flip
 * instantané du Pressable « Début / Fin », et le store revertit
 * automatiquement si la mutation throw (validation backend rejette
 * OVERLAP / START_AFTER_OR_EQUAL_END / OUT_OF_BOUNDS). Toast vert
 * « Horaires mis à jour » après chaque success, toast rouge erreur sur
 * throw.
 *
 * Pourquoi ce pivot
 * -----------------
 * Sur cuisine terrain, le gérant qui ajuste son horaire en plein service
 * ne doit JAMAIS oublier de taper Save. La phase « draft » ouvre un
 * gouffre cognitif (« j'ai modifié, mais c'est sauvé ? ») qu'un toggle
 * dispo item ne crée pas. La persistance unitaire aligne le mental model
 * service-hours sur le mental model toggle-dispo (#408) et toggle-pause /
 * fermeture exceptionnelle (#406 / #407) — chaque tap a un effet immédiat
 * + un toast de confirmation.
 *
 * Validation
 * ----------
 * `validateServiceWindows` (pur, mirror du backend `assertServiceWindows`)
 * tourne toujours pour deux usages :
 *
 *   1. **Gate du tap Valider wheel** — si la nouvelle valeur tapée fait
 *      que `start >= end` SUR LE SLOT COURANT, on bloque le tap Valider
 *      au niveau du sheet (affiche une erreur inline dans le sheet, NE
 *      ferme PAS, NE fire PAS la mutation). C'est le seul cas où une
 *      validation locale BLOQUE — parce qu'envoyer un slot dont on sait
 *      qu'il est invalide est une round-trip inutile + un toast d'erreur
 *      qu'on peut éviter.
 *
 *   2. **Affichage inline des erreurs cross-créneau (OVERLAP)** — la
 *      validation tourne aussi sur le full windows[] pour surfacer un
 *      message d'erreur sous chaque créneau fautif. Mais elle ne BLOQUE
 *      plus aucun save (pas de save global à bloquer). Si le gérant
 *      réussit à créer un OVERLAP via une édition, la mutation
 *      `set` tente, le backend rejette, le toast d'erreur prend le
 *      relais et le store Convex rollback la valeur optimistic.
 *
 * Backend reste la source de vérité (défense en profondeur) — même si
 * le front est contourné, la mutation `set` rejette tout windows[]
 * invalide via `assertServiceWindows`.
 *
 * Time picker (2026-06-07 — pivot vers wheel JS-only)
 * ----------------------------------------------------
 * Première itération : deux `<Input>` texte HH:MM + parser strict
 * `timeStringToMinutes`. Bug terrain KBO-DIS4 : le parser rejette TOUT
 * input partiel (regex `/^(\d{1,2}):(\d{2})$/` exige la shape complète) →
 * un keystroke isolé (« 1 » avant que « 12:30 » soit tapé) retournait NaN
 * → state non muté → le render suivant force l'Input à la canonical
 * `minutesToTimeString` de l'état inchangé → le caractère tapé disparaît.
 *
 * Pivot vers une wheel picker JS-only (`<TimeWheelPickerSheet />`,
 * `./time-wheel-picker-sheet.tsx`) — même discipline que le calendar
 * `react-native-calendars` (commit `70252ba`) : ZÉRO module natif, marche
 * immédiatement avec le dev client existant. Tap sur « Début » / « Fin » →
 * bottom sheet → deux colonnes scrollables (heures 00-23 | minutes 00, 05,
 * ..., 55) → tap Valider compose `hour * 60 + minute` et fire la mutation
 * via le callback `onSubmit` passé par le parent (pattern callback :
 * le sheet ne touche pas Convex, il delegate). Le format de SAUVEGARDE
 * reste identique (int minutes), la mirror admin lit la même valeur
 * sans drift.
 *
 * Loading / empty
 * ---------------
 *   - Tenant pas encore résolu → spinner + label (mirror du home #401).
 *   - Convex sub en flight → spinner + « Chargement des horaires… ».
 *   - `windows === []` est légitime (resto pas encore configuré) —
 *     l'éditeur affiche tous les jours « Fermé » + un bouton Ajouter.
 *
 * Cmds en cours pendant l'édition
 * --------------------------------
 * Les cmds en cours sur la home ne sont PAS impactées — la modif horaires
 * ne gate que les NEW checkouts via `isOpenNow` côté PWA client. Même
 * discipline que la pause / la fermeture exceptionnelle.
 */
export function ServiceHoursScreen(): React.ReactElement {
  const tenantId = useActiveTenantId();

  const hours = useQuery(
    api.lib.menu.serviceHours.get,
    tenantId !== null ? { tenantId } : "skip",
  );
  // Optimistic update Convex natif — patch la query `serviceHours.get` locale
  // dès le tap (Pressable Début/Fin flip avant le round-trip). Le store
  // revertit automatiquement si la mutation throw (le backend rejette
  // OVERLAP / START_AFTER_OR_EQUAL_END / OUT_OF_BOUNDS via
  // `assertServiceWindows`) — pas de rollback manuel à orchestrer.
  // Synchronous handler obligatoire (cf. type contraint dans
  // `convex/react/client.d.ts`).
  const setHours = useMutation(
    api.lib.menu.serviceHours.set,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.lib.menu.serviceHours.get, {
      tenantId: args.tenantId,
    });
    if (current === undefined) {
      // Query pas encore résolue localement — rien à patcher. Les guards
      // UI empêchent un tap pendant loading, defense en profondeur.
      return;
    }
    localStore.setQuery(
      api.lib.menu.serviceHours.get,
      { tenantId: args.tenantId },
      { windows: args.windows },
    );
  });

  // Wheel time picker — one shared sheet at the screen level. `pendingEdit`
  // tracks which slot + which field (start / end) the user tapped so the
  // sheet seeds the right value AND the confirm callback knows where to
  // commit. Null when no picker is open.
  const pickerSheetRef = useRef<GorhomBottomSheetModal | null>(null);
  const [pendingEdit, setPendingEdit] = useState<{
    slotIndex: number;
    field: "start" | "end";
    initialMinutes: number;
    /** Snapshot of the slot's OTHER bound — used by the wheel sheet to
     *  pre-validate start < end before firing the parent `onSubmit`. */
    otherBound: { field: "start" | "end"; minutes: number };
  } | null>(null);

  if (tenantId === null) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Chargement du restaurant…
        </Text>
      </View>
    );
  }

  const decision = decideServiceHoursScreen(hours);
  if (decision.kind === "loading") {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Chargement des horaires…
        </Text>
      </View>
    );
  }

  // Le rendu se fait DIRECTEMENT depuis la query Convex (patchée optimistic
  // au tap via `withOptimisticUpdate`). Plus de `draft` local — chaque
  // édition fire `setHours` immédiatement.
  const windows = decision.windows;

  // --- Mutation helpers ----------------------------------------------------

  /**
   * Fire `setHours` avec un nouveau `windows[]` complet. Centralise le
   * try/catch + le toast de succès / d'erreur pour les TROIS chemins
   * d'édition (modify slot via wheel, add slot, remove slot).
   *
   * Le `withOptimisticUpdate` ci-dessus patche la query AVANT que cette
   * fonction soit appelée (le store voit déjà la nouvelle valeur) — donc
   * le Pressable Début/Fin / le Day Row flip instantanément, sans attendre
   * le round-trip. Si le backend rejette, Convex rollback automatiquement
   * et le toast d'erreur informe le gérant.
   */
  async function persist(nextWindows: ServiceWindow[]): Promise<void> {
    // Re-narrow `tenantId` inside the closure — the outer guard only
    // protects the synchronous render path; TS doesn't track narrowing
    // across the async callback.
    if (tenantId === null) return;
    try {
      await setHours({ tenantId, windows: nextWindows });
      notifyAction("serviceHours.save");
    } catch (error) {
      Toast.show({
        type: "error",
        position: "top",
        topOffset: 32,
        text1: "Mise à jour échouée",
        text2: getConvexErrorMessage(error),
      });
    }
  }

  // --- Edit helpers --------------------------------------------------------

  const updateSlot = (
    index: number,
    patch: Partial<Pick<ServiceWindow, "startMinute" | "endMinute">>,
  ): void => {
    const next = windows.map((w, i) => (i === index ? { ...w, ...patch } : w));
    void persist(next);
  };

  const removeSlot = (index: number): void => {
    const next = windows.filter((_, i) => i !== index);
    void persist(next);
  };

  const addSlot = (dayOfWeek: number): void => {
    const next: ServiceWindow[] = [
      ...windows,
      {
        dayOfWeek,
        startMinute: DEFAULT_NEW_SLOT.startMinute,
        endMinute: DEFAULT_NEW_SLOT.endMinute,
      },
    ];
    void persist(next);
  };

  const openPicker = (
    slotIndex: number,
    field: "start" | "end",
    initialMinutes: number,
  ): void => {
    const slot = windows[slotIndex];
    if (slot === undefined) return;
    // Capture the OTHER bound's current value so the wheel sheet can
    // pre-validate `start < end` before submitting (e.g. editing « Début »
    // → the « Fin » value is the constraint). Snapshot taken at open time
    // — if a concurrent Convex push changes it mid-edit, the backend
    // re-validates on `set` and rolls back the optimistic update if
    // anything's off.
    const otherBound =
      field === "start"
        ? { field: "end" as const, minutes: slot.endMinute }
        : { field: "start" as const, minutes: slot.startMinute };
    setPendingEdit({ slotIndex, field, initialMinutes, otherBound });
    pickerSheetRef.current?.present();
  };

  const handlePickerSubmit = (totalMinutes: number): void => {
    if (pendingEdit === null) return;
    const patch =
      pendingEdit.field === "start"
        ? { startMinute: totalMinutes }
        : { endMinute: totalMinutes };
    updateSlot(pendingEdit.slotIndex, patch);
    setPendingEdit(null);
  };

  const validation = validateServiceWindows(windows);

  // Build a Set<windowIndex> of slots that carry at least one error.
  // Used to surface inline error messages under each offending slot —
  // even si le save n'est plus gated par cette validation (le backend
  // rejette via `assertServiceWindows`, on garde l'affichage local
  // pour signaler immédiatement les OVERLAPs cross-créneau au gérant).
  const indicesWithError = new Set<number>();
  for (const err of validation.errors) {
    indicesWithError.add(err.windowIndex);
    if (err.kind === "OVERLAP") indicesWithError.add(err.otherWindowIndex);
  }

  // Vue unique « Cette semaine » — affiche les 7 jours en ordre FR
  // (Lun → Dim). Le toggle « Aujourd'hui / Cette semaine » a été retiré
  // (redondant, et son `accessibilityRole="tab"` causait un crash
  // « Couldn't find a navigation context » au tap).
  const rowsForRender = WEEK_DAYS;

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6"
    >
      <Header />

      {/* Day rows — vue unique « Cette semaine » (Lun → Dim, FR order) */}
      <View className="gap-3">
        {rowsForRender.map((row) => {
          const daySlots = windows
            .map((w, index) => ({ window: w, index }))
            .filter((s) => s.window.dayOfWeek === row.dayOfWeek);
          return (
            <DayRow
              key={row.dayOfWeek}
              dayOfWeek={row.dayOfWeek}
              label={row.label}
              slots={daySlots}
              errorIndices={indicesWithError}
              errors={validation.errors}
              onAdd={() => {
                addSlot(row.dayOfWeek);
              }}
              onOpenPicker={openPicker}
              onRemove={removeSlot}
            />
          );
        })}
      </View>

      {/* Wheel time picker — shared sheet at the screen level (KBO-DIS4 fix,
       *  remplace les <Input> HH:MM qui mangeaient les keystrokes).
       *
       *  Pattern callback : le sheet ne touche pas Convex, il delegate via
       *  `onSubmit(totalMinutes)`. Le sheet PRE-valide localement
       *  `start < end` sur le slot courant via `otherBound` — si la
       *  nouvelle valeur viole cette règle, le sheet AFFICHE l'erreur
       *  inline et BLOQUE le submit (pas de mutation envoyée, pas de
       *  rollback à orchestrer). Les autres validations (OVERLAP) sont
       *  tentées et le backend les rejette avec un toast d'erreur. */}
      <TimeWheelPickerSheet
        sheetRef={pickerSheetRef}
        title={
          pendingEdit?.field === "end" ? "Fin du créneau" : "Début du créneau"
        }
        initialMinutes={pendingEdit?.initialMinutes ?? 12 * 60}
        editingField={pendingEdit?.field ?? "start"}
        otherBound={pendingEdit?.otherBound ?? null}
        onSubmit={handlePickerSubmit}
      />
    </ScrollView>
  );
}

function Header(): React.ReactElement {
  return (
    <View className="mb-4 gap-1">
      <Text className="text-foreground text-xl font-semibold">
        Horaires d&apos;ouverture
      </Text>
      <Text className="text-muted-foreground text-sm">
        Ajuste les créneaux de la semaine.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-day row — same structure as the admin `DayRow` but native primitives
// ---------------------------------------------------------------------------

function DayRow({
  dayOfWeek,
  label,
  slots,
  errorIndices,
  errors,
  onAdd,
  onOpenPicker,
  onRemove,
}: {
  dayOfWeek: number;
  label: string;
  slots: readonly { window: ServiceWindow; index: number }[];
  errorIndices: ReadonlySet<number>;
  errors: readonly ServiceHoursValidationError[];
  onAdd: () => void;
  onOpenPicker: (
    slotIndex: number,
    field: "start" | "end",
    initialMinutes: number,
  ) => void;
  onRemove: (index: number) => void;
}): React.ReactElement {
  return (
    <View
      accessibilityLabel={`Créneaux ${label}`}
      className="border-border bg-card gap-2 rounded-2xl border p-4"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground text-base font-semibold">{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ajouter un créneau ${label}`}
          onPress={onAdd}
          className="flex-row items-center gap-1 px-2 py-1 active:opacity-70"
        >
          <Ionicons name="add" size={18} color="#1B7A3D" />
          <Text className="text-primary text-sm font-medium">
            Ajouter un créneau
          </Text>
        </Pressable>
      </View>

      {slots.length === 0 ? (
        <Text className="text-muted-foreground text-xs">Fermé</Text>
      ) : (
        <View className="gap-2">
          {slots.map((s) => {
            const slotErrors = errors.filter(
              (err) =>
                err.windowIndex === s.index ||
                (err.kind === "OVERLAP" && err.otherWindowIndex === s.index),
            );
            const hasError = errorIndices.has(s.index);
            return (
              <View key={s.index} className="gap-1">
                <View className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Début du créneau, ${minutesToTimeString(s.window.startMinute)}`}
                      accessibilityHint="Ouvre le sélecteur d'heure"
                      onPress={() => {
                        onOpenPicker(s.index, "start", s.window.startMinute);
                      }}
                      className="border-border bg-background h-12 items-center justify-center rounded-md border active:opacity-70"
                    >
                      <Text className="text-foreground text-base font-medium">
                        {minutesToTimeString(s.window.startMinute)}
                      </Text>
                    </Pressable>
                  </View>
                  <Text aria-hidden className="text-muted-foreground">
                    →
                  </Text>
                  <View className="flex-1">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Fin du créneau, ${minutesToTimeString(s.window.endMinute)}`}
                      accessibilityHint="Ouvre le sélecteur d'heure"
                      onPress={() => {
                        onOpenPicker(s.index, "end", s.window.endMinute);
                      }}
                      className="border-border bg-background h-12 items-center justify-center rounded-md border active:opacity-70"
                    >
                      <Text className="text-foreground text-base font-medium">
                        {minutesToTimeString(s.window.endMinute)}
                      </Text>
                    </Pressable>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer le créneau"
                    onPress={() => {
                      onRemove(s.index);
                    }}
                    className="px-2 py-2 active:opacity-70"
                  >
                    <Ionicons name="trash-outline" size={20} color="#B91C1C" />
                  </Pressable>
                </View>
                {hasError ? (
                  <Text className="text-destructive text-xs">
                    {slotErrors.map((err) => slotErrorMessage(err)).join(" · ")}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** User-facing copy per validation error kind (FR). Same wording as the
 *  admin `slotErrorMessage` so the two surfaces stay verbatim consistent. */
function slotErrorMessage(error: ServiceHoursValidationError): string {
  switch (error.kind) {
    case "START_AFTER_OR_EQUAL_END":
      return "Le début doit être strictement avant la fin.";
    case "OVERLAP":
      return "Ce créneau chevauche un autre créneau du même jour.";
    case "OUT_OF_BOUNDS":
      return "L'heure doit être comprise entre 00:00 et 24:00 (sans passer minuit).";
    case "INVALID_DAY":
      return "Jour invalide.";
  }
}
