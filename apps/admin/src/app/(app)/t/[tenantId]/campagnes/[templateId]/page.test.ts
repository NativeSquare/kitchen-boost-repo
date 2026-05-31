/**
 * F-CAMPAGNES [3/7] (#205) — `[templateId]/page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as the parent
 * `campagnes/page.test.ts`). The page is the thin wiring layer between
 * the Convex hook and the pure `TemplateView`:
 *
 *   - resolves the per-template payload by reading
 *     `api.lib.notifications.campaigns.listTenantTemplates` via
 *     `useTenantQuery` (the same source-of-truth query the picker uses —
 *     no NEW backend query added, per the issue body « re-utilise
 *     `listTenantTemplates` ou query unitaire si exposée »);
 *   - reads the `templateId` URL segment via `useParams` and finds the
 *     row;
 *   - threads `{tenantId, templateId, template}` to the pure
 *     `TemplateView` (loading / not-found / loaded branches owned by the
 *     view + its test).
 *
 * What's NOT covered here (and on purpose): the rendering branches — those
 * are pinned by `template-view.test.tsx`. The tenant-injection contract of
 * `useTenantQuery` itself is pinned by `hooks/use-tenant-query.test.ts`.
 *
 * Tenant access guard (cross-tenant fuzz) is OWNED by the wrapper of
 * `listTenantTemplates` itself — a `tenantQuery({ allow: ["kb_manager"] })`
 * that refuses Forbidden on an inaccessible tenantId (already pinned by
 * `listTenantTemplates.test.ts` + the `withTenant` cross-tenant fuzz suite,
 * ADR 0010). We do NOT duplicate that pin here — the page inherits the
 * isolation guarantee through the wrapper.
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

describe("[templateId]/page.tsx — F-CAMPAGNES [3/7] (#205) wiring contract", () => {
  it('declares `"use client"` (page uses Convex hooks)', () => {
    expect(PAGE_SOURCE).toMatch(/^"use client";/);
  });

  it("binds `api.lib.notifications.campaigns.listTenantTemplates` via `useTenantQuery` (re-uses the picker query, no NEW backend query)", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.notifications\.campaigns\.listTenantTemplates[^)]*\)/,
    );
  });

  it("does NOT use a raw `useQuery` (would bypass tenantId injection — ADR 0014 §4 / no-untenanted-query)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("delegates rendering to `TemplateView` (keeps the page thin + the view testable in node env)", () => {
    expect(PAGE_SOURCE).toMatch(/TemplateView/);
  });

  it("reads the templateId URL segment via `useParams` (forwarded to the view to resolve the row)", () => {
    // The URL segment `/t/[tenantId]/campagnes/[templateId]` exposes
    // `templateId` via `useParams()`. The page MUST consume it (not hard-
    // code, not derive from elsewhere).
    expect(PAGE_SOURCE).toMatch(/useParams/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/templateId/);
  });
});
