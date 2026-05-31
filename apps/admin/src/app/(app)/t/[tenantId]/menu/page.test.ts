/**
 * F-MENU-01 (#187) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `mes-clients/page.test.ts`).
 * The page is a thin wiring layer: it MUST bind
 * `api.lib.menu.categories.list` via `useTenantQuery` (ADR 0014 §4 / #183),
 * never a raw `useQuery` (which would bypass tenantId auto-injection and
 * either fail at runtime or — worse — silently leak the wrong tenant's
 * data, ADR 0010).
 *
 * What's NOT covered here (and on purpose): the rendering branches —
 * loading / empty / populated — those are pinned by `menu-view.test.tsx`.
 * What's pinned here is the assembly: page actually calls `useTenantQuery`
 * against `categories.list`, and delegates to `MenuView`.
 *
 * Acceptance criteria pinned here (#187):
 *   - AC2 « `useTenantQuery(api.lib.menu.categories.list)` câblé » → the
 *     source imports `useTenantQuery` AND references the canonical
 *     `categories.list` query, AND does NOT use a raw `useQuery`.
 *   - AC3 (delegation) → the source delegates rendering to `MenuView`, so
 *     the rendering branches stay pinned by the view's test (which can run
 *     under the lean `node` env).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

describe("page.tsx — F-MENU-01 (#187) wiring contract", () => {
  it("AC2 — binds `api.lib.menu.categories.list` via `useTenantQuery` (not raw useQuery)", () => {
    // Imports useTenantQuery from the canonical hooks barrel.
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    // Calls it on categories.list (collapse whitespace so a Prettier
    // line-wrap inside the call still matches).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.categories\.list[^)]*\)/,
    );
  });

  it("AC2 — does NOT use a raw `useQuery` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // `useQuery` from convex/react auto-injects nothing; using it for a
    // tenantQuery either fails at runtime (Forbidden / missing tenantId)
    // or silently leaks the wrong tenant's data — ADR 0010.
    //
    // Strip comments + template strings before the check so a docstring
    // referring to `useQuery` doesn't false-positive.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("AC3 — delegates rendering to `MenuView` (keeps the page thin + the view testable)", () => {
    // Same split as `mes-clients/page.tsx` → `MesClientsView`. The page is
    // a wiring layer; the visible branches (loading / empty / populated)
    // live in `MenuView` and are pinned by `menu-view.test.tsx`.
    expect(PAGE_SOURCE).toMatch(/MenuView/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-02 (#200) — CRUD wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-02 — wires `categories.create` / `categories.rename` / `categories.remove` through `useTenantMutation`", () => {
    // Slice 2 binds the three category mutations through `useTenantMutation`
    // (ADR 0014 §4 / #183), never raw `useMutation` (which would bypass the
    // tenantId injection — same risk as raw `useQuery` for the list, ADR 0010).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(PAGE_SOURCE).toMatch(/useTenantMutation/);
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.create[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.rename[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.remove[^)]*\)/,
    );
  });

  it("F-MENU-02 — does NOT use a raw `useMutation` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // Same discipline as for `useQuery` on the read path: a raw `useMutation`
    // would fail at runtime (Forbidden / missing tenantId) or — worse —
    // would only happen to work because Convex would refuse the call.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(code).not.toMatch(/\buseMutation\b/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-03 (#206) — drag&drop reorder wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-03 — wires `categories.reorder` through `useTenantMutation` (not raw useMutation, sends FULL ordered ids list)", () => {
    // The page binds the reorder mutation through `useTenantMutation` (same
    // discipline as create/rename/remove — ADR 0014 §4) and forwards a
    // handler that sends the COMPLETE ordered ids list (the backend rejects
    // a partial payload — `reorderTenantCategories` invariant pinned by
    // `packages/backend/convex/lib/menu/categories.test.ts`).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.reorder[^)]*\)/,
    );
    // The handler signature mentions `orderedIds` so the page passes the
    // full list to the mutation, not a diff.
    expect(PAGE_SOURCE).toMatch(/orderedIds/);
  });

  it("F-MENU-03 — passes `onReorderCategories` down to MenuView", () => {
    // Wiring contract: the page exposes the drag&drop handler via the
    // dedicated prop the view forwards to `CategoryListEditor`.
    expect(PAGE_SOURCE).toMatch(/onReorderCategories/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-04 (#211) — items list + inline rupture toggle wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-04 — wires `api.lib.menu.items.list` via `useTenantQuery` (not raw useQuery)", () => {
    // The page reads the tenant's items through the canonical tenantQuery
    // (ADR 0014 §4 / #183) — never a raw `useQuery` (which would bypass
    // tenantId auto-injection, ADR 0010).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.items\.list[^)]*\)/,
    );
  });

  it("F-MENU-04 — wires `availability.setItemAvailability` via `useTenantMutation` (live toggle, ADR 0015)", () => {
    // The rupture toggle calls `setItemAvailability` DIRECTLY (not through
    // publishMenu — ADR 0015 § Conséquences, story body « SANS passer par
    // publication »). The mutation is bound through `useTenantMutation` so
    // the tenantId injection is automatic.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.availability\.setItemAvailability[^)]*\)/,
    );
  });

  it("F-MENU-04 — passes `itemsByCategory` and `onToggleItemAvailability` down to MenuView", () => {
    // Wiring contract: the page exposes the per-category items map +
    // toggle handler via the dedicated props the view forwards down to
    // ItemList.
    expect(PAGE_SOURCE).toMatch(/itemsByCategory/);
    expect(PAGE_SOURCE).toMatch(/onToggleItemAvailability/);
  });

  it("F-MENU-04 — toggle handler wraps the mutation in try/catch + `toast.error` + `getConvexErrorMessage` (same discipline as CRUD)", () => {
    // The toggle is a live mutation; backend errors (e.g. NOT_FOUND for a
    // foreign id during a race) must surface as a user-visible toast, not
    // silently swallowed. Same shape as the F-MENU-02 CRUD handlers.
    // We pin the source mentions « setItemAvailability » + an associated
    // toast wiring nearby.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/setItemAvailability[\s\S]{0,400}toast\.error/);
  });

  it("F-MENU-02 — surfaces errors via `toast.error` + `getConvexErrorMessage` (no raw alert / console.error)", () => {
    // The CRUD handlers wrap each mutation call in try/catch and toast the
    // ConvexError's message (slice acceptance criterion « toast sur erreur »
    // + « messages d'erreur dérivés des ConvexError backend »).
    expect(PAGE_SOURCE).toMatch(/from\s+["']sonner["']/);
    expect(PAGE_SOURCE).toMatch(/toast/);
    expect(PAGE_SOURCE).toMatch(/getConvexErrorMessage/);
    // No raw alert in production code path (bad UX + bypasses our error sink).
    expect(PAGE_SOURCE).not.toMatch(/\balert\s*\(/);
  });
});
