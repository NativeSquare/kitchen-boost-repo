import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { notifyAction } from "@/lib/toast";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal as GorhomBottomSheetModal } from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { Calendar, LocaleConfig } from "react-native-calendars";
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
 *    `computeQuickClosureWindow` (presets) or directly from the calendar
 *    selection (custom) so the same `[from, until)` discipline applies on
 *    both paths.
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
 * Date picker UX (2026-06-07 — pivot vers `react-native-calendars`) :
 *
 *  - L'ancienne intégration `@react-native-community/datetimepicker` était un
 *    TurboModule natif qui crashait au runtime sur tout dev build qui n'avait
 *    pas été rebuild après son ajout (« RNCDatePicker could not be found »).
 *    Rebuilder un dev client à chaque variation de modules natifs casse le
 *    workflow Expo Go-like d'Alex. On bascule sur `react-native-calendars`
 *    (Wix) — calendar 100% JS, ZÉRO module natif, marche immédiatement avec
 *    le dev client existant + Expo Go.
 *  - Deux `<Pressable>` (style outline, h-48) sous les labels « Du » / « Au »
 *    qui togglent l'affichage d'un `<Calendar>` sous le bouton. Tap sur une
 *    date du calendar → applique la sélection + ferme le calendar.
 *  - Branding KB : `selectedDayBackgroundColor` / `todayTextColor` /
 *    `arrowColor` = vert KB `#1B7A3D` (palette CLAUDE.md).
 *  - Locale fr-FR configurée au top-level via `LocaleConfig` (xdate
 *    re-export) — nom des mois et jours en français dans le calendar header.
 *  - `minDate` sur `Du` = aujourd'hui (pas de fermeture rétroactive — la
 *    mutation backend la rejetterait, autant la bloquer côté UI).
 *  - `minDate` sur `Au` = `Du + 24h` (cohérent avec la validation
 *    `from >= until` côté backend + le contrat « 1+ jour » du PRD §7b).
 *  - Zéro touche le backend : la mutation `setExceptionalClosure` accepte
 *    déjà des epoch ms.
 */

// --- Locale fr-FR pour react-native-calendars ----------------------------
// LocaleConfig est un alias `xdate` re-exporté par react-native-calendars.
// On configure une seule fois au chargement du module (idempotent : si le
// module est ré-importé par un fast-refresh, l'assignation reste correcte).
// Tous les libellés du calendar (mois, jours abrégés, today) passent en
// français — cohérent avec le copy fr-FR du reste de l'app KB Orders.
LocaleConfig.locales["fr"] = {
  monthNames: [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
  ],
  monthNamesShort: [
    "Janv.",
    "Févr.",
    "Mars",
    "Avr.",
    "Mai",
    "Juin",
    "Juil.",
    "Août",
    "Sept.",
    "Oct.",
    "Nov.",
    "Déc.",
  ],
  dayNames: [
    "Dimanche",
    "Lundi",
    "Mardi",
    "Mercredi",
    "Jeudi",
    "Vendredi",
    "Samedi",
  ],
  dayNamesShort: ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."],
  today: "Aujourd'hui",
};
LocaleConfig.defaultLocale = "fr";

// Vert KB foncé (CLAUDE.md palette).
const KB_GREEN = "#1B7A3D";

// Theme calendar — branding KB sur les éléments interactifs (jour sélectionné,
// today, flèches mois). Le reste reste neutre pour ne pas heurter le mode
// sombre éventuel.
const CALENDAR_THEME = {
  selectedDayBackgroundColor: KB_GREEN,
  selectedDayTextColor: "#ffffff",
  todayTextColor: KB_GREEN,
  arrowColor: KB_GREEN,
  textDayFontWeight: "500",
  textMonthFontWeight: "600",
  textDayHeaderFontWeight: "600",
} as const;

/** Convert epoch ms → `YYYY-MM-DD` (local time) for react-native-calendars. */
function epochToCalendarDate(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Convert `YYYY-MM-DD` (calendar selection) → epoch ms at local midnight. */
function calendarDateToEpoch(yyyyMmDd: string): number {
  const [yearStr, monthStr, dayStr] = yyyyMmDd.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

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

  // Custom window — `customFrom` / `customUntil` are epoch ms, seeded at sheet
  // open via the pure helpers. The calendar writes directly into these states
  // via the `onDayPress` callback.
  const [customFrom, setCustomFrom] = useState<number>(() =>
    decideClosureCustomFromInitial(Date.now()),
  );
  const [customUntil, setCustomUntil] = useState<number>(() =>
    decideClosureCustomUntilMinimum(decideClosureCustomFromInitial(Date.now())),
  );
  const [customError, setCustomError] = useState<string | null>(null);

  // Which calendar (if any) is currently expanded under the « Du » / « Au »
  // pressable. `null` = no calendar visible (the two pressable rows stay
  // collapsed). Toggling either one closes the other so they never stack.
  const [editing, setEditing] = useState<"from" | "until" | null>(null);

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
    setEditing(null);
  }

  function openSheet() {
    resetCustom();
    sheetRef.current?.present();
  }

  function handleFromPick(yyyyMmDd: string) {
    const nextFrom = calendarDateToEpoch(yyyyMmDd);
    setCustomFrom(nextFrom);
    // Keep the « Au » coherent : if it's now <= from + 24h, bump it to the
    // new minimum. The calendar `minDate` enforces the same floor on the
    // next render — this just keeps the displayed value valid in between.
    const minUntil = decideClosureCustomUntilMinimum(nextFrom);
    if (customUntil < minUntil) {
      setCustomUntil(minUntil);
    }
    setCustomError(null);
    setEditing(null);
  }

  function handleUntilPick(yyyyMmDd: string) {
    setCustomUntil(calendarDateToEpoch(yyyyMmDd));
    setCustomError(null);
    setEditing(null);
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
  const minUntilMs = decideClosureCustomUntilMinimum(customFrom);
  const minFromCalendar = epochToCalendarDate(
    decideClosureCustomFromInitial(Date.now()),
  );
  const minUntilCalendar = epochToCalendarDate(minUntilMs);

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
                  onPress={() =>
                    setEditing((current) =>
                      current === "from" ? null : "from",
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Choisir la date de début de la fermeture"
                  className="border-border bg-background h-12 flex-row items-center justify-between rounded-md border px-3 active:opacity-70"
                >
                  <Text className="text-foreground text-base">
                    {formatClosureFullDate(customFrom)}
                  </Text>
                  <Ionicons
                    name={
                      editing === "from"
                        ? "chevron-up-outline"
                        : "chevron-down-outline"
                    }
                    size={18}
                    color="#666"
                  />
                </Pressable>
                {editing === "from" ? (
                  <View className="border-border mt-1 overflow-hidden rounded-md border">
                    <Calendar
                      current={epochToCalendarDate(customFrom)}
                      minDate={minFromCalendar}
                      onDayPress={(day) => handleFromPick(day.dateString)}
                      markedDates={{
                        [epochToCalendarDate(customFrom)]: { selected: true },
                      }}
                      theme={CALENDAR_THEME}
                      firstDay={1}
                    />
                  </View>
                ) : null}
              </View>
              <View className="gap-1">
                <Text className="text-muted-foreground text-xs">Au</Text>
                <Pressable
                  onPress={() =>
                    setEditing((current) =>
                      current === "until" ? null : "until",
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Choisir la date de fin de la fermeture"
                  className="border-border bg-background h-12 flex-row items-center justify-between rounded-md border px-3 active:opacity-70"
                >
                  <Text className="text-foreground text-base">
                    {formatClosureFullDate(customUntil)}
                  </Text>
                  <Ionicons
                    name={
                      editing === "until"
                        ? "chevron-up-outline"
                        : "chevron-down-outline"
                    }
                    size={18}
                    color="#666"
                  />
                </Pressable>
                {editing === "until" ? (
                  <View className="border-border mt-1 overflow-hidden rounded-md border">
                    <Calendar
                      current={epochToCalendarDate(customUntil)}
                      minDate={minUntilCalendar}
                      onDayPress={(day) => handleUntilPick(day.dateString)}
                      markedDates={{
                        [epochToCalendarDate(customUntil)]: { selected: true },
                      }}
                      theme={CALENDAR_THEME}
                      firstDay={1}
                    />
                  </View>
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
