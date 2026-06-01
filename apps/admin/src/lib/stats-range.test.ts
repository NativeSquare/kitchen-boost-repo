/**
 * F-STATS-DASHBOARD (#253) — `stats-range` util tests.
 *
 * The util is a pure TS module that defines the canonical "stats range" V1
 * domain : the 3 allowed window sizes (7 / 30 / 90 days), the default
 * (30 days), the human-readable label per option, and the runtime validator
 * the RangePicker uses to defend against an unexpected URL param.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RANGE_DAYS,
  RANGE_OPTIONS,
  isRangeDays,
  rangeLabel,
  type RangeDays,
} from "./stats-range";

describe("stats-range — F-STATS-DASHBOARD (#253) range V1 contract", () => {
  it("defines exactly the 3 V1 options 7 / 30 / 90 days (PRD 70 §4.10)", () => {
    expect(RANGE_OPTIONS).toEqual([7, 30, 90]);
  });

  it("default range is 30 days (issue body)", () => {
    expect(DEFAULT_RANGE_DAYS).toBe(30);
  });

  it("isRangeDays accepts 7 / 30 / 90 and rejects anything else", () => {
    expect(isRangeDays(7)).toBe(true);
    expect(isRangeDays(30)).toBe(true);
    expect(isRangeDays(90)).toBe(true);
    expect(isRangeDays(14)).toBe(false);
    expect(isRangeDays(0)).toBe(false);
    expect(isRangeDays(-7)).toBe(false);
    expect(isRangeDays(NaN)).toBe(false);
    expect(isRangeDays("30")).toBe(false);
    expect(isRangeDays(null)).toBe(false);
    expect(isRangeDays(undefined)).toBe(false);
  });

  it("rangeLabel returns the FR human label for each option", () => {
    const opts: RangeDays[] = [7, 30, 90];
    for (const o of opts) {
      const label = rangeLabel(o);
      expect(label).toMatch(new RegExp(String(o)));
      // FR : "jours" must appear in the label so the picker copy is obvious.
      expect(label).toMatch(/jours/i);
    }
  });
});
