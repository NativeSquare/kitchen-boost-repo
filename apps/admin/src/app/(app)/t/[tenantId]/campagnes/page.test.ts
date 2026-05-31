/**
 * F-CAMPAGNES [1/7] (#179) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `mes-clients/page.test.ts`
 * and `parametres/page.test.ts`). The page is the thin wiring layer between
 * the Convex hook and the pure `CampagnesView`:
 *
 *   - reads `api.lib.notifications.campaigns.listTenantTemplates` via
 *     `useTenantQuery` (the F-SHELL-05 #183 hook, ADR 0014 §4 — front-side
 *     `withTenant` discipline);
 *   - delegates rendering to `CampagnesView` (pure presentational shell).
 *
 * What's NOT covered here (and on purpose): the rendering branches —
 * loading / empty / list copy — those are pinned by `campagnes-view.test.tsx`.
 * The tenant-injection contract of `useTenantQuery` itself is pinned by
 * `hooks/use-tenant-query.test.ts`.
 *
 * Acceptance criteria pinned here (#179):
 *   - AC1 « Route /t/[tenantId]/campagnes accessible » → the file exists at
 *     the expected path (the existence of this test running already proves
 *     it, but the AC2 assertions also exercise its source).
 *   - AC2 « La page utilise `useTenantQuery` (F-SHELL) sur
 *     `api.lib.notifications.*.listTenantTemplates` » → assert the source
 *     file imports `useTenantQuery` AND references `listTenantTemplates`,
 *     AND does NOT use a raw `useQuery` (which would bypass tenantId
 *     injection — ADR 0014 §4).
 *   - AC delegation — assert the source delegates rendering to
 *     `CampagnesView`, so the rendering branches stay pinned by the view's
 *     test.
 *
 * Tenant access guard (cross-tenant fuzz) is OWNED by the wrapper of
 * `listTenantTemplates` itself — a `tenantQuery({ allow: ["kb_manager"] })`
 * that refuses Forbidden on an inaccessible tenantId (pinned by the backend's
 * `listTenantTemplates.test.ts` + the `withTenant` cross-tenant fuzz suite,
 * ADR 0010). We do NOT duplicate that pin here — the page inherits the
 * isolation guarantee through the wrapper.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code, so a
 * docstring referring to (say) `useQuery` doesn't false-positive — only the
 * actual code matters for the no-raw-useQuery pin (same helper used by
 * `parametres/page.test.ts`).
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — F-CAMPAGNES [1/7] (#179) wiring contract", () => {
  it("AC2 — binds `api.lib.notifications.campaigns.listTenantTemplates` via `useTenantQuery`", () => {
    // Imports useTenantQuery from the canonical hooks barrel.
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    // Calls it on listTenantTemplates (collapse whitespace so a Prettier
    // line-wrap inside the call still matches). The module path is the
    // canonical one exposed by `notifications/index.ts`.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.notifications\.campaigns\.listTenantTemplates[^)]*\)/,
    );
  });

  it("AC2 — does NOT use a raw `useQuery` (would bypass tenantId injection — ADR 0014 §4 / no-untenanted-query)", () => {
    // `useQuery` from convex/react auto-injects nothing. Using it for a
    // tenantQuery would either fail at runtime (Forbidden, missing tenantId)
    // or — worse — work in dev with a stale tenantId and silently leak the
    // wrong tenant's data. We pin it now (lint will eventually catch this).
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("AC delegation — delegates rendering to `CampagnesView` (keeps the page thin + the view testable in node env)", () => {
    expect(PAGE_SOURCE).toMatch(/CampagnesView/);
  });

  it('AC1 — declares `"use client"` (page uses Convex hooks)', () => {
    // `useTenantQuery` is a client hook — the page directive must be
    // present or Next will try to render it server-side and crash.
    expect(PAGE_SOURCE).toMatch(/^"use client";/);
  });
});
