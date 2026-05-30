/**
 * F-MES-CLIENTS [2/4] (#186) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (a source-string regex, same pattern as the
 * `monitoring-view.test.tsx` access-denied check on `<Link href="/">`).
 * Rationale: the page is a thin wiring layer — `useTenantQuery(...)` +
 * `useMutation(logKpiConsultation)` + `useAuditOnOpen` + delegate to
 * `MesClientsView`. The actual rendering branches are pinned by
 * `mes-clients-view.test.tsx`; the audit logic is pinned by
 * `audit-on-open.test.ts`; the tenant-injection contract of `useTenantQuery`
 * itself is pinned by `hooks/use-tenant-query.test.ts`. What's NOT covered by
 * any of those is the assembly itself — that the page actually calls
 * `useTenantQuery` against `aggregateCustomerKPIs`, not a raw `useQuery`
 * (which would bypass the tenantId injection, ADR 0014 §4 / issue body AC1).
 *
 * A source-string assertion is honest: it pins the load-bearing wiring without
 * spinning up a React renderer (vitest runs in `environment: "node"`, see
 * `vitest.config.ts`) and without re-asserting what `use-tenant-query.test.ts`
 * already proves.
 *
 * Acceptance criteria pinned here (#186):
 *   - AC1 « La page binde `aggregateCustomerKPIs` via `useTenantQuery` (tenant
 *     auto-injecté) » → assert the source file imports `useTenantQuery` AND
 *     references `aggregateCustomerKPIs`, AND does NOT use a raw `useQuery`
 *     (which would bypass the front-side `withTenant` discipline).
 *   - AC7 « Audit (`logKpiConsultation`) reste appelé 1x à l'ouverture » →
 *     assert the slice-1 wiring is still in place (`useAuditOnOpen` +
 *     `logKpiConsultation` import + `useMutation`). The decision logic is
 *     covered by `audit-on-open.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

describe("page.tsx — F-MES-CLIENTS [2/4] (#186) wiring contract", () => {
  it("AC1 — binds `aggregateCustomerKPIs` via `useTenantQuery` (not raw useQuery)", () => {
    // Imports useTenantQuery from the canonical hooks barrel.
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    // Calls it on aggregateCustomerKPIs (not via some indirection — pinned
    // verbatim so a refactor that bypasses the hook fails loudly).
    // Collapse whitespace so a Prettier line-wrap inside the call still matches.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*aggregateCustomerKPIs[^)]*\)/,
    );
  });

  it("AC1 — does NOT use a raw `useQuery` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // `useQuery` from convex/react auto-injects nothing. Using it for a
    // tenantQuery would either fail at runtime (Forbidden, missing tenantId)
    // or — worse — work in dev with a stale tenantId and silently leak the
    // wrong tenant's data. Lint will eventually pin this; we pin it now.
    //
    // Strip comments before the check so a docstring referring to `useQuery`
    // (e.g. "never a raw useQuery") doesn't false-positive — what matters is
    // whether the executable code imports/calls it.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("AC7 — audit-on-open wiring is preserved (slice 1 regression — #181)", () => {
    // The audit-on-open contract is pinned in `audit-on-open.test.ts`; what
    // matters here is that the page still wires it up at all (one row per
    // visite, PRD 90 §4). A regression that drops the hook would be silent.
    expect(PAGE_SOURCE).toMatch(/useAuditOnOpen/);
    expect(PAGE_SOURCE).toMatch(/logKpiConsultation/);
    expect(PAGE_SOURCE).toMatch(/useMutation/);
  });

  it("AC1 — delegates rendering to `MesClientsView` (pure presentational shell)", () => {
    // The page MUST hand the resolved KPIs to the view; this keeps the view
    // testable in pure node env (no Convex client) — see
    // `mes-clients-view.test.tsx`.
    expect(PAGE_SOURCE).toMatch(/MesClientsView/);
  });
});
