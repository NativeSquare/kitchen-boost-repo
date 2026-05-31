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
});
