/**
 * #409 — pure helpers for the JS-only wheel time picker that replaces the
 * `<Input>` HH:MM fields in the service-hours editor (KBO-DIS4 fix, terrain
 * 2026-06-07).
 *
 * Why a wheel + dedicated helpers
 * -------------------------------
 * The previous editor wired two controlled `<Input>` fields to
 * `timeStringToMinutes`. The parser rejects ALL partial inputs (regex
 * `/^(\d{1,2}):(\d{2})$/` requires the full shape) so a single keystroke
 * (« 1 » before « 12:30 » lands) returned `NaN` → no state update → on the
 * next render the Input was forced back to the canonical `minutesToTimeString`
 * of the unchanged state → the typed character disappeared instantly.
 *
 * Same pattern as the closure calendar pivot (commit `70252ba`) : drop the
 * native `DateTimePicker` (TurboModule, dev-build rebuild burden) AND ditch
 * the fragile typed-input path. A wheel picker built on two `FlatList`
 * columns is 100% JS, snaps to the chosen step, and can't generate a partial
 * value — the user only ever sees valid minutes.
 *
 * Module split convention
 * -----------------------
 * Same discipline as `decide-service-hours` (#409), `decide-closure-control`
 * (#407), `decide-pause-control` (#406): React / Expo / Convex stay OUT so
 * the math here is pinned by a fast deterministic vitest suite (node env,
 * no jsdom, no native mocks). The companion `<TimeWheelPickerSheet />` is the
 * thin React wrapper that consumes these helpers.
 */

/**
 * Granularity of the minute column. 5-min steps are enough for FR resto
 * service hours (typical openings : 11:00, 11:30, 12:00, ..., never
 * « 12:07 »). Smaller steps would inflate the FlatList without product gain.
 */
export const WHEEL_MINUTE_STEP = 5;

/** The 24 hours surfaced by the hour column (00 → 23). */
export const WHEEL_HOURS: readonly number[] = Array.from(
  { length: 24 },
  (_, i) => i,
);

/**
 * The minute values surfaced by the minute column at the configured step.
 * 5-min step → [0, 5, 10, ..., 55].
 */
export const WHEEL_MINUTES: readonly number[] = Array.from(
  { length: 60 / WHEEL_MINUTE_STEP },
  (_, i) => i * WHEEL_MINUTE_STEP,
);

/**
 * Snap an arbitrary minute-of-hour to the nearest valid step value.
 * Used when seeding the wheel from an existing window whose minutes don't
 * line up with the step (legacy data, KB Admin saved 12:13). PURE.
 *
 *  - Below mid-step → round down.
 *  - At or above mid-step → round up.
 *  - Above the last step value → clamp to the last step value (we NEVER want
 *    to round up to 60 because that would silently shift to the next hour
 *    column without the user's consent).
 */
export function snapMinuteToStep(
  minute: number,
  step: number = WHEEL_MINUTE_STEP,
): number {
  if (!Number.isFinite(minute) || minute <= 0) return 0;
  const lastStep = Math.floor(59 / step) * step;
  if (minute >= lastStep) return lastStep;
  const lower = Math.floor(minute / step) * step;
  const upper = lower + step;
  const lowerDelta = minute - lower;
  const upperDelta = upper - minute;
  return upperDelta < lowerDelta ? upper : lower;
}

/**
 * Compose a wheel selection (hour, minute) back into the int-minute model
 * the schema speaks. PURE. Returns NaN for an invalid pair so the caller
 * can fall back to the seed (shouldn't fire — the wheel only proposes valid
 * indices).
 */
export function composeWheelMinutes(hour: number, minute: number): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return Number.NaN;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return Number.NaN;
  return hour * 60 + minute;
}

/**
 * Split a stored `startMinute` / `endMinute` int back into the (hour, minute)
 * pair the wheel surfaces. `1440` (24:00 exclusive upper bound) cannot be
 * represented as an (hour ∈ [0..23], minute ∈ [0..55]) tuple — we render
 * `23:55` instead and surface a single-shot `+ 5 min = 24:00` would shift
 * the column past its bound. We pin this seam in the test suite so it
 * doesn't drift. PURE.
 */
export function splitWheelMinutes(totalMinutes: number): {
  hour: number;
  minute: number;
} {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
    return { hour: 0, minute: 0 };
  }
  if (totalMinutes >= 24 * 60) {
    // 24:00 → render as 23:55 in the wheel (the closest representable step).
    return { hour: 23, minute: snapMinuteToStep(55) };
  }
  const hour = Math.floor(totalMinutes / 60);
  const minute = snapMinuteToStep(totalMinutes % 60);
  return { hour, minute };
}
