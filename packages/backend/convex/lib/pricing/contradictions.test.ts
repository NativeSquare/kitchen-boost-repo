import { describe, expect, it } from "vitest";
import type { Condition } from "@packages/shared/pricing";
import { findConditionContradiction } from "./contradictions";

/**
 * 2.4-B — pure contradiction detector for a rule's conditions, written BEFORE
 * the implementation (TDD red). The PRD (35 §"Edge cases") requires the save of
 * a rule whose conditions can NEVER all be true at once to be REFUSED (e.g.
 * `total_panier >= 50` AND `total_panier <= 30`). Conditions are AND-ed, so a
 * contradiction makes the rule dead — it would never match any order.
 *
 * The detector is a pure function over the SAME `Condition[]` type the engine
 * (#29, `@packages/shared/pricing`) evaluates, so the schema, the engine and
 * this validator stay aligned. It returns a human-readable reason string when a
 * contradiction is found, else `null`.
 */

describe("2.4-B findConditionContradiction — pure validation", () => {
  it("accepts an empty condition list (the default rule matches every order)", () => {
    expect(findConditionContradiction([])).toBeNull();
  });

  it("accepts a single satisfiable threshold", () => {
    const conditions: Condition[] = [
      { kind: "total_panier", operator: "gte", valueCents: 2500 },
    ];
    expect(findConditionContradiction(conditions)).toBeNull();
  });

  it("accepts a satisfiable range (gte 30 AND lte 50)", () => {
    const conditions: Condition[] = [
      { kind: "total_panier", operator: "gte", valueCents: 3000 },
      { kind: "total_panier", operator: "lte", valueCents: 5000 },
    ];
    expect(findConditionContradiction(conditions)).toBeNull();
  });

  it("rejects the canonical PRD contradiction (total_panier >= 50 AND <= 30)", () => {
    const conditions: Condition[] = [
      { kind: "total_panier", operator: "gte", valueCents: 5000 },
      { kind: "total_panier", operator: "lte", valueCents: 3000 },
    ];
    expect(findConditionContradiction(conditions)).toMatch(/total_panier/);
  });

  it("accepts an equal-bound range (gte 30 AND lte 30 — exactly 30 satisfies)", () => {
    const conditions: Condition[] = [
      { kind: "total_panier", operator: "gte", valueCents: 3000 },
      { kind: "total_panier", operator: "lte", valueCents: 3000 },
    ];
    expect(findConditionContradiction(conditions)).toBeNull();
  });

  it("rejects a contradictory nombre_cmds_client range (gte 5 AND lte 2)", () => {
    const conditions: Condition[] = [
      { kind: "nombre_cmds_client", operator: "gte", value: 5 },
      { kind: "nombre_cmds_client", operator: "lte", value: 2 },
    ];
    expect(findConditionContradiction(conditions)).toMatch(
      /nombre_cmds_client/,
    );
  });

  it("rejects premiere_cmd_client asserted both true AND false", () => {
    const conditions: Condition[] = [
      { kind: "premiere_cmd_client", value: true },
      { kind: "premiere_cmd_client", value: false },
    ];
    expect(findConditionContradiction(conditions)).toMatch(
      /premiere_cmd_client/,
    );
  });

  it("accepts premiere_cmd_client repeated with the SAME value", () => {
    const conditions: Condition[] = [
      { kind: "premiere_cmd_client", value: true },
      { kind: "premiere_cmd_client", value: true },
    ];
    expect(findConditionContradiction(conditions)).toBeNull();
  });
});
