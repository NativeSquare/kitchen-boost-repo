/**
 * F-STATS-DASHBOARD (#252) — tenant home `/t/[tenantId]/page.tsx` wiring
 * contract. Same source-file pinning pattern as `campagnes/page.test.ts`.
 *
 * The page is the thin wiring layer between the Convex hook and the pure
 * `DashboardView`:
 *   - reads `api.lib.stats.dailyKpis.dailyKpis` via `useTenantQuery`
 *     (F-SHELL-05 #183, ADR 0014 §4 — front-side `withTenant` discipline);
 *   - delegates rendering to `DashboardView` (pure presentational shell with
 *     loading / empty / populated / error branches).
 *
 * Cross-tenant fuzz is owned by the backend wrapper (`tenantQuery` on
 * `dailyKpis`, pinned by `packages/backend/convex/lib/stats/dailyKpis.test.ts`).
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

describe("page.tsx — F-STATS-DASHBOARD (#252) wiring contract", () => {
  it("binds `api.lib.stats.dailyKpis.dailyKpis` via `useTenantQuery`", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.stats\.dailyKpis\.dailyKpis[^)]*\)/,
    );
  });

  it("does NOT use a raw `useQuery` (would bypass tenantId injection — ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("delegates rendering to `DashboardView`", () => {
    expect(PAGE_SOURCE).toMatch(/DashboardView/);
  });

  it('declares `"use client"` (page uses Convex hooks)', () => {
    expect(PAGE_SOURCE).toMatch(/^"use client";/);
  });

  it("does NOT redirect anywhere (the page replaces the previous /menu redirect — US1 dashboard à l'ouverture)", () => {
    // The legacy `/t/[tenantId]/page.tsx` redirected to `/menu`. This story
    // replaces the redirect with the real KPI dashboard — assert the
    // `router.replace`/`redirect` symbols are gone.
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/router\.replace/);
    expect(code).not.toMatch(/\bredirect\(/);
  });
});
