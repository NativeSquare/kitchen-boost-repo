import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { notifyAction } from "@/lib/toast";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import {
  DEFAULT_NEW_SLOT,
  WEEK_DAYS,
  decideServiceHoursScreen,
  minutesToTimeString,
  timeStringToMinutes,
  validateServiceWindows,
  type ServiceHoursValidationError,
  type ServiceWindow,
} from "./decide-service-hours";

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
 * Validation
 * ----------
 * `validateServiceWindows` (pur, mirror du backend `assertServiceWindows`)
 * tourne sur le state local à chaque render. Bouton Enregistrer désactivé
 * tant qu'il y a une erreur ; message inline par créneau fautif. Backend
 * reste la source de vérité (défense en profondeur) — même si le front
 * est contourné, la mutation `set` rejette tout windows[] invalide.
 *
 * Time picker
 * -----------
 * Le PRD prompt mentionne `@react-native-community/datetimepicker` —
 * pas installé dans `apps/native/package.json` (vérifié pkg.json). Pour
 * éviter d'introduire un native module qui forcerait un prebuild Expo +
 * fenêtre d'install supplémentaire, l'éditeur reprend l'approche de
 * `<ClosureControl />` (#407) : `Input` text + parser strict (`HH:MM` via
 * `timeStringToMinutes`). Même shape que la mirror admin
 * (`<input type="time">` accepte aussi `HH:MM`) — un créneau saisi côté
 * native lit identiquement côté admin et inversement (pas de drift).
 * Un picker richer peut être plug en V2 sans toucher la decision layer.
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
  const setHours = useMutation(api.lib.menu.serviceHours.set);

  // L'éditeur owns son state local — `hours` ne sert qu'à seeder à la
  // première frame chargée. Un re-render Convex pendant l'édition ne wipe
  // PAS les inputs en cours (même discipline que l'admin
  // `ServiceHoursEditor`). Re-seed via `useMemo` + clé sur `hours` quand
  // on passe de `loading` à `ready` (i.e. quand le screen vient d'ouvrir).
  const initialWindows = useMemo<ServiceWindow[] | null>(() => {
    if (hours === undefined) return null;
    return hours.windows.map((w) => ({ ...w }));
  }, [hours]);

  const [draft, setDraft] = useState<ServiceWindow[] | null>(null);
  // Seed `draft` on the first frame where Convex has resolved.
  if (draft === null && initialWindows !== null) {
    setDraft(initialWindows);
  }

  const [submitting, setSubmitting] = useState<boolean>(false);

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
  if (decision.kind === "loading" || draft === null) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Chargement des horaires…
        </Text>
      </View>
    );
  }

  // --- Edit helpers --------------------------------------------------------

  const updateSlot = (
    index: number,
    patch: Partial<Pick<ServiceWindow, "startMinute" | "endMinute">>,
  ): void => {
    setDraft((prev) =>
      prev === null
        ? prev
        : prev.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    );
  };

  const removeSlot = (index: number): void => {
    setDraft((prev) =>
      prev === null ? prev : prev.filter((_, i) => i !== index),
    );
  };

  const addSlot = (dayOfWeek: number): void => {
    setDraft((prev) =>
      prev === null
        ? prev
        : [
            ...prev,
            {
              dayOfWeek,
              startMinute: DEFAULT_NEW_SLOT.startMinute,
              endMinute: DEFAULT_NEW_SLOT.endMinute,
            },
          ],
    );
  };

  const validation = validateServiceWindows(draft);

  // Build a Set<windowIndex> of slots that carry at least one error.
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

  async function handleSave(): Promise<void> {
    if (!validation.isValid) return;
    if (draft === null) return;
    // Re-narrow `tenantId` inside the closure — the outer `null` guard
    // only protects the synchronous render path; TS doesn't track that
    // narrowing across the async callback.
    if (tenantId === null) return;
    setSubmitting(true);
    try {
      // `serviceHours.set` remplace l'ENTIER windows[] atomically (UPSERT
      // par tenant). On envoie directement le draft édité — vue unique
      // semaine, donc tous les jours sont déjà dans le draft.
      await setHours({ tenantId, windows: draft });
      notifyAction("serviceHours.save");
    } catch (error) {
      Alert.alert(
        "Impossible d'enregistrer les horaires",
        getConvexErrorMessage(error),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6"
    >
      <Header />

      {/* Day rows — vue unique « Cette semaine » (Lun → Dim, FR order) */}
      <View className="gap-3">
        {rowsForRender.map((row) => {
          const daySlots = draft
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
              onUpdate={updateSlot}
              onRemove={removeSlot}
            />
          );
        })}
      </View>

      {/* Save */}
      <View className="mt-6 gap-2">
        <Button
          onPress={() => {
            void handleSave();
          }}
          disabled={submitting || !validation.isValid}
          accessibilityLabel="Enregistrer les horaires"
          className="h-12"
        >
          {submitting ? <ActivityIndicator /> : <Text>Enregistrer</Text>}
        </Button>
        {!validation.isValid ? (
          <Text className="text-destructive text-center text-xs">
            Corrige les erreurs pour pouvoir enregistrer.
          </Text>
        ) : null}
      </View>
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
        Ajuste les créneaux de la semaine. Les jours fériés annuels se gèrent
        depuis KB Admin.
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
  onUpdate,
  onRemove,
}: {
  dayOfWeek: number;
  label: string;
  slots: readonly { window: ServiceWindow; index: number }[];
  errorIndices: ReadonlySet<number>;
  errors: readonly ServiceHoursValidationError[];
  onAdd: () => void;
  onUpdate: (
    index: number,
    patch: Partial<Pick<ServiceWindow, "startMinute" | "endMinute">>,
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
                    <Input
                      value={minutesToTimeString(s.window.startMinute)}
                      placeholder="HH:MM"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel="Début du créneau"
                      onChangeText={(text) => {
                        const parsed = timeStringToMinutes(text);
                        if (!Number.isNaN(parsed)) {
                          onUpdate(s.index, { startMinute: parsed });
                        }
                      }}
                    />
                  </View>
                  <Text aria-hidden className="text-muted-foreground">
                    →
                  </Text>
                  <View className="flex-1">
                    <Input
                      value={minutesToTimeString(s.window.endMinute)}
                      placeholder="HH:MM"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="numbers-and-punctuation"
                      accessibilityLabel="Fin du créneau"
                      onChangeText={(text) => {
                        const parsed = timeStringToMinutes(text);
                        if (!Number.isNaN(parsed)) {
                          onUpdate(s.index, { endMinute: parsed });
                        }
                      }}
                    />
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
