import { describe, expect, it } from "vitest";
import {
  WHEEL_HOURS,
  WHEEL_MINUTE_STEP,
  WHEEL_MINUTES,
  composeWheelMinutes,
  snapMinuteToStep,
  splitWheelMinutes,
} from "./decide-time-wheel";

/**
 * #409 / KBO-DIS4 — `decide-time-wheel` helpers pinned as pure functions.
 * The wheel picker replaces the `<Input>` HH:MM fields that ate keystrokes
 * (the controlled input forced state back to canonical on every render of
 * a partial parse).
 *
 * Scenarios pinned at the decision layer:
 *
 *  - Column shapes (24 hours, 12 step-5 minutes) — guard rails against a
 *    future refactor accidentally bumping the step from 5 → 1.
 *  - `snapMinuteToStep` truth table — legacy minutes (12:13) seed cleanly,
 *    no silent hour rollover from 56–59.
 *  - `composeWheelMinutes` / `splitWheelMinutes` round-trip on canonical
 *    values + the 24:00 (1440) seam (the validator accepts 1440 as the
 *    EXCLUSIVE upper bound but the wheel renders it as 23:55).
 */

describe("#409 WHEEL_HOURS — 24-hour column (00 → 23)", () => {
  it("contient 24 valeurs de 0 à 23", () => {
    expect(WHEEL_HOURS).toHaveLength(24);
    expect(WHEEL_HOURS[0]).toBe(0);
    expect(WHEEL_HOURS[23]).toBe(23);
  });
});

describe("#409 WHEEL_MINUTES — minute column step 5", () => {
  it("WHEEL_MINUTE_STEP = 5 (granularité resto FR)", () => {
    expect(WHEEL_MINUTE_STEP).toBe(5);
  });

  it("contient 12 valeurs 00, 05, 10, ..., 55", () => {
    expect(WHEEL_MINUTES).toHaveLength(12);
    expect(WHEEL_MINUTES[0]).toBe(0);
    expect(WHEEL_MINUTES[11]).toBe(55);
  });
});

describe("#409 snapMinuteToStep — round-to-nearest", () => {
  it("0 → 0 (déjà sur le pas)", () => {
    expect(snapMinuteToStep(0)).toBe(0);
  });

  it("2 → 0 (< mid-step, round down)", () => {
    expect(snapMinuteToStep(2)).toBe(0);
  });

  it("3 → 5 (>= mid-step, round up)", () => {
    expect(snapMinuteToStep(3)).toBe(5);
  });

  it("12 → 10 (legacy KB Admin 12:13 → wheel 10)", () => {
    expect(snapMinuteToStep(12)).toBe(10);
  });

  it("13 → 15 (round up)", () => {
    expect(snapMinuteToStep(13)).toBe(15);
  });

  it("57 → 55 (clamp au dernier pas, JAMAIS round vers 60)", () => {
    // Critical: rounding 57 → 60 silently shifts to the next hour without
    // the user's consent. Clamp to 55 instead.
    expect(snapMinuteToStep(57)).toBe(55);
    expect(snapMinuteToStep(58)).toBe(55);
    expect(snapMinuteToStep(59)).toBe(55);
  });

  it("valeurs négatives ou NaN → 0 (defensive)", () => {
    expect(snapMinuteToStep(-1)).toBe(0);
    expect(snapMinuteToStep(Number.NaN)).toBe(0);
  });
});

describe("#409 composeWheelMinutes — (hour, minute) → totalMinutes", () => {
  it("12, 30 → 750", () => {
    expect(composeWheelMinutes(12, 30)).toBe(750);
  });

  it("0, 0 → 0", () => {
    expect(composeWheelMinutes(0, 0)).toBe(0);
  });

  it("23, 55 → 1435", () => {
    expect(composeWheelMinutes(23, 55)).toBe(1435);
  });

  it("rejette hour hors [0..23]", () => {
    expect(composeWheelMinutes(24, 0)).toBeNaN();
    expect(composeWheelMinutes(-1, 0)).toBeNaN();
  });

  it("rejette minute hors [0..59]", () => {
    expect(composeWheelMinutes(12, 60)).toBeNaN();
    expect(composeWheelMinutes(12, -1)).toBeNaN();
  });
});

describe("#409 splitWheelMinutes — totalMinutes → (hour, minute) seedé pour la wheel", () => {
  it("0 → 0:00", () => {
    expect(splitWheelMinutes(0)).toEqual({ hour: 0, minute: 0 });
  });

  it("750 (12:30) → hour 12, minute 30", () => {
    expect(splitWheelMinutes(750)).toEqual({ hour: 12, minute: 30 });
  });

  it("1110 (18:30) → hour 18, minute 30", () => {
    expect(splitWheelMinutes(1110)).toEqual({ hour: 18, minute: 30 });
  });

  it("693 (11:33 legacy KB Admin) → hour 11, minute 35 (snap)", () => {
    expect(splitWheelMinutes(693)).toEqual({ hour: 11, minute: 35 });
  });

  it("1440 (24:00 EXCLUSIVE upper bound) → hour 23, minute 55 (closest renderable)", () => {
    // The validator accepts 1440; the wheel can't render hour=24, so we
    // render the closest valid pair. The user can re-pick if they really
    // wanted 24:00 → save still preserves the original int (we never
    // re-write the state from the wheel unless the user moves it).
    expect(splitWheelMinutes(1440)).toEqual({ hour: 23, minute: 55 });
  });

  it("valeurs négatives ou NaN → 0:00 (defensive)", () => {
    expect(splitWheelMinutes(-1)).toEqual({ hour: 0, minute: 0 });
    expect(splitWheelMinutes(Number.NaN)).toEqual({ hour: 0, minute: 0 });
  });
});

describe("#409 round-trip wheel ↔ totalMinutes", () => {
  it("round-trip exact sur les valeurs typiques resto FR", () => {
    for (const m of [0, 5, 60, 690, 750, 870, 1110, 1350, 1435]) {
      const split = splitWheelMinutes(m);
      const back = composeWheelMinutes(split.hour, split.minute);
      expect(back).toBe(m);
    }
  });
});
