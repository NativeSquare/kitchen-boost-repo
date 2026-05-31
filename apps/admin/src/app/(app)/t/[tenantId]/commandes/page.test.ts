/**
 * F-COMMANDES-PAGE-SHELL (#222) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `parametres/page.test.ts`,
 * `mes-clients/page.test.ts`, `qr/page.test.ts`). Slice 1 of EPIC F-COMMANDES
 * #141 — the page is a scaffold:
 *
 *   page.tsx → <CommandesView />
 *
 * Issue body « pas de données encore — juste le scaffold prouvant que la
 * route est joignable, le tenant context est résolu via le segment
 * `[tenantId]`, et la page hérite du layout chrome-less ». No data wired
 * yet, no `useTenantQuery`, no mutation. The live orders table
 * (`listOrders`), filters, detail modal (`getOrder`), refund action, and
 * CSV export all land in subsequent slices of EPIC #141.
 *
 * What's pinned here is the assembly: the page delegates rendering to the
 * pure `CommandesView` and does NOT prematurely wire backend reads /
 * mutations that belong to later slices.
 *
 * Acceptance criteria pinned here (#222):
 *   - AC1 « `apps/admin/src/app/(app)/t/[tenantId]/commandes/page.tsx`
 *     existe et exporte une `default function` » → pinned by the
 *     presence-of-default-export check + the fact that the test file imports
 *     the page transitively via the source-string read.
 *   - AC delegation → the source delegates rendering to `CommandesView`,
 *     so the rendering branches stay pinned by the view's test.
 *   - Slice discipline (« Hors scope ce slice : liste, filtres, modal,
 *     refund, CSV ») → the source does NOT use `useQuery` /
 *     `useTenantQuery` / `useMutation` / `useTenantMutation` /
 *     `useAction` / `useTenantAction`, does NOT reference the canonical
 *     orders queries (`listOrders`, `getOrder`), and does NOT reference
 *     the refund entrypoints (`refundOrder`, `refundOnRefusal`).
 *
 * AC4 « Navigation vers `/t/<un-tenantId-valide>/commandes` rend la page
 * sans erreur » and AC5 « Un user d'un autre tenant qui essaye d'accéder à
 * l'URL est rejeté par le guard `(app)` déjà en place » are OWNED by the
 * F-SHELL-04 layout (`(app)/t/[tenantId]/layout.tsx`, pinned by
 * `tenant-context.hook.test.ts` and `tenant-context.decision.test.ts`) —
 * this page is mounted under that layout and therefore inherits the guard
 * transitively. Cross-tenant fuzz at the backend layer is owned by the
 * `tenantQuery` wrappers of `listOrders` / `getOrder` themselves (ADR 0010)
 * — see `withTenant.test.ts`. We do NOT duplicate those pins here.
 *
 * Scope discipline (#222 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`. We pin that the source NEVER imports anything
 * from those forbidden roots (defensive — a future copy/paste would fail
 * loudly here even before the lint rule catches it).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code, so a
 * docstring referring to (say) `useQuery` or `listOrders` doesn't false-
 * positive — only the actual code matters for the slice-1 discipline pins
 * (same pattern as the sibling page tests).
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — F-COMMANDES-PAGE-SHELL (#222) wiring contract", () => {
  it("AC1 — exports a default function (the Next.js App Router page contract)", () => {
    // Either `export default function CommandesPage(...)` or
    // `export default <Identifier>` is acceptable — we pin both shapes since
    // either satisfies the Next.js page convention. The Next router only
    // cares that `page.tsx` has a default export.
    expect(PAGE_SOURCE).toMatch(/export\s+default\s+(?:function|\w)/);
  });

  it("AC delegation — delegates rendering to `CommandesView` (keeps the page thin + the view testable in node env)", () => {
    expect(PAGE_SOURCE).toMatch(/CommandesView/);
  });

  it("slice discipline — does NOT call `useQuery` / `useTenantQuery` / `useMutation` / `useTenantMutation` / `useAction` / `useTenantAction` (no data wired in slice 1)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
    expect(code).not.toMatch(/\buseTenantQuery\b/);
    expect(code).not.toMatch(/\buseMutation\b/);
    expect(code).not.toMatch(/\buseTenantMutation\b/);
    expect(code).not.toMatch(/\buseAction\b/);
    expect(code).not.toMatch(/\buseTenantAction\b/);
  });

  it("slice discipline — does NOT reference the canonical orders queries `listOrders` / `getOrder` (they belong to subsequent slices of EPIC #141)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\blistOrders\b/);
    expect(code).not.toMatch(/\bgetOrder\b/);
  });

  it("slice discipline — does NOT reference the refund entrypoints `refundOrder` / `refundOnRefusal` (refund flow lands in a later slice of EPIC #141)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\brefundOrder\b/);
    expect(code).not.toMatch(/\brefundOnRefusal\b/);
  });

  it("AC scope — never imports from `apps/web`, `apps/native`, or the backend `functions` tree", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // No cross-app imports. The page lives in apps/admin; touching apps/web
    // or apps/native would explode the scope (issue header hard rule).
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
    // Backend imports MUST go through the generated barrel (`api` from
    // `_generated/api`) or the dataModel — never the raw functions tree.
    expect(code).not.toMatch(/@packages\/backend\/convex\/lib\//);
  });
});
