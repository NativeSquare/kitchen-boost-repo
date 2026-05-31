/**
 * F-PARAMETRES-01 (#193) + F-PARAMETRES-02 (#229) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `menu/page.test.ts` and
 * `mes-clients/page.test.ts`). The page is the thin wiring layer between the
 * Convex hooks and the pure `ParametresView`:
 *
 *   - reads `api.lib.menu.serviceHours.get` via `useTenantQuery` (section 4
 *     source, lives untouched since #193);
 *   - wires the F-PARAMETRES-02 (#229) section 1 editor handlers:
 *      • `tenant.updateSettings` via `useTenantMutation` (the canonical D5
 *        élargi mutation, B-TENANT-LIFECYCLE [3/4]) — patches branding;
 *      • `photos.generateUploadUrl` via `useTenantMutation` — tenant-gated
 *        upload URL mint (kb_manager only, ADR 0014 §4 / no-untenanted-query);
 *      • forwards both to `ParametresView` so the pure view stays UI-only.
 *
 * Source of the initial branding value
 * ------------------------------------
 * No KB-Manager-accessible read query exists for `branding` today (EPIC #148
 * Implementation Decisions explicitly anticipated this — the sections that
 * read tenant-row fields land alongside their editors). #229's scope is
 * `apps/admin/...` ONLY (no backend changes allowed), so the initial value
 * is fed from the EXISTING root query `loadTenantForStripe` (a `kbAdminQuery`
 * already reused for branding by `qr/page.tsx`) when the caller is a KB Admin
 * — and starts empty for a KB Manager (the editor handles `value = {}`
 * gracefully, and the saved value re-surfaces via Convex's reactivity once
 * the backend exposes a manager-accessible read in a follow-up slice).
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

  it("F-PARAMETRES-02 (#229) — wires `tenant.updateSettings` via `useTenantMutation` (front-side withTenant discipline, never raw `useMutation` on a tenantMutation)", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantMutation/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.admin\.tenantSettings\.updateSettings[^)]*\)/,
    );
  });

  it("F-PARAMETRES-02 (#229) — wires the tenant-gated `photos.generateUploadUrl` (kb_manager-only upload URL mint, NOT the ungated template `api.storage.generateUploadUrl`)", () => {
    // The tenant-gated mutation is the only one a kb_manager can call —
    // the template's bare `api.storage.generateUploadUrl` is ungated and
    // would bypass the wrapper. Pin we use the right one.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.photos\.generateUploadUrl[^)]*\)/,
    );
    const code = stripNonCode(PAGE_SOURCE);
    // No raw `api.storage.generateUploadUrl` (it would bypass the tenant
    // wrapper). The PUBLIC URL read uses `api.storage.getImageUrl` which is
    // a read and allowed — but the upload-url mutation must be tenant-gated.
    expect(code).not.toMatch(/api\.storage\.generateUploadUrl/);
  });

  it("F-PARAMETRES-02 (#229) — does NOT call a raw `useMutation` (every mutation goes through `useTenantMutation`, ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // A bare `useMutation(` would bypass tenantId injection.
    expect(code).not.toMatch(/\buseMutation\(/);
  });

  it("AC delegation — delegates rendering to `ParametresView` (keeps the page thin + the view testable in node env)", () => {
    expect(PAGE_SOURCE).toMatch(/ParametresView/);
  });
});
