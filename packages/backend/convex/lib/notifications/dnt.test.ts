import { describe, expect, it } from "vitest";
import {
  DEFAULT_DNT_END_HOUR,
  DEFAULT_DNT_START_HOUR,
  inDoNotTrackWindow,
  nextSendableTime,
  parisHour,
} from "./dnt";

/**
 * 2.7-D — the PURE Do-Not-Track window, written BEFORE the module (TDD red).
 *
 * DNT marketing window = 22h-8h Europe/Paris (PRD 80 §6 / notifications CONTEXT
 * "DNT"), configurable by KB root (start/end hour are parameters; the PRD default
 * is 22 → 8). NEVER applied to transactional (the engine path never calls this).
 * A campaign launched inside the window is QUEUED and sent at the window end
 * (08:00 Paris) the same/next morning (PRD 80 §6 "envoi à 8h le lendemain").
 *
 * Timezone is resolved deterministically through `Intl` (Europe/Paris, DST-aware)
 * so the rule is correct in both CET (UTC+1) and CEST (UTC+2). Tests pin absolute
 * UTC instants and assert the Paris-local hour they fall in.
 */

// 2026-01-15 (winter, CET = UTC+1). 21:30 UTC = 22:30 Paris (inside DNT).
const WINTER_2230_PARIS = Date.UTC(2026, 0, 15, 21, 30);
// 2026-01-15 12:00 UTC = 13:00 Paris (daytime, outside DNT).
const WINTER_1300_PARIS = Date.UTC(2026, 0, 15, 12, 0);
// 2026-07-15 (summer, CEST = UTC+2). 23:00 Paris = 21:00 UTC (inside DNT).
const SUMMER_2300_PARIS = Date.UTC(2026, 6, 15, 21, 0);
// 2026-07-15 06:00 Paris = 04:00 UTC (early morning, inside DNT before 8h).
const SUMMER_0600_PARIS = Date.UTC(2026, 6, 15, 4, 0);

describe("2.7-D DNT defaults are the PRD window (22h-8h)", () => {
  it("default start is 22, default end is 8", () => {
    expect(DEFAULT_DNT_START_HOUR).toBe(22);
    expect(DEFAULT_DNT_END_HOUR).toBe(8);
  });
});

describe("2.7-D parisHour resolves the Paris-local hour (DST-aware)", () => {
  it("winter (CET, UTC+1): 21:30 UTC → 22h Paris", () => {
    expect(parisHour(WINTER_2230_PARIS)).toBe(22);
  });
  it("summer (CEST, UTC+2): 21:00 UTC → 23h Paris", () => {
    expect(parisHour(SUMMER_2300_PARIS)).toBe(23);
  });
});

describe("2.7-D inDoNotTrackWindow — 22h-8h Europe/Paris", () => {
  it("22:30 Paris is inside the window", () => {
    expect(inDoNotTrackWindow(WINTER_2230_PARIS)).toBe(true);
  });
  it("06:00 Paris is inside the window (before 8h)", () => {
    expect(inDoNotTrackWindow(SUMMER_0600_PARIS)).toBe(true);
  });
  it("13:00 Paris is outside the window (daytime)", () => {
    expect(inDoNotTrackWindow(WINTER_1300_PARIS)).toBe(false);
  });
  it("23:00 Paris (summer) is inside the window", () => {
    expect(inDoNotTrackWindow(SUMMER_2300_PARIS)).toBe(true);
  });
});

describe("2.7-D nextSendableTime — queued launch goes out at 08:00 Paris", () => {
  it("is the instant itself when already outside the window", () => {
    expect(nextSendableTime(WINTER_1300_PARIS)).toBe(WINTER_1300_PARIS);
  });

  it("a 22:30 launch is shifted to the next 08:00 Paris (the following morning)", () => {
    const out = nextSendableTime(WINTER_2230_PARIS);
    // It is strictly later, and lands at Paris-local hour 8.
    expect(out).toBeGreaterThan(WINTER_2230_PARIS);
    expect(parisHour(out)).toBe(8);
  });

  it("an early-morning 06:00 launch is shifted to 08:00 Paris the SAME morning", () => {
    const out = nextSendableTime(SUMMER_0600_PARIS);
    expect(out).toBeGreaterThan(SUMMER_0600_PARIS);
    expect(parisHour(out)).toBe(8);
    // Same calendar morning ⇒ less than 8 hours later.
    expect(out - SUMMER_0600_PARIS).toBeLessThan(8 * 60 * 60 * 1000);
  });
});
