import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal as GorhomBottomSheetModal } from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import {
  CLOSURE_QUICK_PRESETS,
  type ClosureQuickPreset,
  computeQuickClosureWindow,
  decideClosureControl,
  formatClosureUntilDate,
  parseLocalDateInput,
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
 *    a custom YYYY-MM-DD pair (« Du… au… »). The window is computed via
 *    `computeQuickClosureWindow` (presets) or `parseLocalDateInput` (custom)
 *    so the same `[from, until)` discipline applies on both paths.
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
 * Date picker UX: the issue prompt mentions
 * `@react-native-community/datetimepicker` — not currently installed in
 * `apps/native/package.json`. We use the SAME shape the admin mirror uses
 * (YYYY-MM-DD text via `<Input>`) for two reasons: (1) zero new native
 * module → no expo prebuild change, no install surface; (2) the parser
 * `parseLocalDateInput` is the EXACT mirror of the admin `dateInputToMs`,
 * so a closure typed in the native bottom sheet produces the SAME epoch
 * the admin side would have produced for the same date — zero cross-surface
 * drift. A richer native date picker can be slotted in V2 (or here as a
 * follow-up) without touching the decision module.
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

  // Seed the custom date inputs with sane defaults (today / tomorrow) so
  // the gérant who opens the sheet on small screens sees a valid window
  // pre-filled. Re-seeded on each sheet open via the resetCustom effect.
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customUntil, setCustomUntil] = useState<string>("");
  const [customError, setCustomError] = useState<string | null>(null);

  // No tenant resolved yet (loading session/device OR kb_admin OR no
  // attachment). Render nothing — the home already shows its own
  // placeholder for the same condition.
  if (tenantId === null) return null;

  const decision = decideClosureControl({ closure, nowMs });

  if (decision.kind === "loading") {
    return null;
  }

  function resetCustom() {
    const today = msToDateInput(Date.now());
    const tomorrow = msToDateInput(Date.now() + 24 * 60 * 60 * 1000);
    setCustomFrom(today);
    setCustomUntil(tomorrow);
    setCustomError(null);
  }

  function openSheet() {
    resetCustom();
    sheetRef.current?.present();
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
    const fromMs = parseLocalDateInput(customFrom);
    const untilMs = parseLocalDateInput(customUntil);
    if (fromMs === null || untilMs === null) {
      setCustomError(
        "Saisis une date de début et de fin au format AAAA-MM-JJ.",
      );
      return;
    }
    if (fromMs >= untilMs) {
      setCustomError(
        "La date de fin doit être strictement après la date de début.",
      );
      return;
    }
    setSubmitting("custom");
    try {
      await setClosure({ tenantId, from: fromMs, until: untilMs });
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
        <Button
          variant="outline"
          size="sm"
          onPress={handleReopen}
          disabled={submitting !== null}
          accessibilityLabel="Rouvrir maintenant"
        >
          {submitting === "clear" ? (
            <ActivityIndicator />
          ) : (
            <Text>Rouvrir</Text>
          )}
        </Button>
      </View>
    );
  }

  // idle — entry-point pill
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
                <Input
                  value={customFrom}
                  onChangeText={(text) => {
                    setCustomFrom(text);
                  }}
                  placeholder="AAAA-MM-JJ"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Date de début de la fermeture"
                />
              </View>
              <View className="gap-1">
                <Text className="text-muted-foreground text-xs">Au</Text>
                <Input
                  value={customUntil}
                  onChangeText={(text) => {
                    setCustomUntil(text);
                  }}
                  placeholder="AAAA-MM-JJ"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Date de fin de la fermeture"
                />
              </View>
              {customError !== null ? (
                <Text className="text-destructive text-sm">{customError}</Text>
              ) : null}
              <Button
                onPress={handleSubmitCustom}
                disabled={submitting !== null}
                accessibilityLabel="Fermer le resto avec les dates personnalisées"
                className="h-12"
              >
                {submitting === "custom" ? (
                  <ActivityIndicator />
                ) : (
                  <Text>Fermer le resto</Text>
                )}
              </Button>
            </View>
          </View>
        </View>
      </BottomSheetModal>
    </>
  );
}

/** Convert an epoch ms to the YYYY-MM-DD shape the text input expects.
 * Mirror of the admin `msToDateInput`. */
function msToDateInput(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
