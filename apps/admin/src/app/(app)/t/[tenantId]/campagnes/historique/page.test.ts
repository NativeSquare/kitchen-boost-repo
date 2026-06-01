/**
 * F-CAMPAGNES [6/7] (#240) — `historique/page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `mes-clients/page.test.ts`,
 * `parametres/page.test.ts` and `campagnes/page.test.ts`). The page is the
 * thin wiring layer between the Convex hook and the pure
 * `CampaignHistoryList`:
 *   - reads `api.lib.notifications.campaigns.listTenantCampaignLaunches` via
 *     `useTenantQuery` (front-side `withTenant` discipline, ADR 0014 §4 /
 *     F-SHELL-05 #183);
 *   - delegates rendering to `CampaignHistoryList`.
 *
 * Acceptance criteria pinned here (#240):
 *   - the page exists at `/t/[tenantId]/campagnes/historique/`
 *   - binds the public query via `useTenantQuery`
 *   - does NOT use a raw `useQuery`
 *   - delegates rendering to `CampaignHistoryList`
 *   - threads the current tenantId down (the list needs it for per-row hrefs)
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

describe("historique/page.tsx — F-CAMPAGNES [6/7] (#240) wiring contract", () => {
  it("binds `api.lib.notifications.campaigns.listTenantCampaignLaunches` via `useTenantQuery`", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.notifications\.campaigns\.listTenantCampaignLaunches[^)]*\)/,
    );
  });

  it("does NOT use a raw `useQuery` (would bypass tenantId injection — ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("delegates rendering to `CampaignHistoryList`", () => {
    expect(PAGE_SOURCE).toMatch(/CampaignHistoryList/);
  });

  it("reads the current tenantId and forwards it to the list (per-row hrefs need it)", () => {
    expect(PAGE_SOURCE).toMatch(/useCurrentTenantId/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/tenantId=\{[^}]*tenantId[^}]*\}/);
  });

  it('declares `"use client"` (page uses Convex hooks)', () => {
    expect(PAGE_SOURCE).toMatch(/^"use client";/);
  });
});
