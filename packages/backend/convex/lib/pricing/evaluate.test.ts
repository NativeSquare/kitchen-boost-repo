import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/pricing/, so normalise every key to be relative to the convex root
// (../../) so convex-test's findModulesRoot has ONE common prefix (same shape as
// the rules / tenancy suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/pricing/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.4-C — backend `evaluate` query (PRD 35 §3, ADR 0013, ADR 0010), written
 * BEFORE the implementation (TDD red).
 *
 * `evaluate` is the ONLY way the front gets a price: it sends its cart + context
 * (items, subtotal, datetime, customer counters, gross Uber Direct cost), the
 * backend loads the tenant's ACTIVE rules (#32) through the sanctioned tenancy
 * seam, feeds the pure engine (#29) and returns ONLY the computed price (winning
 * rule id + client/resto split). The front NEVER receives the rules or the
 * formula — the pure module is never imported by `apps/web` (ADR 0013).
 *
 * Indicative (cart) vs. definitive (latching, at "Payer") is the SAME query
 * re-called by the front; the backend writes nothing on the order here (the
 * pricing trace is frozen at payment — chantier 2.3). The customer counters
 * (#16) and menu items (#17) are NOT yet wired at runtime; until then they are
 * supplied as call arguments / fixtures (issue #39 "Blocked by" note).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

// A fixed Tuesday 13:00 local time, supplied as epoch ms (Convex args carry no
// Date). Tuesday so a `jour_semaine: ["MA"]` rule can match deterministically.
const TUESDAY_13H_MS = new Date(2026, 4, 26, 13, 0, 0).getTime();

/** The non-tenant args every evaluate call needs, with sensible defaults. */
function ctxArgs(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ itemId: "i1", category: "burger", quantity: 1 }],
    totalPanierCents: 3000,
    orderDateTimeMs: TUESDAY_13H_MS,
    customer: { isFirstOrder: false, orderCount: 3 },
    grossDeliveryCostCents: 590,
    ...overrides,
  };
}

describe("2.4-C evaluate — assembles engine input + returns price (no front eval)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no rule configured → fallback: client pays the full gross cost", async () => {
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.pricing.evaluate.evaluate, {
        tenantId: seed.tenantA.tenantId,
        ...ctxArgs(),
      });
    expect(res.winningRuleId).toBeNull();
    expect(res.fraisLivraisonClientCents).toBe(590);
    expect(res.fraisLivraisonRestoCents).toBe(0);
  });

  it("loads the tenant's active rule and returns the engine's split (10% default)", async () => {
    // Install the onboarding default (10% of cart absorbed by resto).
    await t.run(async (ctx) => {
      const { installDefaultPricingRule } = await import("./defaultRule");
      await installDefaultPricingRule(ctx, seed.tenantA.tenantId);
    });

    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.pricing.evaluate.evaluate, {
        tenantId: seed.tenantA.tenantId,
        ...ctxArgs({ totalPanierCents: 3000, grossDeliveryCostCents: 590 }),
      });
    // 10% of 3000 = 300 absorbed by resto (≤ gross), client pays 590-300=290.
    expect(res.winningRuleId).not.toBeNull();
    expect(res.fraisLivraisonRestoCents).toBe(300);
    expect(res.fraisLivraisonClientCents).toBe(290);
  });

  it("returns ONLY the price — never the rules/conditions/action (ADR 0013)", async () => {
    await t.run(async (ctx) => {
      const { installDefaultPricingRule } = await import("./defaultRule");
      await installDefaultPricingRule(ctx, seed.tenantA.tenantId);
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.pricing.evaluate.evaluate, {
        tenantId: seed.tenantA.tenantId,
        ...ctxArgs(),
      });
    expect(Object.keys(res).sort()).toEqual([
      "fraisLivraisonClientCents",
      "fraisLivraisonRestoCents",
      "winningRuleId",
    ]);
    // No rule body (conditions / action) leaks into the output.
    expect(res).not.toHaveProperty("conditions");
    expect(res).not.toHaveProperty("action");
    expect(res).not.toHaveProperty("rules");
  });

  it("INACTIVE rules are excluded from evaluation", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // A "free delivery over 25€" rule, then deactivate it.
    const ruleId = await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [{ kind: "total_panier", operator: "gte", valueCents: 2500 }],
      action: { kind: "livraison_offerte_resto" },
    });
    await asManager.mutation(api.lib.pricing.rules.setActive, {
      tenantId: seed.tenantA.tenantId,
      ruleId,
      active: false,
    });

    const res = await asManager.query(api.lib.pricing.evaluate.evaluate, {
      tenantId: seed.tenantA.tenantId,
      ...ctxArgs({ totalPanierCents: 3000 }),
    });
    // Inactive → not evaluated → fallback (client pays full gross).
    expect(res.winningRuleId).toBeNull();
    expect(res.fraisLivraisonClientCents).toBe(590);
  });

  it("winning rule = the one that minimises the client fee (Q35-Q2, determinism)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Rule A: ≥ 25€ → free delivery (resto absorbs full 590, client 0).
    const ruleA = await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [{ kind: "total_panier", operator: "gte", valueCents: 2500 }],
      action: { kind: "livraison_offerte_resto" },
    });
    // Rule B: ≥ 25€ → resto absorbs a fixed 2,00€ (client pays 3,90€).
    await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [{ kind: "total_panier", operator: "gte", valueCents: 2500 }],
      action: { kind: "frais_livraison_part_resto_fixe", valueCents: 200 },
    });

    const res = await asManager.query(api.lib.pricing.evaluate.evaluate, {
      tenantId: seed.tenantA.tenantId,
      ...ctxArgs({ totalPanierCents: 3000, grossDeliveryCostCents: 590 }),
    });
    // A minimises the client fee (0 < 390) → A wins.
    expect(res.winningRuleId).toBe(ruleA);
    expect(res.fraisLivraisonClientCents).toBe(0);
    expect(res.fraisLivraisonRestoCents).toBe(590);
  });

  it("conditions on cart/context are evaluated (jour_semaine + premiere_cmd)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Free delivery for a first order on a Tuesday.
    await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [
        { kind: "premiere_cmd_client", value: true },
        { kind: "jour_semaine", days: ["MA"] },
      ],
      action: { kind: "livraison_offerte_resto" },
    });

    // First order on the seeded Tuesday → matches.
    const match = await asManager.query(api.lib.pricing.evaluate.evaluate, {
      tenantId: seed.tenantA.tenantId,
      ...ctxArgs({ customer: { isFirstOrder: true, orderCount: 0 } }),
    });
    expect(match.fraisLivraisonClientCents).toBe(0);

    // Not a first order → no match → fallback.
    const noMatch = await asManager.query(api.lib.pricing.evaluate.evaluate, {
      tenantId: seed.tenantA.tenantId,
      ...ctxArgs({ customer: { isFirstOrder: false, orderCount: 5 } }),
    });
    expect(noMatch.winningRuleId).toBeNull();
    expect(noMatch.fraisLivraisonClientCents).toBe(590);
  });

  it("invariant client + resto = gross cost holds (any rule/percentage)", async () => {
    await t.run(async (ctx) => {
      const { installDefaultPricingRule } = await import("./defaultRule");
      await installDefaultPricingRule(ctx, seed.tenantA.tenantId);
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.pricing.evaluate.evaluate, {
        tenantId: seed.tenantA.tenantId,
        ...ctxArgs({ totalPanierCents: 1234, grossDeliveryCostCents: 590 }),
      });
    expect(res.fraisLivraisonClientCents + res.fraisLivraisonRestoCents).toBe(
      590,
    );
  });

  it("latching: re-evaluating the same cart/context returns the same price", async () => {
    await t.run(async (ctx) => {
      const { installDefaultPricingRule } = await import("./defaultRule");
      await installDefaultPricingRule(ctx, seed.tenantA.tenantId);
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const args = { tenantId: seed.tenantA.tenantId, ...ctxArgs() };
    const indicative = await asManager.query(
      api.lib.pricing.evaluate.evaluate,
      args,
    );
    const definitive = await asManager.query(
      api.lib.pricing.evaluate.evaluate,
      args,
    );
    expect(definitive).toEqual(indicative);
  });

  it("evaluates ONLY the calling tenant's rules (B's rules never leak into A)", async () => {
    // B has a free-delivery rule; A has none. Evaluating on A must NOT see B's.
    await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .mutation(api.lib.pricing.rules.create, {
        tenantId: seed.tenantB.tenantId,
        conditions: [],
        action: { kind: "livraison_offerte_resto" },
      });

    const onA = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.pricing.evaluate.evaluate, {
        tenantId: seed.tenantA.tenantId,
        ...ctxArgs(),
      });
    expect(onA.winningRuleId).toBeNull(); // A has no rule of its own
    expect(onA.fraisLivraisonClientCents).toBe(590);
  });
});

describe("2.4-C cross-tenant fuzz — evaluate, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Seed a rule on A so there is something an attacker could try to price against.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.pricing.rules.create, {
        tenantId: seed.tenantA.tenantId,
        conditions: [],
        action: { kind: "livraison_offerte_resto" },
      });
  });

  it("evaluate rejects every unauthorized actor replaying tenant A's id", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not in allow-list
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.pricing.evaluate.evaluate],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
      extraArgs: ctxArgs(),
    });
    expect(pairs).toBe(6); // 1 function × 6 actors
    expect(leaks).toEqual([]);
  });

  it("a manager of tenant B cannot evaluate against tenant A", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .query(api.lib.pricing.evaluate.evaluate, {
          tenantId: seed.tenantA.tenantId,
          ...ctxArgs(),
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});
