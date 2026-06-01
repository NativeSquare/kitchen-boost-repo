/**
 * F-PIPELINE-CRM 01 (#216) — `page.tsx` wiring contract for the Kanban surface.
 *
 * Pinned at the source-file level (same pattern as
 * `mes-clients/page.test.ts`, `commandes/page.test.ts`,
 * `[prospectId]/page.test.ts`). The page is a thin "use client" wiring
 * layer on top of:
 *   - `useSession()` (F-SHELL-01) — to drive the UX-layer RBAC gate
 *     (`session.isAdmin === false` → UnauthorizedCard + redirect to `/`).
 *   - `useQuery(api.lib.onboarding.crm.listProspects)` — the canonical
 *     KB-Admin Kanban data source (exposed via `kbAdminQuery`, ADR 0010
 *     — backend is the real isolation barrier).
 *   - a placeholder `KanbanView` (or inline dump) that renders the list.
 *
 * V1 scope (issue #216 « What to build ») : juste un dump des `prospects`
 * brut, pas de colonnes ni DnD à ce stade. Le Kanban riche (colonnes,
 * DnD, filtres) atterrira dans une slice ultérieure de l'épique
 * F-PIPELINE-CRM (#144).
 *
 * Why source-string (no jsdom render)?
 * ------------------------------------
 * `apps/admin/vitest.config.ts` runs vitest in `environment: "node"` —
 * there is no DOM. The codebase pins React components by recursively
 * expanding the tree to plain nodes (see `[prospectId]/prospect-fiche-view.test.tsx`
 * and `monitoring-view.test.tsx`). For the THIN page wrapper we use the
 * source-string pattern instead — it pins the load-bearing wiring (which
 * hook, which query, which guard) without re-asserting what the view tests
 * already cover.
 *
 * AC pinned here (issue #216):
 *   - « `apps/admin/src/app/(app)/pipeline/page.tsx` rend la liste des
 *      prospects retournée par `crm.listProspects` (dump suffisant V1) » →
 *      assert the source file calls `useQuery` on
 *      `api.lib.onboarding.crm.listProspects` (the canonical KB-Admin query).
 *   - « Un utilisateur non-admin qui tape `/pipeline` dans l'URL est
 *      redirigé (ex. vers `/` ou page "non autorisé") » → assert the
 *      source uses `useSession` to gate AND either renders the shared
 *      `UnauthorizedCard` (consistent vocabulary with /monitoring) or
 *      drives a `router.replace`. We pin BOTH the session guard and the
 *      shared UnauthorizedCard (the canonical UX refusal surface, see
 *      `unauthorized-card.tsx` docblock — same vocabulary as /monitoring).
 *   - « État loading et état "prospect introuvable" gérés sur la fiche »
 *     → owned by `[prospectId]/page.tsx` + `prospect-fiche.decision.ts`
 *      (already pinned by the existing tests there). Not retested here.
 *   - « Le lien sidebar vers `/pipeline` n'apparaît pas pour un non-admin »
 *      → owned by `app-sidebar.tsx` `decideSidebarNav()` (the « pipeline »
 *      item is only in `ADMIN_SUPERVISION_ITEMS`, returned for KB Admin
 *      outside `/t/[id]`; a KB Manager gets `manager-operational` which
 *      does NOT include `/pipeline`). Pinned by `app-sidebar.decision.test.ts`.
 *      We do NOT duplicate that assertion here.
 *
 * Scope discipline (#216 hard constraint) : this file (and `page.tsx`
 * next to it) lives under `apps/admin/src/app/(app)/pipeline/` ONLY.
 * Zero touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code so a
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

describe("page.tsx — F-PIPELINE-CRM 01 (#216) wiring contract", () => {
  it("AC1 — exports a default function (the Next.js App Router page contract)", () => {
    expect(PAGE_SOURCE).toMatch(/export\s+default\s+(?:function|\w)/);
  });

  it("AC1 — binds `api.lib.onboarding.crm.listProspects` via `useQuery` (the canonical KB-Admin Kanban data source)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useQuery/);
    expect(code).toMatch(/api\.lib\.onboarding\.crm\.listProspects/);
  });

  it("AC RBAC — reads the session via `useSession` so the access gate fires before any data hydration (skip-until-admin sentinel, mirrors /monitoring's pattern)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useSession\b/);
    // Skip-until-admin sentinel — without it a manager who deep-links the
    // URL would trip the raw Convex FORBIDDEN error boundary instead of the
    // canonical UnauthorizedCard. Same shape as /monitoring's page.
    expect(code).toMatch(/"skip"/);
  });

  it("AC RBAC — renders the shared `UnauthorizedCard` for a non-admin actor (consistent vocabulary across /monitoring + /pipeline + tenant gate)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/UnauthorizedCard/);
  });

  it("AC scope — never imports from `apps/web` or `apps/native` (defensive — a future copy-paste fails here before the lint rule catches it)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });

  it("AC scope — never touches the backend module (apps/admin frontend slice only)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // The page must NOT import from `packages/backend/convex/lib/...` (only
    // the generated `api` barrel is allowed — that's the public contract).
    expect(code).not.toMatch(/packages\/backend\/convex\/lib/);
  });

  it('page is marked `"use client"` (uses client hooks — useSession, useQuery)', () => {
    expect(PAGE_SOURCE).toMatch(/^["']use client["']/m);
  });
});
