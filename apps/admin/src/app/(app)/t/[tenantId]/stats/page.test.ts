/**
 * F-STATS-DASHBOARD [3/8] (#253) — Stats route `/t/[tenantId]/stats/page.tsx`
 * wiring contract. Same source-file pinning pattern as
 * `../page.test.ts` and `../campagnes/page.test.ts`.
 *
 * The page is the thin wiring layer between the Convex hook and the pure
 * `StatsView`:
 *   - reads `api.lib.stats.rangeAggregates.rangeAggregates` via
 *     `useTenantQuery` (F-SHELL-05 #183, ADR 0014 §4) — never raw `useQuery`.
 *   - owns the `range` state via `useState` (default 30, issue body).
 *   - delegates rendering to `StatsView` (pure shell).
 *
 * Cross-tenant fuzz is owned by the backend wrapper (`tenantQuery` on
 * `rangeAggregates`, pinned by
 * `packages/backend/convex/lib/stats/rangeAggregates.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("stats/page.tsx — F-STATS-DASHBOARD [3/8] (#253) wiring contract", () => {
  it("binds `api.lib.stats.rangeAggregates.rangeAggregates` via `useTenantQuery`", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.stats\.rangeAggregates\.rangeAggregates[^)]*\)/,
    );
  });

  it("binds `api.lib.stats.revenuePerDay.revenuePerDay` via `useTenantQuery` (#257)", () => {
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.stats\.revenuePerDay\.revenuePerDay[^)]*\)/,
    );
  });

  it("does NOT use a raw `useQuery` (would bypass tenantId injection — ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("delegates rendering to `StatsView`", () => {
    expect(PAGE_SOURCE).toMatch(/StatsView/);
  });

  it('declares `"use client"` (page uses Convex hooks + useState)', () => {
    expect(PAGE_SOURCE).toMatch(/^"use client";/);
  });

  it("owns the range state via `useState` (default 30 — issue body)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useState/);
    // The default value comes from `DEFAULT_RANGE_DAYS` of the shared util —
    // pin we import the canonical default rather than hardcoding « 30 »
    // (a future change to the default would otherwise drift between
    // page + util + backend).
    expect(code).toMatch(/DEFAULT_RANGE_DAYS/);
  });

  it("does NOT redirect anywhere (the page is the destination, not a wrapper)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/router\.replace/);
    expect(code).not.toMatch(/\bredirect\(/);
  });
});
