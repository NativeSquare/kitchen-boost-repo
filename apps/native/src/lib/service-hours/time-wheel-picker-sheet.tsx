import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { BottomSheetModal as GorhomBottomSheetModal } from "@gorhom/bottom-sheet";
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  WHEEL_HOURS,
  WHEEL_MINUTES,
  composeWheelMinutes,
  splitWheelMinutes,
} from "./decide-time-wheel";

/**
 * #409 / KBO-DIS4 — JS-only wheel time picker (terrain 2026-06-07).
 *
 * Replaces the `<Input>` HH:MM fields that swallowed keystrokes (cf.
 * `decide-time-wheel.ts` docstring for the root cause). Same JS-only
 * discipline as the closure calendar pivot (commit `70252ba`) — ZERO native
 * module so the existing dev client / Expo Go work unchanged.
 *
 * UX
 * ---
 * Two snap ScrollViews stacked side-by-side (hours 00–23 | minutes 00, 05,
 * ..., 55). Each row is `ROW_HEIGHT` px tall. The selection band is a
 * 1px-bordered overlay at the vertical center of the wheel. The user drags
 * to spin a column; on momentum-scroll-end we snap to the nearest row and
 * commit a local (hour, minute) draft. Tapping « Valider » commits the
 * compound value to the parent via `onSubmit(totalMinutes)` (refactor
 * 2026-06-07 — renamed from `onConfirm` to align with the per-slot
 * persistance immédiate pattern of the parent screen). « Annuler » closes
 * without committing.
 *
 * Per-slot validation locale (refactor 2026-06-07)
 * ------------------------------------------------
 * Parent passe `editingField` (« start » ou « end ») + `otherBound` (la
 * valeur de l'autre borne du slot courant). Au tap Valider :
 *
 *   - si la nouvelle valeur violerait `start < end` sur ce slot →
 *     **affiche un message d'erreur inline dans le sheet, NE ferme PAS,
 *     NE call PAS `onSubmit`**. C'est la SEULE validation locale qui
 *     bloque — pour éviter d'envoyer une mutation qu'on sait condamnée +
 *     le toast d'erreur qui suivrait.
 *   - sinon → ferme le sheet + call `onSubmit(totalMinutes)`.
 *
 * Les autres validations (OVERLAP cross-créneau) restent côté parent :
 * la mutation tente, le backend rejette via `assertServiceWindows`, et un
 * toast d'erreur prend le relais avec un rollback automatique du store
 * Convex (optimistic update wiped).
 *
 * Why not a single FlatList per column ?
 * --------------------------------------
 * The data sets are tiny (24 + 12). A plain ScrollView with snapToInterval +
 * manual padding for the center band is simpler, has zero overscan logic,
 * and renders the entire column off-screen so the wheel feels instant. If
 * we ever bump the step to 1-min granularity (60 values), FlatList becomes
 * the right call — pin the threshold in `WHEEL_MINUTE_STEP` and rev here.
 */

/** Height of one row in the wheel, in px. Drives `snapToInterval` and the
 *  vertical-center padding. */
const ROW_HEIGHT = 44;

/** How many rows are visible above + below the selected row. The wheel is
 *  `ROW_HEIGHT * (2 * VISIBLE_ROWS_AROUND_CENTER + 1)` px tall. */
const VISIBLE_ROWS_AROUND_CENTER = 2;

/** Total wheel height — selection row + symmetric padding above + below. */
const WHEEL_HEIGHT = ROW_HEIGHT * (VISIBLE_ROWS_AROUND_CENTER * 2 + 1);

export type TimeWheelPickerSheetProps = {
  /** Bottom sheet ref the parent controls (`.present()` to open). */
  sheetRef: React.RefObject<GorhomBottomSheetModal | null>;
  /** Sheet header — « Début du créneau » / « Fin du créneau ». */
  title: string;
  /** Seed value (minutes from midnight). The wheel restores this position
   *  every time the sheet is `present()`ed. */
  initialMinutes: number;
  /** Which bound of the slot the user is editing — needed for the local
   *  `start < end` guard. */
  editingField: "start" | "end";
  /** The OTHER bound's current value (snapshot taken when the parent
   *  opened the sheet). Used to pre-validate `start < end` before firing
   *  `onSubmit`. `null` when the parent has no pending edit (sheet closed)
   *  — the validation is then a no-op (sheet won't be visible). */
  otherBound: { field: "start" | "end"; minutes: number } | null;
  /** Called when the user taps « Valider » AND the local `start < end`
   *  guard passes. Passes the composed minute count (HH * 60 + MM). The
   *  sheet dismisses itself before calling. */
  onSubmit: (totalMinutes: number) => void;
};

export function TimeWheelPickerSheet({
  sheetRef,
  title,
  initialMinutes,
  editingField,
  otherBound,
  onSubmit,
}: TimeWheelPickerSheetProps) {
  const seed = React.useMemo(
    () => splitWheelMinutes(initialMinutes),
    [initialMinutes],
  );

  // Local draft — lives between `present()` and `onSubmit` / dismiss. Re-
  // seeded when the parent passes a new `initialMinutes` (e.g. user opens
  // the picker for a different slot).
  const [hour, setHour] = React.useState<number>(seed.hour);
  const [minute, setMinute] = React.useState<number>(seed.minute);
  const [localError, setLocalError] = React.useState<string | null>(null);

  // Re-seed on prop change so the wheel never shows stale state when the
  // parent re-opens for another field. Also clear any prior error message
  // (the user is starting a fresh edit).
  React.useEffect(() => {
    setHour(seed.hour);
    setMinute(seed.minute);
    setLocalError(null);
  }, [seed.hour, seed.minute]);

  /**
   * Tap « Valider ». Local guard : if the composed value would violate
   * `start < end` on the current slot, surface a FR error inline and
   * bail. Otherwise close the sheet + call `onSubmit`.
   */
  const handleSubmit = () => {
    const total = composeWheelMinutes(hour, minute);
    if (Number.isNaN(total)) {
      // Shouldn't fire — the wheel only proposes valid (hour, minute)
      // pairs. Defense in depth: bail silently rather than send NaN.
      return;
    }
    // Local `start < end` guard. The other-bound snapshot was captured
    // by the parent at sheet-open time. If a concurrent push moved it
    // mid-edit, the backend re-validates anyway and rollbacks on throw.
    if (otherBound !== null) {
      const violatesOrder =
        (editingField === "start" && total >= otherBound.minutes) ||
        (editingField === "end" && total <= otherBound.minutes);
      if (violatesOrder) {
        setLocalError(
          editingField === "start"
            ? "Le début doit être strictement avant la fin."
            : "La fin doit être strictement après le début.",
        );
        return;
      }
    }
    setLocalError(null);
    sheetRef.current?.dismiss();
    onSubmit(total);
  };

  const handleCancel = () => {
    setLocalError(null);
    sheetRef.current?.dismiss();
  };

  return (
    <BottomSheetModal ref={sheetRef}>
      <View className="gap-4 px-4 pb-2 pt-2">
        <Text className="text-foreground text-lg font-semibold">{title}</Text>

        <View
          accessibilityLabel="Sélecteur d'heure"
          className="flex-row items-stretch justify-center gap-4"
          style={{ height: WHEEL_HEIGHT }}
        >
          <WheelColumn
            accessibilityLabel="Heures"
            values={WHEEL_HOURS}
            selected={hour}
            onChange={(v) => {
              setHour(v);
              setLocalError(null);
            }}
          />
          <View className="items-center justify-center">
            <Text className="text-foreground text-xl font-semibold">:</Text>
          </View>
          <WheelColumn
            accessibilityLabel="Minutes"
            values={WHEEL_MINUTES}
            selected={minute}
            onChange={(v) => {
              setMinute(v);
              setLocalError(null);
            }}
          />
        </View>

        {localError !== null ? (
          <Text
            className="text-destructive text-center text-xs"
            accessibilityLabel={`Erreur : ${localError}`}
          >
            {localError}
          </Text>
        ) : null}

        <View className="flex-row gap-2 pt-2">
          <View className="flex-1">
            <Button
              variant="outline"
              onPress={handleCancel}
              accessibilityLabel="Annuler"
            >
              <Text>Annuler</Text>
            </Button>
          </View>
          <View className="flex-1">
            <Button onPress={handleSubmit} accessibilityLabel="Valider l'heure">
              <Text>Valider</Text>
            </Button>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

/**
 * One wheel column — hours or minutes. Snap-scroll ScrollView with the
 * selected row centered via top + bottom padding equal to
 * `VISIBLE_ROWS_AROUND_CENTER * ROW_HEIGHT`. A bordered overlay marks the
 * selection band; the selected value is also rendered bold so the user
 * gets dual confirmation (band + weight).
 */
function WheelColumn({
  values,
  selected,
  onChange,
  accessibilityLabel,
}: {
  values: readonly number[];
  selected: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
}): React.ReactElement {
  const scrollRef = React.useRef<ScrollView | null>(null);

  // Restore scroll position when `selected` changes externally (initial seed
  // or parent re-seed via prop change).
  React.useEffect(() => {
    const index = values.indexOf(selected);
    if (index < 0) return;
    // Slight delay so the ScrollView has measured itself; mirrors the same
    // pattern used in upstream wheel pickers.
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: index * ROW_HEIGHT,
        animated: false,
      });
    }, 16);
    return () => clearTimeout(t);
  }, [selected, values]);

  const handleMomentumScrollEnd = (offsetY: number) => {
    const rawIndex = Math.round(offsetY / ROW_HEIGHT);
    const clamped = Math.max(0, Math.min(values.length - 1, rawIndex));
    const next = values[clamped];
    if (next !== selected) onChange(next);
  };

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      className="overflow-hidden rounded-xl"
      style={{ width: 96 }}
    >
      {/* Selection band overlay — 1px borders top + bottom at the vertical
       *  center. Non-interactive so it doesn't eat scroll gestures. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: VISIBLE_ROWS_AROUND_CENTER * ROW_HEIGHT,
          left: 0,
          right: 0,
          height: ROW_HEIGHT,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: "#1B7A3D",
          zIndex: 1,
        }}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW_HEIGHT}
        decelerationRate="fast"
        bounces={false}
        contentContainerStyle={{
          paddingVertical: VISIBLE_ROWS_AROUND_CENTER * ROW_HEIGHT,
        }}
        onMomentumScrollEnd={(e) =>
          handleMomentumScrollEnd(e.nativeEvent.contentOffset.y)
        }
      >
        {values.map((v) => {
          const isSelected = v === selected;
          return (
            <Pressable
              key={v}
              accessibilityRole="button"
              accessibilityLabel={String(v).padStart(2, "0")}
              onPress={() => {
                const index = values.indexOf(v);
                if (index < 0) return;
                scrollRef.current?.scrollTo({
                  y: index * ROW_HEIGHT,
                  animated: true,
                });
                onChange(v);
              }}
              style={{
                height: ROW_HEIGHT,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                className={
                  isSelected
                    ? "text-foreground text-xl font-bold"
                    : "text-muted-foreground text-lg"
                }
              >
                {String(v).padStart(2, "0")}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
