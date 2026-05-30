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
