/**
 * FEATURE A (#closed-resto UX) — pure decision modules for the closed-restaurant
 * bottom sheet, written BEFORE the implementation (TDD red). Node env, no DOM.
 *
 * Two pure cores, deterministic on an INJECTED `nowMs` (never the real
 * wall-clock, which would make the suite flaky):
 *  - `clientIsOpenNow(windows, nowMs)` — the front mirror of the backend
 *    `isWithinServiceHours` (Europe/Paris), so the client interval / stale-tab
 *    re-evaluation does not depend on a server round-trip.
 *  - `decideNextOpening(windows, nowMs)` — the NEXT window-start strictly after
 *    `now`, scanning forward up to 7 days (later today / tomorrow / later this
 *    week / wrap to next week / no windows → null).
 *  - `formatNextOpeningLabel(decision, nowMs)` — the FR réouverture copy.
 */
import { describe, expect, it } from "vitest";
import type { NextOpening, ServiceWindow } from "./decide-next-opening";
import {
  clientIsOpenNow,
  decideNextOpening,
  formatNextOpeningLabel,
} from "./decide-next-opening";

/** Assert a decision is non-null and return it narrowed (avoids `!`, lint-clean). */
function expectOpening(res: NextOpening | null): NextOpening {
  expect(res).not.toBeNull();
  if (res === null) throw new Error("expected a non-null NextOpening");
  return res;
}

// --- Europe/Paris fixed reference instants (UTC), pinned across DST -----------
// Wed 2026-07-15 (CEST, UTC+2): 10:00 UTC = 12:00 Paris, day 3 (Wed), min 720.
const WED_NOON = Date.parse("2026-07-15T10:00:00Z");
// Wed 2026-01-14 (CET, UTC+1): 11:00 UTC = 12:00 Paris, day 3 (Wed), min 720.
const WED_NOON_WINTER = Date.parse("2026-01-14T11:00:00Z");

// Buns & Bao Wednesday: 11h30–14h30 (690–870) + 18h30–22h30 (1110–1350).
const wedLunch: ServiceWindow = {
  dayOfWeek: 3,
  startMinute: 690,
  endMinute: 870,
};
const wedDinner: ServiceWindow = {
  dayOfWeek: 3,
  startMinute: 1110,
  endMinute: 1350,
};

describe("clientIsOpenNow — front mirror of backend isWithinServiceHours", () => {
  const windows = [wedLunch, wedDinner];

  it("OPEN inside a window (summer CEST)", () => {
    expect(clientIsOpenNow(windows, WED_NOON)).toBe(true);
  });
  it("OPEN inside a window (winter CET — same local time, different UTC)", () => {
    expect(clientIsOpenNow(windows, WED_NOON_WINTER)).toBe(true);
  });
  it("CLOSED in the afternoon gap between two windows", () => {
    // 15:00 Paris Wed (900) is between 870 and 1110.
    expect(clientIsOpenNow(windows, Date.parse("2026-07-15T13:00:00Z"))).toBe(
      false,
    );
  });
  it("start INCLUSIVE / end EXCLUSIVE at the boundaries", () => {
    // 11:30 Paris (690) ⇒ open; 14:30 Paris (870) ⇒ closed.
    expect(clientIsOpenNow(windows, Date.parse("2026-07-15T09:30:00Z"))).toBe(
      true,
    );
    expect(clientIsOpenNow(windows, Date.parse("2026-07-15T12:30:00Z"))).toBe(
      false,
    );
  });
  it("CLOSED with NO windows", () => {
    expect(clientIsOpenNow([], WED_NOON)).toBe(false);
  });
});

describe("decideNextOpening — next window-start strictly after now", () => {
  it("returns null when there are NO windows at all", () => {
    expect(decideNextOpening([], WED_NOON)).toBeNull();
  });

  it("later TODAY — closed in the afternoon gap, dinner opens later same day", () => {
    // 15:00 Paris Wed (900) — next start is wedDinner 18:30 (1110), same day.
    const at = Date.parse("2026-07-15T13:00:00Z");
    const res = expectOpening(decideNextOpening([wedLunch, wedDinner], at));
    // Resolve the ms to Paris parts to assert it points at Wed 18:30.
    expect(clientIsOpenNow([wedDinner], res.ms)).toBe(true);
  });

  it("does NOT return the CURRENTLY-open window start (strictly after now)", () => {
    // 12:00 Paris Wed (720) is INSIDE wedLunch; next start must be wedDinner.
    const res = expectOpening(
      decideNextOpening([wedLunch, wedDinner], WED_NOON),
    );
    // 18:30 same day, NOT the 11:30 lunch start that already passed.
    expect(clientIsOpenNow([wedDinner], res.ms)).toBe(true);
    expect(clientIsOpenNow([wedLunch], res.ms)).toBe(false);
  });

  it("TOMORROW — closed Wed evening after last window, opens Thu", () => {
    const thuLunch: ServiceWindow = {
      dayOfWeek: 4,
      startMinute: 690,
      endMinute: 870,
    };
    // 23:00 Paris Wed (1380) — past wedDinner end; next is Thu 11:30.
    const at = Date.parse("2026-07-15T21:00:00Z");
    const res = expectOpening(
      decideNextOpening([wedLunch, wedDinner, thuLunch], at),
    );
    expect(clientIsOpenNow([thuLunch], res.ms)).toBe(true);
  });

  it("LATER THIS WEEK — closed Wed, only a Friday window exists", () => {
    const friLunch: ServiceWindow = {
      dayOfWeek: 5,
      startMinute: 690,
      endMinute: 870,
    };
    const res = expectOpening(decideNextOpening([friLunch], WED_NOON));
    expect(clientIsOpenNow([friLunch], res.ms)).toBe(true);
  });

  it("WRAP to next week — only a Monday window, today is Wednesday", () => {
    const monLunch: ServiceWindow = {
      dayOfWeek: 1,
      startMinute: 690,
      endMinute: 870,
    };
    const res = expectOpening(decideNextOpening([monLunch], WED_NOON));
    // Lands on a Monday, 11:30, in the NEXT week.
    expect(clientIsOpenNow([monLunch], res.ms)).toBe(true);
    expect(res.ms).toBeGreaterThan(WED_NOON);
  });

  it("only a Tuesday-dinner window, today is Wed evening → wraps to next Tuesday", () => {
    const tueDinner: ServiceWindow = {
      dayOfWeek: 2,
      startMinute: 1110,
      endMinute: 1350,
    };
    const at = Date.parse("2026-07-15T21:00:00Z"); // Wed 23:00 Paris
    const res = expectOpening(decideNextOpening([tueDinner], at));
    expect(clientIsOpenNow([tueDinner], res.ms)).toBe(true);
  });
});

describe("formatNextOpeningLabel — FR réouverture copy", () => {
  it("today → « Réouverture aujourd'hui à HHhMM »", () => {
    // Closed at 15:00 Wed; dinner reopens 18:30 same day.
    const at = Date.parse("2026-07-15T13:00:00Z");
    const res = decideNextOpening([wedDinner], at);
    expect(formatNextOpeningLabel(res, at)).toBe(
      "Réouverture aujourd'hui à 18h30",
    );
  });

  it("tomorrow → « Réouverture demain à HHhMM »", () => {
    const thuLunch: ServiceWindow = {
      dayOfWeek: 4,
      startMinute: 690,
      endMinute: 870,
    };
    const at = Date.parse("2026-07-15T21:00:00Z"); // Wed 23:00 Paris
    const res = decideNextOpening([thuLunch], at);
    expect(formatNextOpeningLabel(res, at)).toBe("Réouverture demain à 11h30");
  });

  it("later this week → « Réouverture <jour> à HHhMM »", () => {
    const monLunch: ServiceWindow = {
      dayOfWeek: 1,
      startMinute: 690,
      endMinute: 870,
    };
    const res = decideNextOpening([monLunch], WED_NOON);
    expect(formatNextOpeningLabel(res, WED_NOON)).toBe(
      "Réouverture lundi à 11h30",
    );
  });

  it("on-the-hour minute renders « 18h00 » (zero-padded minutes)", () => {
    const eveningOnHour: ServiceWindow = {
      dayOfWeek: 3,
      startMinute: 1080, // 18:00
      endMinute: 1350,
    };
    const at = Date.parse("2026-07-15T13:00:00Z"); // Wed 15:00 Paris
    const res = decideNextOpening([eveningOnHour], at);
    expect(formatNextOpeningLabel(res, at)).toBe(
      "Réouverture aujourd'hui à 18h00",
    );
  });

  it("same-weekday wrap (only-Wed hours, now Wed night) → « mercredi », NOT « aujourd'hui »", () => {
    // Only a Wednesday lunch window; it's already Wed 23:00, so the next start
    // is next Wednesday — a full week away. The calendar-day gap (7) must read
    // « mercredi », not be fooled by the weekday matching today.
    const at = Date.parse("2026-07-15T21:00:00Z"); // Wed 23:00 Paris
    const res = decideNextOpening([wedLunch], at);
    expect(formatNextOpeningLabel(res, at)).toBe(
      "Réouverture mercredi à 11h30",
    );
  });

  it("null decision → « Horaires non communiqués » (no time)", () => {
    expect(formatNextOpeningLabel(null, WED_NOON)).toBe(
      "Horaires non communiqués",
    );
  });
});
