import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it, expect } from "vitest";
import kb from "./index.js";

/**
 * Contract test for `configs.backendRecommended` — the flat-config block
 * `packages/backend/eslint.config.mjs` spreads to ACTIVATE `no-untenanted-query`
 * (story 1.x-H, ADR 0010).
 *
 * The rule itself is unit-tested in `rules/no-untenanted-query.test.js`. THIS
 * suite pins the ACTIVATION envelope: which file paths the rule fires on
 * (business code) and which are exempt (the sanctioned `ctx.db` access points +
 * codegen + tests). The exemptions are the "documented exemption for the GLOBAL
 * tables + sanctioned accesses" required by the story — encoded as `ignores`,
 * asserted here so a future edit that widens/narrows them is caught.
 */

const linter = new Linter();

// A raw `ctx.db.query` — a violation IF the file is in scope and not exempt.
const VIOLATION = `async function h(ctx){ return await ctx.db.query("orders").collect(); }`;

/** Lint `code` AS IF it lived at `filename`, through backendRecommended. */
function lintAs(filename, code = VIOLATION) {
  return linter.verify(
    code,
    [
      { files: ["**/*.ts"], languageOptions: { parser: tsParser } },
      ...kb.configs.backendRecommended,
    ],
    { filename },
  );
}

/** True iff the no-untenanted-query rule fired at least once. */
function flagged(messages) {
  return messages.some((m) => m.ruleId === "kitchenboost/no-untenanted-query");
}

describe("configs.backendRecommended — activation envelope", () => {
  it("flags raw ctx.db in business code (a non-exempt convex/ path)", () => {
    expect(flagged(lintAs("convex/menu/list.ts"))).toBe(true);
  });

  it("flags raw ctx.db in a nested business module", () => {
    expect(flagged(lintAs("convex/lib/orders/place.ts"))).toBe(true);
  });

  // --- Sanctioned exemptions (must NOT flag) -------------------------------

  it("exempts the tenancy wrappers themselves", () => {
    expect(flagged(lintAs("convex/lib/tenancy/withTenant.ts"))).toBe(false);
  });

  it("exempts the sanctioned identity point (getCurrentActor, ADR 0011)", () => {
    expect(flagged(lintAs("convex/lib/auth/getCurrentActor.ts"))).toBe(false);
  });

  it("exempts the transverse webhook idempotence ledger", () => {
    expect(flagged(lintAs("convex/lib/webhooks/idempotent.ts"))).toBe(false);
  });

  it("exempts the per-tenant crypto/credentials module", () => {
    expect(flagged(lintAs("convex/lib/crypto/credentials.ts"))).toBe(false);
  });

  it("exempts the GLOBAL users/customers table foundation code", () => {
    expect(flagged(lintAs("convex/table/users.ts"))).toBe(false);
    expect(flagged(lintAs("convex/table/admin.ts"))).toBe(false);
  });

  it("exempts the template CRUD generator", () => {
    expect(flagged(lintAs("convex/utils/generateFunctions.ts"))).toBe(false);
  });

  it("exempts generated code", () => {
    expect(flagged(lintAs("convex/_generated/api.d.ts"))).toBe(false);
  });

  it("exempts test files (convex-test t.run harness)", () => {
    expect(flagged(lintAs("convex/lib/orders/place.test.ts"))).toBe(false);
    expect(flagged(lintAs("convex/foundation-schema.test.ts"))).toBe(false);
  });
});
