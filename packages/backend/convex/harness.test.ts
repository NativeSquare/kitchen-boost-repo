import { describe, it, expect } from "vitest";

/**
 * Smoke test — proves the Vitest + convex-test harness is wired and `pnpm test`
 * is green before any business code exists. Convex excludes `*.test.ts` from
 * deployment, and these files are excluded from the Convex `tsc` typecheck.
 *
 * The real suites land later:
 *  - cross-tenant fuzz (multi-tenant-isolation.test.ts) — story 1.x-C
 *  - withIdempotence — story 1.x-F
 *  - anti-extraction MOAT assertions — Customer Data (chantier 2.1)
 */
describe("backend test harness", () => {
  it("runs under vitest", () => {
    expect(true).toBe(true);
  });
});
