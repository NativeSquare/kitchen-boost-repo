/**
 * F-COMMANDES-LIVE-TABLE (#227) — `formatOrderDate`, the timestamp formatter
 * used by the orders table.
 *
 * `orders.createdAt` is stored as a UTC epoch in MILLISECONDS (Convex
 * convention — cf. `packages/backend/convex/table/orders.ts` and the
 * `_creationTime` shape every Convex doc inherits). The gérant reads dates in
 * the French locale on a Europe/Paris machine, so this helper renders a
 * compact « DD/MM/YYYY HH:mm » shape rather than a localised long string. The
 * compact shape keeps the column narrow enough that the four-column table
 * stays glanceable on a 1280px laptop without horizontal scroll.
 *
 * Why a dedicated helper (not inline `toLocaleString` / `Intl.DateTimeFormat`):
 *   - Tests stay deterministic (a single function to pin) regardless of the
 *     Node version's ICU build (which can change narrow-NBSP / separator
 *     glyphs across releases).
 *   - A future surface (order detail modal, CSV export of `createdAt`) reuses
 *     the same string so a date never reads two different ways in the admin.
 *   - Centralises the « what about NaN / non-integer epochs » contract — the
 *     backend store always writes `Date.now()`, so the helper treats anything
 *     else as a contract violation (loud throw, matches `formatPriceCentimes`
 *     shape).
 *
 * Locale: `fr-FR`. Format: `DD/MM/YYYY HH:mm` (no seconds — the gérant cares
 * about minute granularity for « la commande est arrivée à 12h31 », not
 * second-level precision; matches the issue body « formate locale FR »).
 */
import { describe, expect, it } from "vitest";

import { formatOrderDate } from "./format-order-date";

describe("formatOrderDate — F-COMMANDES-LIVE-TABLE (#227)", () => {
  it("formats an epoch ms as DD/MM/YYYY HH:mm in French locale", () => {
    // 2026-05-29 14:07:00 UTC — pick a fixed point so the shape is asserted
    // explicitly. The string is built from UTC components so it doesn't drift
    // with the host machine's timezone (admin gérants run the app under
    // Europe/Paris in prod; tests run under UTC in CI).
    const epochMs = Date.UTC(2026, 4, 29, 14, 7, 0); // month is 0-indexed
    const formatted = formatOrderDate(epochMs);
    // We assert the digits + separators rather than the exact whitespace
    // glyph (ICU narrow-NBSP varies across Node versions) — same pragmatic
    // shape as `format-price.test.ts`.
    expect(formatted).toMatch(/29\/05\/2026/);
    // The hour part renders the SAME UTC components (helper is UTC-pinned for
    // determinism) — see source docstring for the « why not Europe/Paris »
    // rationale.
    expect(formatted).toMatch(/14:07/);
  });

  it("pads single-digit days / months / hours / minutes with a leading zero", () => {
    // 2026-01-02 03:04:00 UTC — every component needs the `0` pad to keep the
    // table column width stable across rows (a « 2/1/2026 3:4 » row would
    // shift the column visually).
    const epochMs = Date.UTC(2026, 0, 2, 3, 4, 0);
    const formatted = formatOrderDate(epochMs);
    expect(formatted).toMatch(/02\/01\/2026/);
    expect(formatted).toMatch(/03:04/);
  });

  it("throws on NaN / non-finite input (backend always writes a real epoch)", () => {
    // The backend store always writes `Date.now()` (a finite ms epoch); a NaN
    // here is a contract violation, not a user-facing case to format. Loud
    // failure prevents silent « NaN/NaN/NaN NaN:NaN » rendering in the table.
    expect(() => formatOrderDate(Number.NaN)).toThrow();
    expect(() => formatOrderDate(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatOrderDate(Number.NEGATIVE_INFINITY)).toThrow();
  });
});
