import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Button } from "@/components/ui/button";
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
  PAUSE_DURATIONS_MIN,
  computePauseUntil,
  decidePauseControl,
  formatPauseEta,
  type PauseDurationMin,
} from "./decide-pause-control";

/**
 * #406 — Home « Pause exceptionnelle » control (PRD 20 §7a + ADR 0018).
 *
 * Thin React adapter over the pure `decidePauseControl` decision:
 *
 *  - resolves the active tenant via `useActiveTenantId` (#399) so the chip is
 *    scoped to the right resto and a multi-tenant manager (Walid case) acts on
 *    the tenant currently selected in the header switcher;
 *  - subscribes to `getOperationalPause({ tenantId })` so the badge live-flips
 *    when the gérant pauses the resto on ANOTHER device (kiosque tablette +
 *    téléphone gérant coexistent V1, PRD 20 §13 multi-device limited), or when
 *    KB Admin pauses it on the web (state Convex partagé, ADR 0018);
 *  - ticks a local `nowMs` clock every 15s so the auto-reprise predicate
 *    (`isPauseLive`, EXCLUSIVE on `until`) flips the UI back to `idle` even
 *    without a Convex re-render — at the same instant the backend gate
 *    `acceptsOrderNow` reopens the PWA checkout.
 *
 * Two visual states (matches `PauseControlDecision`):
 *
 *  - **idle** — render the « Pause » entry-point button. Tap opens a bottom
 *    sheet with the three fixed choices 15 / 30 / 60 min (PRD 20 §7a, pas de
 *    custom V1). The ETA is FROZEN at the tap (`computePauseUntil(Date.now(),
 *    duration)`), passed straight into `setOperationalPause({ tenantId, until })`.
 *
 *  - **live** — render an amber badge « Resto en pause jusqu'à HH:MM » with a
 *    secondary « Reprendre maintenant » button. Tapping calls
 *    `clearOperationalPause({ tenantId })`. The badge mirrors the wording used
 *    by the KB Admin mirror (#397 `DisponibiliteView` + 7c) so the gérant sees
 *    the same line across the two apps.
 *
 * Loading state is rendered as an invisible placeholder — the home is already
 * busy with the orders queue, surfacing a spinner here would just compete.
 *
 * Cuisinier safety: the cmds en cours stay actives during the pause (PRD 20
 * §7a) — the backend only gates NEW checkouts via `acceptsOrderNow`. The home
 * keeps rendering the `tenantOrders` queue above this control unchanged; we
 * never hide or grey-out the order cards. The « pause » truly is « commercial
 * availability only, kitchen keeps cooking ».
 */
export function PauseControl(): React.ReactElement | null {
  const tenantId = useActiveTenantId();
  const pause = useQuery(
    api.lib.orders.orders.getOperationalPause,
    tenantId !== null ? { tenantId } : "skip",
  );

  // The auto-reprise predicate hinges on `nowMs`. Tick every 15s so the
  // « En pause jusqu'à HH:MM » badge flips to `idle` near the boundary
  // without forcing a Convex sub re-render. The exact cadence is not critical
  // — the BACKEND gate is the source of truth for the PWA checkout (it reads
  // `Date.now()` at every `acceptsOrderNow` call); this is a UX mirror.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 15 * 1000);
    return () => clearInterval(id);
  }, []);

  const setPause = useMutation(api.lib.orders.orders.setOperationalPause);
  const clearPause = useMutation(api.lib.orders.orders.clearOperationalPause);

  const sheetRef = useRef<GorhomBottomSheetModal | null>(null);
  const [submitting, setSubmitting] = useState<
    PauseDurationMin | "clear" | null
  >(null);

  // No tenant resolved yet (loading session/device OR kb_admin OR no
  // attachment). Render nothing — the home already shows its own placeholder
  // for the same condition.
  if (tenantId === null) return null;

  const decision = decidePauseControl({ pause, nowMs });

  if (decision.kind === "loading") {
    return null;
  }

  async function handlePick(durationMin: PauseDurationMin) {
    if (tenantId === null) return;
    setSubmitting(durationMin);
    try {
      const until = computePauseUntil(Date.now(), durationMin);
      await setPause({ tenantId, until });
      sheetRef.current?.dismiss();
    } catch (error) {
      Alert.alert(
        "Impossible de mettre le resto en pause",
        getConvexErrorMessage(error),
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function handleResume() {
    if (tenantId === null) return;
    setSubmitting("clear");
    try {
      await clearPause({ tenantId });
    } catch (error) {
      Alert.alert("Impossible de lever la pause", getConvexErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  if (decision.kind === "live") {
    return (
      <View
        accessibilityRole="summary"
        accessibilityLabel="Resto en pause exceptionnelle"
        className="mb-4 flex-row items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30"
      >
        <View className="flex-1 flex-row items-center gap-3">
          <Ionicons name="pause-circle" size={28} color="#B45309" />
          <View className="flex-1">
            <Text className="text-foreground text-base font-semibold">
              En pause jusqu&apos;à {formatPauseEta(decision.until)}
            </Text>
            <Text className="text-muted-foreground text-xs">
              Les nouvelles commandes sont bloquées. Les commandes en cours
              continuent.
            </Text>
          </View>
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={handleResume}
          disabled={submitting !== null}
          accessibilityLabel="Reprendre maintenant"
        >
          {submitting === "clear" ? (
            <ActivityIndicator />
          ) : (
            <Text>Reprendre</Text>
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
        accessibilityLabel="Mettre le resto en pause"
        onPress={() => sheetRef.current?.present()}
        className="mb-4 flex-row items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 active:opacity-70"
      >
        <View className="flex-row items-center gap-3">
          <View className="bg-muted h-10 w-10 items-center justify-center rounded-full">
            <Ionicons name="pause" size={20} color="#444" />
          </View>
          <View>
            <Text className="text-foreground text-base font-semibold">
              Pause exceptionnelle
            </Text>
            <Text className="text-muted-foreground text-xs">
              Suspends les nouvelles commandes pendant 15, 30 ou 60 min.
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#666" />
      </Pressable>

      <BottomSheetModal ref={sheetRef}>
        <View className="gap-4 px-6 pb-2 pt-2">
          <View className="gap-1">
            <Text className="text-center text-xl font-semibold">
              Pause exceptionnelle
            </Text>
            <Text className="text-muted-foreground text-center text-sm">
              Choisis une durée. Les commandes en cours continuent ; seul le
              checkout côté client est désactivé.
            </Text>
          </View>
          <View className="gap-3 pt-2">
            {PAUSE_DURATIONS_MIN.map((duration) => (
              <Button
                key={duration}
                variant="outline"
                onPress={() => handlePick(duration)}
                disabled={submitting !== null}
                accessibilityLabel={`Pause ${duration} minutes`}
                className="h-12"
              >
                {submitting === duration ? (
                  <ActivityIndicator />
                ) : (
                  <Text>{duration} min</Text>
                )}
              </Button>
            ))}
          </View>
        </View>
      </BottomSheetModal>
    </>
  );
}
