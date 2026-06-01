/**
 * F-CAMPAGNES [6/7] (#240) — `historique/[launchId]/page.tsx` wiring contract.
 *
 * The detail page binds the public single-launch query and delegates to the
 * pure `LaunchDetailView` which itself reuses `CampaignResultStats` (no
 * duplication — issue body verbatim).
 *
 * Acceptance criteria pinned here (#240):
 *   - the page exists at `/t/[tenantId]/campagnes/historique/[launchId]/`
 *   - binds `getTenantCampaignLaunch` via `useTenantQuery`
 *   - does NOT use a raw `useQuery`
 *   - resolves the `launchId` URL segment via `useParams`
 *   - delegates to `LaunchDetailView`
 *   - threads the current tenantId down (back link needs it)
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

describe("historique/[launchId]/page.tsx — F-CAMPAGNES [6/7] (#240) wiring contract", () => {
  it("binds `api.lib.notifications.campaigns.getTenantCampaignLaunch` via `useTenantQuery`", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.notifications\.campaigns\.getTenantCampaignLaunch[^)]*\)/,
    );
  });

  it("does NOT use a raw `useQuery` (would bypass tenantId injection — ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("resolves `launchId` from the URL segment via `useParams`", () => {
    expect(PAGE_SOURCE).toMatch(/useParams/);
    expect(PAGE_SOURCE).toMatch(/launchId/);
  });

  it("delegates rendering to `LaunchDetailView`", () => {
    expect(PAGE_SOURCE).toMatch(/LaunchDetailView/);
  });

  it("reads the current tenantId and forwards it to the view (back link needs it)", () => {
    expect(PAGE_SOURCE).toMatch(/useCurrentTenantId/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/tenantId=\{[^}]*tenantId[^}]*\}/);
  });

  it('declares `"use client"` (page uses Convex hooks)', () => {
    expect(PAGE_SOURCE).toMatch(/^"use client";/);
  });
});
