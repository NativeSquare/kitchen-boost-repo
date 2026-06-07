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
 * compound value to the parent via `onConfirm(totalMinutes)` and dismisses
 * the sheet. « Annuler » closes without committing.
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
  /** Called when the user taps « Valider ». Passes the composed minute count
   *  (HH * 60 + MM). The parent dismisses the sheet inside this callback if
   *  it wants instant feedback (the sheet dismisses itself anyway). */
  onConfirm: (totalMinutes: number) => void;
};

export function TimeWheelPickerSheet({
  sheetRef,
  title,
  initialMinutes,
  onConfirm,
}: TimeWheelPickerSheetProps) {
  const seed = React.useMemo(
    () => splitWheelMinutes(initialMinutes),
    [initialMinutes],
  );

  // Local draft — lives between `present()` and `onConfirm` / dismiss. Re-
  // seeded when the parent passes a new `initialMinutes` (e.g. user opens
  // the picker for a different slot).
  const [hour, setHour] = React.useState<number>(seed.hour);
  const [minute, setMinute] = React.useState<number>(seed.minute);

  // Re-seed on prop change so the wheel never shows stale state when the
  // parent re-opens for another field.
  React.useEffect(() => {
    setHour(seed.hour);
    setMinute(seed.minute);
  }, [seed.hour, seed.minute]);

  const handleConfirm = () => {
    const total = composeWheelMinutes(hour, minute);
    if (!Number.isNaN(total)) onConfirm(total);
    sheetRef.current?.dismiss();
  };

  const handleCancel = () => {
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
            onChange={setHour}
          />
          <View className="items-center justify-center">
            <Text className="text-foreground text-xl font-semibold">:</Text>
          </View>
          <WheelColumn
            accessibilityLabel="Minutes"
            values={WHEEL_MINUTES}
            selected={minute}
            onChange={setMinute}
          />
        </View>

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
            <Button
              onPress={handleConfirm}
              accessibilityLabel="Valider l'heure"
            >
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
