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
// the tenancy / crypto suites in 1.x-C / 1.x-E).
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
 * 2.4-B — `pricingRules` tenant-scoped CRUD + the onboarding default rule,
 * written BEFORE the implementation (TDD red). Built on the tenancy wrappers
 * (1.x-C): every CRUD goes through `tenantQuery` / `tenantMutation`
 * (`allow: ["kb_manager"]`), strictly scoped to `ctx.tenantId` — no raw
 * `ctx.db.query("pricingRules")` in this business module (the `no-untenanted-query`
 * rule is active, ADR 0010). The rule shape (conditions/actions) aligns with the
 * pure engine in `@packages/shared/pricing` (#29). No UI (backend-only, ADR 0013).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.4-B pricingRules CRUD — tenant-scoped via kb_manager wrappers", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("create + list a rule scoped to the calling tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    const id = await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [{ kind: "total_panier", operator: "gte", valueCents: 2500 }],
      action: { kind: "livraison_offerte_resto" },
    });
    expect(id).toBeTypeOf("string");

    const rules = await asManager.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]?._id).toBe(id);
    expect(rules[0]?.active).toBe(true); // created active by default
    expect(rules[0]?.action.kind).toBe("livraison_offerte_resto");
    expect(rules[0]?.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("list returns ONLY the calling tenant's rules (isolation by index)", async () => {
    const aMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });

    await aMgr.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [],
      action: { kind: "frais_livraison_part_resto_fixe", valueCents: 300 },
    });
    await bMgr.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantB.tenantId,
      conditions: [],
      action: { kind: "livraison_offerte_resto" },
    });

    const aRules = await aMgr.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantA.tenantId,
    });
    const bRules = await bMgr.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(aRules).toHaveLength(1);
    expect(bRules).toHaveLength(1);
    expect(aRules[0]?.action.kind).toBe("frais_livraison_part_resto_fixe");
    expect(bRules[0]?.action.kind).toBe("livraison_offerte_resto");
  });

  it("update replaces conditions + action on the tenant's own rule", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [],
      action: { kind: "livraison_offerte_resto" },
    });

    await asManager.mutation(api.lib.pricing.rules.update, {
      tenantId: seed.tenantA.tenantId,
      ruleId: id,
      conditions: [{ kind: "premiere_cmd_client", value: true }],
      action: {
        kind: "frais_livraison_part_resto_pourcentage_panier",
        percent: 25,
      },
    });

    const rules = await asManager.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rules[0]?.action).toEqual({
      kind: "frais_livraison_part_resto_pourcentage_panier",
      percent: 25,
    });
    expect(rules[0]?.conditions).toEqual([
      { kind: "premiere_cmd_client", value: true },
    ]);
  });

  it("setActive toggles active without deleting the rule", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [],
      action: { kind: "livraison_offerte_resto" },
    });

    await asManager.mutation(api.lib.pricing.rules.setActive, {
      tenantId: seed.tenantA.tenantId,
      ruleId: id,
      active: false,
    });
    let rules = await asManager.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rules).toHaveLength(1); // still there, just inactive
    expect(rules[0]?.active).toBe(false);

    await asManager.mutation(api.lib.pricing.rules.setActive, {
      tenantId: seed.tenantA.tenantId,
      ruleId: id,
      active: true,
    });
    rules = await asManager.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rules[0]?.active).toBe(true);
  });

  it("remove deletes the tenant's own rule", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [],
      action: { kind: "livraison_offerte_resto" },
    });
    await asManager.mutation(api.lib.pricing.rules.remove, {
      tenantId: seed.tenantA.tenantId,
      ruleId: id,
    });
    const rules = await asManager.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rules).toEqual([]);
  });

  it("a kb_admin (root) can CRUD on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantB.tenantId,
      conditions: [],
      action: { kind: "livraison_offerte_resto" },
    });
    const rules = await asAdmin.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(rules.map((r) => r._id)).toContain(id);
  });
});

describe("2.4-B contradictory conditions refused at save (PRD 35 edge case)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("create refuses a rule with total_panier >= 50 AND <= 30", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.pricing.rules.create, {
          tenantId: seed.tenantA.tenantId,
          conditions: [
            { kind: "total_panier", operator: "gte", valueCents: 5000 },
            { kind: "total_panier", operator: "lte", valueCents: 3000 },
          ],
          action: { kind: "livraison_offerte_resto" },
        }),
    ).rejects.toThrow(/contradict/i);
  });

  it("update refuses moving an existing rule into a contradiction", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.pricing.rules.create, {
      tenantId: seed.tenantA.tenantId,
      conditions: [],
      action: { kind: "livraison_offerte_resto" },
    });
    await expect(
      asManager.mutation(api.lib.pricing.rules.update, {
        tenantId: seed.tenantA.tenantId,
        ruleId: id,
        conditions: [
          { kind: "nombre_cmds_client", operator: "gte", value: 5 },
          { kind: "nombre_cmds_client", operator: "lte", value: 2 },
        ],
        action: { kind: "livraison_offerte_resto" },
      }),
    ).rejects.toThrow(/contradict/i);
    // the original rule is untouched (the contradictory update was rejected).
    const rules = await asManager.query(api.lib.pricing.rules.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rules[0]?.conditions).toEqual([]);
  });
});

describe("2.4-B onboarding default rule (10% panier, no condition, active)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("installs the default rule: 10% pourcentage_panier, conditions=[], active", async () => {
    // The helper is the seam the onboarding wizard (2.9) calls; drive it through
    // a mutation context so it persists, then read back via the public list.
    await t.run(async (ctx) => {
      const { installDefaultPricingRule } = await import("./defaultRule");
      await installDefaultPricingRule(ctx, seed.tenantA.tenantId);
    });

    const rules = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.pricing.rules.list, { tenantId: seed.tenantA.tenantId });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.active).toBe(true);
    expect(rules[0]?.conditions).toEqual([]);
    expect(rules[0]?.action).toEqual({
      kind: "frais_livraison_part_resto_pourcentage_panier",
      percent: 10,
    });
  });

  it("installs the default rule ONLY on the target tenant (isolation)", async () => {
    await t.run(async (ctx) => {
      const { installDefaultPricingRule } = await import("./defaultRule");
      await installDefaultPricingRule(ctx, seed.tenantA.tenantId);
    });
    const bRules = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.pricing.rules.list, { tenantId: seed.tenantB.tenantId });
    expect(bRules).toEqual([]);
  });
});

describe("2.4-B cross-tenant fuzz — pricingRules CRUD, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let ruleAId: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Seed a rule on tenant A so the read/update/delete paths have a target to
    // (not) leak.
    ruleAId = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.pricing.rules.create, {
        tenantId: seed.tenantA.tenantId,
        conditions: [],
        action: { kind: "livraison_offerte_resto" },
      });
  });

  it("every CRUD rejects every unauthorized actor on tenant A", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not in allow-list
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.pricing.rules.list,
        api.lib.pricing.rules.create,
        api.lib.pricing.rules.update,
        api.lib.pricing.rules.setActive,
        api.lib.pricing.rules.remove,
      ],
      isQuery: (fn) => fn === api.lib.pricing.rules.list,
      tenantId: seed.tenantA.tenantId,
      actors,
      // Args the write functions need (merged into every call). The ruleId points
      // at tenant A's rule — an attacker must STILL be refused before touching it.
      extraArgs: {
        ruleId: ruleAId,
        conditions: [],
        action: { kind: "livraison_offerte_resto" },
        active: false,
      },
    });
    expect(pairs).toBe(30); // 5 functions × 6 actors
    expect(leaks).toEqual([]);
  });

  it("a manager of tenant B cannot read tenant A's rules", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .query(api.lib.pricing.rules.list, { tenantId: seed.tenantA.tenantId }),
    ).rejects.toThrow(/forbidden/i);
  });
});
