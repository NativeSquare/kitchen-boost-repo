/**
 * F-SHELL-10 (#233) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `commandes/page.test.ts`,
 * `menu/page.test.ts`, `parametres/page.test.ts`, `mes-clients/page.test.ts`,
 * `qr/page.test.ts`).
 *
 * The page is a thin "use client" adapter on top of:
 *   - `useSession()` (F-SHELL-01)
 *   - `useParams<{ prospectId }>()` (Next.js App Router)
 *   - `useQuery(api.prospects.get, ...)` — when the backend lands, see below
 *   - the pure `decideProspectFiche` decision + `ProspectFicheView` view.
 *
 * Stub note (issue #233 explicit allowance):
 *   « Si `api.prospects.get` n'est pas mergée, stub côté front pour permettre
 *     le routage. »
 *   At this slice the Convex query does NOT exist yet (the backend lives in
 *   the F-PIPELINE-CRM epic, not blocking this story). The page therefore
 *   short-circuits the data hydration to `undefined` for now — the route
 *   itself is wired, the SessionGuard + decision still pin the 403 for KB
 *   Managers, and `loading-prospect` covers the « still resolving » UX. When
 *   F-PIPELINE-CRM ships `api.prospects.get`, swap the stub for the live
 *   `useQuery` call — the rest of the wiring (params, session, view, route)
 *   does not move.
 *
 * What's pinned here (acceptance criteria #233):
 *   - AC1 — exports a default function (Next.js App Router page contract).
 *   - AC delegation — delegates rendering to `ProspectFicheView` (keeps the
 *     page thin so the view's branches stay pinned by
 *     `prospect-fiche-view.test.tsx` under the lean `node` vitest env).
 *   - AC — uses `useSession` so the access gate fires BEFORE the (stubbed)
 *     query (a manager landing here renders the UnauthorizedCard, NOT a
 *     loading spinner).
 *   - AC — uses `useParams` to read the `prospectId` URL segment (so a
 *     future Convex query against `api.prospects.get` can pass the right
 *     id; today the param is read defensively even when stubbed).
 *   - AC scope — never imports from `apps/web` or `apps/native` (defensive
 *     — a future copy-paste fails here before the lint rule catches it).
 *
 * AC4 « Navigation vers `/pipeline/<un-prospectId>` rend la page sans
 * erreur » is OWNED by Next.js' file-system router — placing the file at
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/page.tsx` IS the binding
 * (the `(app)` group is parenthesised → it does NOT segment the URL, cf.
 * ADR 0014 §3). The route resolution itself is a framework concern that an
 * E2E (Playwright) covers, not a unit test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code, so a
 * docstring referring to (say) `useQuery` doesn't false-positive — only
 * the actual code matters for the slice discipline pins (same pattern as
 * the sibling page tests).
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — F-SHELL-10 (#233) wiring contract", () => {
  it("AC1 — exports a default function (the Next.js App Router page contract)", () => {
    expect(PAGE_SOURCE).toMatch(/export\s+default\s+(?:function|\w)/);
  });

  it("AC delegation — delegates rendering to `ProspectFicheView` (keeps the page thin + the view testable in node env)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/ProspectFicheView/);
  });

  it("AC — reads the session via `useSession` so the access gate fires before any data hydration", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useSession\b/);
  });

  it("AC — reads the URL segment via `useParams<{ prospectId }>`", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useParams\b/);
    // The exact param name we depend on is `prospectId` — pinned so a
    // refactor that renames the segment doesn't silently break the route.
    expect(code).toMatch(/prospectId/);
  });

  it("AC scope — never imports from `apps/web` or `apps/native`", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });

  it('page is marked `"use client"` (uses client hooks — useSession, useParams)', () => {
    // The exact directive must appear (Next.js App Router requirement for
    // any module that calls a client hook).
    expect(PAGE_SOURCE).toMatch(/^["']use client["']/m);
  });

  it("F-CONTRATS slice 1/4 (#158) — fires `api.lib.admin.contracts.listContractsForProspect` and threads it as `contracts` to the view (skipped until session is a ready root admin, mirrors /monitoring's pattern)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // The contracts query lives here (not in the view) so the view stays
    // pure-callable from vitest's node env.
    expect(code).toMatch(
      /api\.lib\.admin\.contracts\.listContractsForProspect/,
    );
    expect(code).toMatch(/useQuery/);
    // Skip-until-admin sentinel — without it a manager who deep-links the
    // URL would trip the raw Convex FORBIDDEN error boundary instead of the
    // canonical UnauthorizedCard (A4 of the manual E2E checklist).
    expect(code).toMatch(/"skip"/);
    // The contracts prop must reach the view (pure split — view consumes
    // it via `ContractsBlock`, page owns the data).
    expect(code).toMatch(/contracts=\{contracts\}/);
  });

  it("F-CONTRATS slice 3/4 (#174) — fires `api.lib.onboarding.crm.getProspect` so the modal can pre-fill the juridical recap (skipped until ready root admin)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // The prospect query is now LIVE (no longer the #233 stub).
    expect(code).toMatch(/api\.lib\.onboarding\.crm\.getProspect/);
    // The prospect must be passed to the view (the launcher reads it from
    // there through the `headerAction` plumbing).
    expect(code).toMatch(/prospect=\{prospect\}/);
  });

  it("F-CONTRATS slice 3/4 (#174) — owns the `generatedContractId` state, drives `api.lib.admin.contracts.getContract` for the iframe, threads `onGenerated` + `generatedContractHtml` to the view", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // The page owns the last-generated contract id (so re-generation
    // overrides the iframe content with the latest version).
    expect(code).toMatch(/useState/);
    // The HTML hydration uses the canonical `getContract` kbAdminQuery
    // (NOT the list query — single-row read).
    expect(code).toMatch(/api\.lib\.admin\.contracts\.getContract/);
    // Both view props are wired.
    expect(code).toMatch(/onGenerated=/);
    expect(code).toMatch(/generatedContractHtml=\{generatedContractHtml\}/);
  });

  it("F-CONTRATS slice 4/4 (#185) — owns the selected contractId state + threads `onSelectContract` + `selectedContractId` to the view (rows become clickable, iframe re-renders from the selected row)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // The page must thread the selection plumbing to the view (these props
    // are consumed by the view → ContractsBlock).
    expect(code).toMatch(/onSelectContract=/);
    expect(code).toMatch(/selectedContractId=/);
    // No new dependency on the backend — the AC «pas de nouvelle
    // dépendance backend (consommation des queries existantes)» is
    // pinned at the symbol level: only the EXISTING `getContract` query
    // hydrates the iframe (the same one slice 3 already used).
    const newQueryMatches = code.match(
      /api\.lib\.admin\.contracts\.[a-zA-Z]+/g,
    );
    expect(newQueryMatches).toBeTruthy();
    const allowed = new Set([
      "api.lib.admin.contracts.listContractsForProspect",
      "api.lib.admin.contracts.getContract",
      "api.lib.admin.contracts.generateContract",
    ]);
    for (const m of newQueryMatches ?? []) {
      expect(allowed.has(m)).toBe(true);
    }
  });
});
