/**
 * #410 — `decideQuickStats` truth table (PRD 20 §9). Pure decision over the
 * raw backend output of `quickStats` ({ caToday, ordersToday, caWeek,
 * caPrevWeek }, cents) → 4 KPI cards + a `comparison` verdict.
 *
 * Same split convention as `decidePauseControl` (#406), `decideClosureControl`
 * (#407) and `decideForceUpdate` (#394) — React, Convex, Expo stay OUT so the
 * truth table is pinned by a fast deterministic vitest suite (node env).
 *
 * Three comparison shapes (PRD 20 §9 « delta absolu + pourcentage ») :
 *  - `up`   — caWeek > caPrevWeek (positive trend, vert)
 *  - `down` — caWeek < caPrevWeek (negative trend, rouge)
 *  - `flat` — caWeek === caPrevWeek (gris)
 *
 * Plus the edge `prev = 0` cases:
 *  - prev = 0, curr > 0 → kind: `noBaseline`, `direction: "up"` (« +∞ », pas
 *    de pourcentage affichable). On expose juste `delta` (= caWeek) et un
 *    `direction: "up"` ;
 *  - prev = 0, curr = 0 → `kind: "flat"`, `delta: 0`, `percent: 0`.
 *
 * `loading` (Convex sub still in flight) → `kind: "loading"` — render
 * skeleton cards so we don't flash « 0 € » before the data lands.
 */
import { describe, expect, it } from "vitest";
import { decideQuickStats } from "./decide-quick-stats";

describe("#410 decideQuickStats — loading sentinel", () => {
  it("`stats === undefined` (Convex in flight) → kind: loading", () => {
    expect(decideQuickStats(undefined)).toEqual({ kind: "loading" });
  });
});

describe("#410 decideQuickStats — comparison vs S-1", () => {
  it("up: caWeek > caPrevWeek → positive % + delta + direction up", () => {
    // prev 100€ → curr 150€ → +50% (+50€)
    const verdict = decideQuickStats({
      caToday: 0,
      ordersToday: 0,
      caWeek: 15_000,
      caPrevWeek: 10_000,
    });
    expect(verdict).toEqual({
      kind: "ready",
      caToday: 0,
      ordersToday: 0,
      caWeek: 15_000,
      caPrevWeek: 10_000,
      comparison: {
        kind: "comparable",
        direction: "up",
        delta: 5_000,
        percent: 50,
      },
    });
  });

  it("down: caWeek < caPrevWeek → negative % + negative delta + direction down", () => {
    // prev 200€ → curr 100€ → -50% (-100€)
    const verdict = decideQuickStats({
      caToday: 0,
      ordersToday: 0,
      caWeek: 10_000,
      caPrevWeek: 20_000,
    });
    expect(verdict).toEqual({
      kind: "ready",
      caToday: 0,
      ordersToday: 0,
      caWeek: 10_000,
      caPrevWeek: 20_000,
      comparison: {
        kind: "comparable",
        direction: "down",
        delta: -10_000,
        percent: -50,
      },
    });
  });

  it("flat: caWeek === caPrevWeek (both > 0) → 0% / 0 delta / direction flat", () => {
    const verdict = decideQuickStats({
      caToday: 0,
      ordersToday: 0,
      caWeek: 10_000,
      caPrevWeek: 10_000,
    });
    expect(verdict.kind).toBe("ready");
    if (verdict.kind !== "ready") return;
    expect(verdict.comparison).toEqual({
      kind: "comparable",
      direction: "flat",
      delta: 0,
      percent: 0,
    });
  });

  it("flat: both 0 → kind comparable / direction flat / delta+percent 0 (no ZeroDivisionError)", () => {
    const verdict = decideQuickStats({
      caToday: 0,
      ordersToday: 0,
      caWeek: 0,
      caPrevWeek: 0,
    });
    expect(verdict.kind).toBe("ready");
    if (verdict.kind !== "ready") return;
    expect(verdict.comparison).toEqual({
      kind: "comparable",
      direction: "flat",
      delta: 0,
      percent: 0,
    });
  });

  it("noBaseline: prev=0 / curr>0 → no percent (« nouveau resto / première semaine »)", () => {
    const verdict = decideQuickStats({
      caToday: 0,
      ordersToday: 0,
      caWeek: 4_200,
      caPrevWeek: 0,
    });
    expect(verdict.kind).toBe("ready");
    if (verdict.kind !== "ready") return;
    expect(verdict.comparison).toEqual({
      kind: "noBaseline",
      direction: "up",
      delta: 4_200,
    });
  });

  it("percent is rounded to the nearest integer", () => {
    // 100 → 133 → +33% (Math.round(33.33))
    const verdict = decideQuickStats({
      caToday: 0,
      ordersToday: 0,
      caWeek: 13_300,
      caPrevWeek: 10_000,
    });
    expect(verdict.kind).toBe("ready");
    if (verdict.kind !== "ready") return;
    if (verdict.comparison.kind !== "comparable") {
      throw new Error("expected comparable comparison");
    }
    expect(verdict.comparison.percent).toBe(33);
    expect(verdict.comparison.delta).toBe(3_300);
    expect(verdict.comparison.direction).toBe("up");
  });

  it("propagates caToday / ordersToday verbatim (no derivation, just forwarded)", () => {
    const verdict = decideQuickStats({
      caToday: 7_777,
      ordersToday: 3,
      caWeek: 0,
      caPrevWeek: 0,
    });
    expect(verdict.kind).toBe("ready");
    if (verdict.kind !== "ready") return;
    expect(verdict.caToday).toBe(7_777);
    expect(verdict.ordersToday).toBe(3);
  });
});
