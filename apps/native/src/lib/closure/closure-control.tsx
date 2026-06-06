import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { notifyAction } from "@/lib/toast";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal as GorhomBottomSheetModal } from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  View,
} from "react-native";
import {
  CLOSURE_QUICK_PRESETS,
  type ClosureQuickPreset,
  computeQuickClosureWindow,
  decideClosureControl,
  decideClosureCustomFromInitial,
  decideClosureCustomUntilMinimum,
  formatClosureFullDate,
  formatClosureUntilDate,
} from "./decide-closure-control";

/**
 * #407 — Home « Fermeture exceptionnelle » control (PRD 20 §7b + ADR 0018).
 *
 * Sibling of `<PauseControl />` (#406) for the DURABLE 1+ day absence: vacances
 * annuelles, panne frigo, intempéries. The two share the home strip but stay
 * separate UI components on purpose — the semantic distinction (transient
 * minutes vs durable days) carries different copy (« Reprendre » vs
 * « Rouvrir »), different ETA formatting (`HH:MM` vs `JJ/MM`), and different
 * input affordances (3 fixed buttons vs presets + custom dates).
 *
 * Thin React adapter over the pure `decideClosureControl` decision:
 *
 *  - resolves the active tenant via `useActiveTenantId` (#399) so the entry
 *    is scoped to the right resto and a multi-tenant manager (Walid case)
 *    acts on the tenant currently selected in the header switcher;
 *  - subscribes to `getExceptionalClosure({ tenantId })` so the badge
 *    live-flips when the gérant closes the resto on ANOTHER device (kiosque
 *    tablette + téléphone gérant coexistent V1, PRD 20 §13) OR when KB Admin
 *    closes it from the web (state Convex partagé via the mirror
 *    `DisponibiliteView`, #397 / ADR 0018);
 *  - ticks a local `nowMs` clock every 30s so the auto-reprise predicate
 *    (`isClosureLive`, [from, until)) flips the UI back to `idle` near the
 *    boundary even without a Convex re-render — at the same instant the
 *    backend gate `acceptsOrderNow` reopens the PWA checkout.
 *
 * Three visual states (matches `ClosureControlDecision`):
 *
 *  - **loading** — render an invisible placeholder, like the pause control.
 *    The home is already busy with the orders queue, surfacing a spinner
 *    here would just compete.
 *
 *  - **idle** — render the « Fermer le resto » entry-point pill. Tap opens
 *    a bottom sheet with the 3 quick presets (Aujourd'hui / J+1 / J+7) and
 *    a custom date pair (« Du… au… »). The window is computed via
 *    `computeQuickClosureWindow` (presets) or directly from the
 *    `DateTimePicker` natif epoch (custom) so the same `[from, until)`
 *    discipline applies on both paths.
 *
 *  - **live** — render a rose badge « Resto fermé jusqu'au JJ/MM » with a
 *    secondary « Rouvrir maintenant » button. Tapping calls
 *    `clearExceptionalClosure({ tenantId })`. The wording mirrors the KB
 *    Admin mirror (#397 `DisponibiliteView` 7b) so the gérant sees the same
 *    line across the two apps.
 *
 * Cuisinier safety: cmds en cours stay actives during the closure — same as
 * the pause. The backend only gates NEW checkouts via `acceptsOrderNow`. The
 * home keeps rendering the `tenantOrders` queue above this control
 * unchanged; we never hide or grey-out the order cards. The closure truly is
 * « disponibilité commerciale only, kitchen keeps cooking out residual ».
 *
 * Date picker UX (2026-06-07 — remplace les inputs texte d'origine) :
 *
 *  - Deux `<Pressable>` (style outline, h-48) sous les labels « Du » / « Au »
 *    qui ouvrent le `DateTimePicker` natif au tap. La date sélectionnée est
 *    affichée en plein texte fr-FR sous le label (« vendredi 12 juin 2026 »)
 *    — pas d'ambiguïté possible JJ/MM vs MM/JJ.
 *  - Android (`display="default"`) : popup natif Material (sheet plein écran
 *    avec calendrier visuel), un seul tap pour ouvrir.
 *  - iOS (`display="inline"`) : calendar inline compact, render permanent
 *    contrôlé par l'état `isOpen` (on l'affiche en push-down sous le bouton
 *    quand le gérant tape).
 *  - `minimumDate = today` sur `Du` (pas de fermeture rétroactive — la
 *    mutation backend la rejetterait, autant la bloquer côté UI).
 *  - `minimumDate = from + 24h` sur `Au` (cohérent avec la validation
 *    `from >= until` côté backend + le contrat « 1+ jour » du PRD §7b).
 *  - Zéro touche le backend : la mutation `setExceptionalClosure` accepte
 *    déjà des epoch ms.
 */
export function ClosureControl(): React.ReactElement | null {
  const tenantId = useActiveTenantId();
  const closure = useQuery(
    api.lib.orders.orders.getExceptionalClosure,
    tenantId !== null ? { tenantId } : "skip",
  );

  // The auto-reprise predicate hinges on `nowMs`. Tick every 30s so the
  // « Fermé jusqu'au JJ/MM » badge flips to `idle` near the boundary
  // without forcing a Convex sub re-render. Slower cadence than the pause
  // (15s) because a closure boundary is at LOCAL MIDNIGHT — a 30s clock
  // is plenty for the user-perceived auto-reprise. The BACKEND gate stays
  // the source of truth for the PWA checkout (it reads `Date.now()` at
  // every `acceptsOrderNow` call); this is a UX mirror.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const setClosure = useMutation(api.lib.orders.orders.setExceptionalClosure);
  const clearClosure = useMutation(
    api.lib.orders.orders.clearExceptionalClosure,
  );

  const sheetRef = useRef<GorhomBottomSheetModal | null>(null);
  const [submitting, setSubmitting] = useState<
    ClosureQuickPreset | "custom" | "clear" | null
  >(null);

  // Custom window — `customFrom` / `customUntil` are epoch ms now (was
  // text), seeded at sheet open via the pure helpers. The picker writes
  // directly into these states via the `onChange` callback.
  const [customFrom, setCustomFrom] = useState<number>(() =>
    decideClosureCustomFromInitial(Date.now()),
  );
  const [customUntil, setCustomUntil] = useState<number>(() =>
    decideClosureCustomUntilMinimum(decideClosureCustomFromInitial(Date.now())),
  );
  const [customError, setCustomError] = useState<string | null>(null);

  // iOS uses `display="inline"` which is a permanent inline render — we
  // toggle visibility via `showFromPicker` / `showUntilPicker` so the
  // calendar only appears when the gérant taps the matching button.
  // Android uses `display="default"` which is a one-shot modal; we set the
  // flag to true to open the modal then reset it to false in `onChange`.
  const [showFromPicker, setShowFromPicker] = useState<boolean>(false);
  const [showUntilPicker, setShowUntilPicker] = useState<boolean>(false);

  // No tenant resolved yet (loading session/device OR kb_admin OR no
  // attachment). Render nothing — the home already shows its own
  // placeholder for the same condition.
  if (tenantId === null) return null;

  const decision = decideClosureControl({ closure, nowMs });

  if (decision.kind === "loading") {
    return null;
  }

  function resetCustom() {
    const from = decideClosureCustomFromInitial(Date.now());
    setCustomFrom(from);
    setCustomUntil(decideClosureCustomUntilMinimum(from));
    setCustomError(null);
    setShowFromPicker(false);
    setShowUntilPicker(false);
  }

  function openSheet() {
    resetCustom();
    sheetRef.current?.present();
  }

  function handleFromChange(event: DateTimePickerEvent, picked?: Date) {
    // Android dismisses the modal on any user action — we always close the
    // picker. iOS keeps the inline calendar mounted, so we leave it open.
    if (Platform.OS === "android") {
      setShowFromPicker(false);
    }
    if (event.type === "dismissed" || picked === undefined) {
      return;
    }
    const nextFrom = picked.getTime();
    setCustomFrom(nextFrom);
    // Keep the « Au » coherent : if it's now <= from + 24h, bump it to the
    // new minimum. The picker `minimumDate` enforces the same floor on the
    // next render — this just keeps the displayed value valid in between.
    const minUntil = decideClosureCustomUntilMinimum(nextFrom);
    if (customUntil < minUntil) {
      setCustomUntil(minUntil);
    }
    setCustomError(null);
  }

  function handleUntilChange(event: DateTimePickerEvent, picked?: Date) {
    if (Platform.OS === "android") {
      setShowUntilPicker(false);
    }
    if (event.type === "dismissed" || picked === undefined) {
      return;
    }
    setCustomUntil(picked.getTime());
    setCustomError(null);
  }

  async function handlePickPreset(preset: ClosureQuickPreset) {
    if (tenantId === null) return;
    setSubmitting(preset);
    try {
      const window = computeQuickClosureWindow(Date.now(), preset);
      await setClosure({
        tenantId,
        from: window.from,
        until: window.until,
      });
      notifyAction("availability.close", {
        detail: `Jusqu'au ${formatClosureUntilDate(window.until)}`,
      });
      sheetRef.current?.dismiss();
    } catch (error) {
      Alert.alert(
        "Impossible de fermer le resto",
        getConvexErrorMessage(error),
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function handleSubmitCustom() {
    if (tenantId === null) return;
    setCustomError(null);
    if (customFrom >= customUntil) {
      setCustomError(
        "La date de fin doit être strictement après la date de début.",
      );
      return;
    }
    setSubmitting("custom");
    try {
      await setClosure({ tenantId, from: customFrom, until: customUntil });
      notifyAction("availability.close", {
        detail: `Jusqu'au ${formatClosureUntilDate(customUntil)}`,
      });
      sheetRef.current?.dismiss();
    } catch (error) {
      Alert.alert(
        "Impossible de fermer le resto",
        getConvexErrorMessage(error),
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function handleReopen() {
    if (tenantId === null) return;
    setSubmitting("clear");
    try {
      await clearClosure({ tenantId });
      notifyAction("availability.reopen");
    } catch (error) {
      Alert.alert(
        "Impossible de rouvrir le resto",
        getConvexErrorMessage(error),
      );
    } finally {
      setSubmitting(null);
    }
  }

  if (decision.kind === "live") {
    return (
      <View
        accessibilityRole="summary"
        accessibilityLabel="Resto fermé exceptionnellement"
        className="mb-4 flex-row items-center justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-700 dark:bg-rose-950/30"
      >
        <View className="flex-1 flex-row items-center gap-3">
          <Ionicons name="calendar" size={28} color="#B91C1C" />
          <View className="flex-1">
            <Text className="text-foreground text-base font-semibold">
              Fermé jusqu&apos;au {formatClosureUntilDate(decision.until)}
            </Text>
            <Text className="text-muted-foreground text-xs">
              Les clients ne peuvent plus commander. Les commandes en cours
              continuent.
            </Text>
          </View>
        </View>
        {/* Action POSITIVE — rouvrir le resto = green KB (palette CLAUDE.md).
            Icône lock-open = réouverture, miroir visuel de la fermeture. */}
        <Button
          size="sm"
          onPress={handleReopen}
          disabled={submitting !== null}
          accessibilityLabel="Rouvrir maintenant"
        >
          {submitting === "clear" ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Ionicons name="lock-open-outline" size={16} color="white" />
              <Text className="text-primary-foreground font-semibold">
                Rouvrir
              </Text>
            </>
          )}
        </Button>
      </View>
    );
  }

  // idle — entry-point pill
  const minUntil = decideClosureCustomUntilMinimum(customFrom);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fermer le resto exceptionnellement"
        onPress={openSheet}
        className="border-border bg-card mb-4 flex-row items-center justify-between gap-3 rounded-2xl border p-4 active:opacity-70"
      >
        <View className="flex-row items-center gap-3">
          <View className="bg-muted h-10 w-10 items-center justify-center rounded-full">
            <Ionicons name="calendar-outline" size={20} color="#444" />
          </View>
          <View>
            <Text className="text-foreground text-base font-semibold">
              Fermeture exceptionnelle
            </Text>
            <Text className="text-muted-foreground text-xs">
              Vacances, panne frigo, intempéries — 1 jour ou plus.
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#666" />
      </Pressable>

      <BottomSheetModal ref={sheetRef}>
        <View className="gap-4 px-6 pb-4 pt-2">
          <View className="gap-1">
            <Text className="text-center text-xl font-semibold">
              Fermeture exceptionnelle
            </Text>
            <Text className="text-muted-foreground text-center text-sm">
              Choisis une durée. Le checkout côté client sera désactivé
              jusqu&apos;à la date de réouverture.
            </Text>
          </View>

          <View className="gap-2 pt-2">
            <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              Choix rapides
            </Text>
            <View className="gap-3">
              {CLOSURE_QUICK_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant="outline"
                  onPress={() => handlePickPreset(preset)}
                  disabled={submitting !== null}
                  accessibilityLabel={presetAccessibilityLabel(preset)}
                  className="h-12"
                >
                  {submitting === preset ? (
                    <ActivityIndicator />
                  ) : (
                    <Text>{presetLabel(preset)}</Text>
                  )}
                </Button>
              ))}
            </View>
          </View>

          <View className="gap-2 pt-2">
            <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              Personnalisé
            </Text>
            <View className="gap-3">
              <View className="gap-1">
                <Text className="text-muted-foreground text-xs">Du</Text>
                <Pressable
                  onPress={() => setShowFromPicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Choisir la date de début de la fermeture"
                  className="border-border bg-background h-12 justify-center rounded-md border px-3 active:opacity-70"
                >
                  <Text className="text-foreground text-base">
                    {formatClosureFullDate(customFrom)}
                  </Text>
                </Pressable>
                {showFromPicker ? (
                  <DateTimePicker
                    value={new Date(customFrom)}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "default"}
                    minimumDate={
                      new Date(decideClosureCustomFromInitial(Date.now()))
                    }
                    onChange={handleFromChange}
                  />
                ) : null}
              </View>
              <View className="gap-1">
                <Text className="text-muted-foreground text-xs">Au</Text>
                <Pressable
                  onPress={() => setShowUntilPicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Choisir la date de fin de la fermeture"
                  className="border-border bg-background h-12 justify-center rounded-md border px-3 active:opacity-70"
                >
                  <Text className="text-foreground text-base">
                    {formatClosureFullDate(customUntil)}
                  </Text>
                </Pressable>
                {showUntilPicker ? (
                  <DateTimePicker
                    value={new Date(customUntil)}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "default"}
                    minimumDate={new Date(minUntil)}
                    onChange={handleUntilChange}
                  />
                ) : null}
              </View>
              {customError !== null ? (
                <Text className="text-destructive text-sm">{customError}</Text>
              ) : null}
              {/* Action NÉGATIVE — fermer le resto = rouge destructive.
                  Icône cadenas fermé = fermeture, miroir de l'icône
                  d'ouverture (`lock-open-outline`) sur le bouton « Rouvrir ». */}
              <Button
                variant="destructive"
                onPress={handleSubmitCustom}
                disabled={submitting !== null}
                accessibilityLabel="Fermer le resto avec les dates personnalisées"
                className="h-12"
              >
                {submitting === "custom" ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons
                      name="lock-closed-outline"
                      size={18}
                      color="white"
                    />
                    <Text className="text-destructive-foreground font-semibold">
                      Fermer le resto
                    </Text>
                  </>
                )}
              </Button>
            </View>
          </View>
        </View>
      </BottomSheetModal>
    </>
  );
}

function presetLabel(preset: ClosureQuickPreset): string {
  if (preset === "today") return "Aujourd'hui seulement";
  if (preset === "plus_1") return "2 jours";
  return "1 semaine";
}

function presetAccessibilityLabel(preset: ClosureQuickPreset): string {
  if (preset === "today") return "Fermer le resto aujourd'hui seulement";
  if (preset === "plus_1") return "Fermer le resto pendant 2 jours";
  return "Fermer le resto pendant une semaine";
}
