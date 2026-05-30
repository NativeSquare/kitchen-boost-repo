/**
 * F-MONITORING — `formatPendingSince` (issue #184, parent EPIC #147).
 *
 * Pure helper that turns a `pendingSinceMs` instant + a reference `now` into
 * the human-readable "depuis X heures" copy promised by acceptance criterion
 * « `pendingSinceMs` formaté lisible via `date-fns` (ex. "depuis 4 heures") ».
 *
 * Kept as a pure function so vitest can pin its behaviour in the lean `node`
 * env (no jsdom). The route page (page.tsx) only assembles this output into
 * the table cell — the formatting itself is owned here.
 */
import { describe, expect, it } from "vitest";

import { formatPendingSince } from "./formatPendingSince";

const HOUR = 60 * 60 * 1000;

describe("formatPendingSince — F-MONITORING (#184)", () => {
  it("renders a « depuis X heures » string when the instant is hours old", () => {
    const now = 1_700_000_000_000;
    const since = now - 4 * HOUR;
    const out = formatPendingSince(since, now);
    // We assert the load-bearing word (« depuis ») + the French unit, not the
    // exact string, so a date-fns minor / locale tweak doesn't break the test
    // — but a missing "depuis" prefix or a swapped locale does.
    expect(out).toMatch(/^depuis /);
    expect(out).toMatch(/heure/);
  });

  it("renders a « depuis X jours » string for older instants (date-fns rolls over)", () => {
    const now = 1_700_000_000_000;
    const since = now - 72 * HOUR; // 3 days
    const out = formatPendingSince(since, now);
    expect(out).toMatch(/^depuis /);
    expect(out).toMatch(/jour/);
  });

  it("renders a fresh-but-still-positive duration for a very recent instant", () => {
    const now = 1_700_000_000_000;
    const since = now - 5 * 60 * 1000; // 5 min
    const out = formatPendingSince(since, now);
    expect(out).toMatch(/^depuis /);
    // Don't pin the unit too tightly (could be "minutes"); just check it's a
    // non-empty, non-"undefined" body.
    expect(out.length).toBeGreaterThan("depuis ".length);
  });
});
