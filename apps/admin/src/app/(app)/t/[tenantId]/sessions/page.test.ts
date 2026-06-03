/**
 * #396 (KB Admin — Page Sessions actives) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as
 * `parametres/page.test.ts`, `menu/page.test.ts`, `mes-clients/page.test.ts`):
 * the page is the thin wiring layer between the Convex tenant-scoped hooks
 * (`useTenantQuery` / `useTenantMutation` — front-side `withTenant`
 * discipline, ADR 0014 §4) and the pure `SessionsView`. We DON'T render the
 * React tree here — the view's branches are pinned by `sessions-view.test.tsx`.
 *
 * Acceptance criteria pinned here:
 *   - The page imports `useTenantQuery` and binds it to
 *     `api.lib.auth.sessions.listTenantSessions` (never raw `useQuery` on a
 *     tenant-scoped query).
 *   - The page imports `useTenantMutation` and binds it to
 *     `api.lib.auth.sessions.revokeSession` (never raw `useMutation` on a
 *     tenant-scoped mutation, ADR 0014 §4 / #183).
 *   - The page delegates rendering to `SessionsView` and forwards an
 *     `onRevokeSession` handler.
 *
 * AC4 « Un user d'un autre tenant qui tente l'URL est bloqué par le guard du
 * shell » is OWNED by the F-SHELL-04 layout (`(app)/t/[tenantId]/layout.tsx`)
 * — this page is mounted under it and inherits the guard transitively.
 * Cross-tenant fuzz at the backend layer is owned by the `tenantQuery` /
 * `tenantMutation` wrappers of `listTenantSessions` / `revokeSession`
 * themselves (ADR 0010, pinned by `sessions.test.ts`). We do NOT duplicate
 * those pins here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code, so a
 * docstring referring to (say) `useQuery` doesn't false-positive — only the
 * actual code matters for the no-raw-useQuery pins.
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — #396 wiring contract", () => {
  it("binds `api.lib.auth.sessions.listTenantSessions` via `useTenantQuery` (not raw useQuery)", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.auth\.sessions\.listTenantSessions[^)]*\)/,
    );
  });

  it("does NOT use a raw `useQuery` (every tenant-scoped query goes through `useTenantQuery`, ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\(/);
  });

  it("binds `api.lib.auth.sessions.revokeSession` via `useTenantMutation` (front-side withTenant)", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantMutation/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.auth\.sessions\.revokeSession[^)]*\)/,
    );
  });

  it("does NOT call raw `useMutation` (would bypass tenantId injection, ADR 0014 §4)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseMutation\(/);
  });

  it("delegates rendering to `SessionsView` (pure-view discipline, same as parametres-view)", () => {
    expect(PAGE_SOURCE).toMatch(/SessionsView/);
  });

  it("forwards an `onRevokeSession` save handler to the view", () => {
    expect(PAGE_SOURCE).toMatch(/onRevokeSession/);
  });
});
