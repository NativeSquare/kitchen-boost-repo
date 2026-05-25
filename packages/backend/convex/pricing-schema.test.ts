import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

// convex-test needs the function modules; lazy-loaded. These tests use direct db
// access only (t.run), so no function calls are made.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

/**
 * 2.4-B — `pricingRules` schema (PRD 35 §1 / §7, pricing CONTEXT, ADR 0013).
 *
 * The table is TENANT-SCOPED (carries `tenantId`) and indexed `by_tenant` — every
 * read is scoped to one tenant through the tenancy wrappers (ADR 0010). It holds
 * the configurable rule shape that ALIGNS with the pure engine
 * (`@packages/shared/pricing`, #29): `conditions` (the 6 V1 condition variants,
 * AND-ed) + one `action` (the 3 V1 action variants) + `active` + timestamps.
 * There is deliberately NO order/priority field — the engine selects the winning
 * rule deterministically (Q35-Q2 / ADR 0013).
 */
describe("2.4-B pricingRules schema — tenant-scoped table + by_tenant index", () => {
  it("round-trips a rule row and exposes the by_tenant index", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "12345678900012",
        status: "active",
        createdAt: Date.now(),
      });

      const now = Date.now();
      const ruleId = await ctx.db.insert("pricingRules", {
        tenantId,
        conditions: [
          { kind: "total_panier", operator: "gte", valueCents: 2500 },
          { kind: "jour_semaine", days: ["LU", "MA"] },
        ],
        action: { kind: "livraison_offerte_resto" },
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      const row = await ctx.db.get(ruleId);
      expect(row?.tenantId).toBe(tenantId);
      expect(row?.active).toBe(true);
      expect(row?.action.kind).toBe("livraison_offerte_resto");

      const byTenant = await ctx.db
        .query("pricingRules")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
      expect(byTenant).toHaveLength(1);
    });
  });

  it("accepts the 10% pourcentage_panier action (the onboarding default shape)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "t",
        name: "T",
        siret: "t",
        status: "active",
        createdAt: Date.now(),
      });
      const now = Date.now();
      const ruleId = await ctx.db.insert("pricingRules", {
        tenantId,
        conditions: [],
        action: {
          kind: "frais_livraison_part_resto_pourcentage_panier",
          percent: 10,
        },
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      const row = await ctx.db.get(ruleId);
      expect(row?.action).toEqual({
        kind: "frais_livraison_part_resto_pourcentage_panier",
        percent: 10,
      });
      expect(row?.conditions).toEqual([]);
    });
  });
});
