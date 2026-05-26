import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_PER_WEEK,
  RATE_WINDOW_MS,
  countInWindow,
  withinRateLimit,
} from "./marketingRateLimit";

/**
 * 2.7-D — the PURE marketing rate limit, written BEFORE the module (TDD red).
 *
 * "3 push marketing / semaine / client GLOBAL (tous restos + cross-tenant
 * confondus)" — PRD 80 §6, NOT invented. The GLOBAL scope (across every tenant +
 * cross-tenant) is the caller's job: it passes the timestamps of ALL the
 * customer's prior CAMPAIGN sends regardless of tenant. This pure rule only
 * decides "given those timestamps + now, is one MORE marketing send allowed?".
 *
 * Window = a trailing 7 days (sliding). A send is "in window" iff its timestamp
 * is strictly after `now - 7d`. Allowed iff fewer than 3 are in window.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe("2.7-D rate limit — constants are the PRD values (3 / week)", () => {
  it("is 3 per week", () => {
    expect(RATE_LIMIT_PER_WEEK).toBe(3);
  });
  it("window is 7 days in ms", () => {
    expect(RATE_WINDOW_MS).toBe(7 * DAY);
  });
});

describe("2.7-D countInWindow — only sends within the trailing 7 days count", () => {
  it("counts sends strictly after now - 7d", () => {
    const sends = [NOW - 1 * DAY, NOW - 3 * DAY, NOW - 6 * DAY];
    expect(countInWindow(sends, NOW)).toBe(3);
  });

  it("excludes sends exactly 7 days old or older", () => {
    const sends = [NOW - 7 * DAY, NOW - 8 * DAY, NOW - 30 * DAY];
    expect(countInWindow(sends, NOW)).toBe(0);
  });

  it("ignores future-dated noise and empty history", () => {
    expect(countInWindow([], NOW)).toBe(0);
  });
});

describe("2.7-D withinRateLimit — 4th marketing send of the week is blocked", () => {
  it("allows the 1st, 2nd and 3rd send in the window", () => {
    expect(withinRateLimit([], NOW)).toBe(true);
    expect(withinRateLimit([NOW - 1 * DAY], NOW)).toBe(true);
    expect(withinRateLimit([NOW - 1 * DAY, NOW - 2 * DAY], NOW)).toBe(true);
  });

  it("blocks the 4th send when 3 are already in the window", () => {
    const three = [NOW - 1 * DAY, NOW - 2 * DAY, NOW - 3 * DAY];
    expect(withinRateLimit(three, NOW)).toBe(false);
  });

  it("re-allows once an old send ages out of the window", () => {
    // 2 recent + 1 that is 8 days old (out of window) ⇒ 2 in window ⇒ allowed.
    const sends = [NOW - 1 * DAY, NOW - 2 * DAY, NOW - 8 * DAY];
    expect(withinRateLimit(sends, NOW)).toBe(true);
  });
});
