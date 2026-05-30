/**
 * F-PARAMETRES-01 (#193) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `menu/page.test.ts` and
 * `mes-clients/page.test.ts`). The page is a thin wiring layer:
 *
 *   useTenantQuery(api.lib.menu.serviceHours.get) → ParametresView
 *
 * What's pinned here is the assembly: the page binds the read via
 * `useTenantQuery` (front-side `withTenant` discipline, ADR 0014 §4 / F-SHELL-05
 * #183), never a raw `useQuery` (would bypass tenantId auto-injection — and
 * either fail at runtime or — worse — leak the wrong tenant's data, ADR 0010),
 * and delegates rendering to the pure `ParametresView`.
 *
 * `api.lib.menu.serviceHours.get` is the only tenant-scoped read this slice
 * wires today — it's the source for the « Horaires de service » section
 * (section 4 of 4). The other three sections (Identité visuelle, Coordonnées,
 * Modes accepés) display the « À implémenter » placeholder; their value
 * sources (`branding` / `address` / `phone` / `acceptedModes` on the tenant
 * row) will be exposed via dedicated `tenantQuery`(s) in F-PARAMETRES-02..04.
 * Slice 1 = skeleton + ONE wired read + 4 placeholder bodies + Uber Direct
 * read-only block (issue body « no mutation à ce stade — seulement la lecture
 * + le layout »).
 *
 * What's NOT covered here (and on purpose): the rendering branches —
 * placeholder copy, section cards, Uber Direct block — those are pinned by
 * `parametres-view.test.tsx`. The tenant-injection contract of
 * `useTenantQuery` itself is pinned by `hooks/use-tenant-query.test.ts`.
 *
 * Acceptance criteria pinned here (#193):
 *   - AC2 « La page lit les valeurs courantes du tenant via `useTenantQuery` »
 *     → the source imports `useTenantQuery` AND references the canonical
 *     `serviceHours.get` query, AND does NOT use a raw `useQuery`.
 *   - AC6 « Aucune mutation appelée (read-only à ce stade) » → the source
 *     does NOT import `useMutation`, does NOT reference any `*Mutation`
 *     symbol, and does NOT call `updateSettings` / `set` from the menu /
 *     admin modules.
 *   - AC delegation → the source delegates rendering to `ParametresView`,
 *     so the rendering branches stay pinned by the view's test.
 *
 * AC4 « Un user d'un autre tenant qui tente l'URL est bloqué par le guard du
 * shell » is OWNED by the F-SHELL-04 layout (`(app)/t/[tenantId]/layout.tsx`,
 * pinned by `tenant-context.hook.test.ts`) — this page is mounted under that
 * layout and therefore inherits the guard transitively. Cross-tenant fuzz at
 * the backend layer is owned by the `tenantQuery` wrapper of
 * `serviceHours.get` itself (ADR 0010, `tenantQuery()({...})` rejects an
 * inaccessible tenantId Forbidden) — see `withTenant.test.ts`. We do NOT
 * duplicate that pin here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code, so a
 * docstring referring to (say) `useQuery` or `useMutation` doesn't false-
 * positive — only the actual code matters for the read-only / no-raw-useQuery
 * pins (same pattern as menu/page.test.ts and mes-clients/page.test.ts).
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — F-PARAMETRES-01 (#193) wiring contract", () => {
  it("AC2 — binds `api.lib.menu.serviceHours.get` via `useTenantQuery` (not raw useQuery)", () => {
    // Imports useTenantQuery from the canonical hooks barrel.
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    // Calls it on serviceHours.get (collapse whitespace so a Prettier
    // line-wrap inside the call still matches).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.serviceHours\.get[^)]*\)/,
    );
  });

  it("AC2 — does NOT use a raw `useQuery` (bypasses tenantId injection — ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("AC6 — does NOT call any mutation (slice 1 is read-only; mutations land in F-PARAMETRES-02..05)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // No `useMutation` import or call — the page is read-only this slice.
    expect(code).not.toMatch(/\buseMutation\b/);
    // No reference to the canonical tenant settings mutation (defensive — a
    // future agent might wire it here by accident before its dedicated slice).
    expect(code).not.toMatch(/updateSettings/);
    // No reference to the serviceHours setter (same defensive pin).
    expect(code).not.toMatch(/serviceHours\.set\b/);
  });

  it("AC delegation — delegates rendering to `ParametresView` (keeps the page thin + the view testable in node env)", () => {
    expect(PAGE_SOURCE).toMatch(/ParametresView/);
  });
});
