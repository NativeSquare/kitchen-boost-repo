import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { ALLERGENS_UE_1169 } from "./table/menuItems";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "./lib/tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives at
// the convex root, so the same-dir keys are already "./x" — no key normalisation
// is needed (unlike the suites nested under convex/lib/**).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

/**
 * 2.2-A — Menu schema (PRD 10 §5/§6, client-ordering CONTEXT, delivery CONTEXT
 * "Plage horaire de service", ADR 0010), written BEFORE the implementation (TDD
 * red). Schema-only slice: this lays the 5 tenant-scoped tables + indexes that
 * every later 2.2 slice (CRUD #51, getPublicMenu #52, availability #56,
 * serviceHours #53) builds on. No business function is exported by this slice —
 * the only Convex functions touching these tables are the test-only tenancy
 * probes in `lib/tenancy/_probes.ts` (the exempt sanctioned path), driven by the
 * cross-tenant fuzz harness below to prove the tables are reachable ONLY through
 * the tenancy wrappers (ADR 0010), never raw `ctx.db.query()` in business code.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.2-A schema — menu tables round-trip + indexes", () => {
  it("round-trips a menuCategories row and exposes by_tenant", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "12345678900012",
        status: "active",
        createdAt: Date.now(),
      });
      const catId = await ctx.db.insert("menuCategories", {
        tenantId,
        name: "Smashs",
        order: 0,
        createdAt: Date.now(),
      });
      expect((await ctx.db.get(catId))?.name).toBe("Smashs");

      const byTenant = await ctx.db
        .query("menuCategories")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
      expect(byTenant).toHaveLength(1);
    });
  });

  it("round-trips a menuItems row with allergens + exposes by_tenant, by_category", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "bb",
        name: "BB",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const categoryId = await ctx.db.insert("menuCategories", {
        tenantId,
        name: "Smashs",
        order: 0,
        createdAt: Date.now(),
      });
      const itemId = await ctx.db.insert("menuItems", {
        tenantId,
        categoryId,
        name: "Smash Double",
        description: "Double steak, cheddar",
        basePrice: 1290, // cents
        allergens: ["gluten", "lait", "moutarde"],
        available: true,
        order: 0,
        createdAt: Date.now(),
      });
      const row = await ctx.db.get(itemId);
      expect(row?.basePrice).toBe(1290);
      expect(row?.allergens).toEqual(["gluten", "lait", "moutarde"]);

      const byTenant = await ctx.db
        .query("menuItems")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
      expect(byTenant).toHaveLength(1);

      const byCategory = await ctx.db
        .query("menuItems")
        .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
        .collect();
      expect(byCategory).toHaveLength(1);
    });
  });

  it("accepts a MINIMAL menuItems row (optional photo / description / unavailableSince omitted)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "bb",
        name: "BB",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const categoryId = await ctx.db.insert("menuCategories", {
        tenantId,
        name: "Boissons",
        order: 1,
        createdAt: Date.now(),
      });
      const itemId = await ctx.db.insert("menuItems", {
        tenantId,
        categoryId,
        name: "Coca",
        description: "",
        basePrice: 250,
        allergens: [],
        available: true,
        order: 0,
        createdAt: Date.now(),
      });
      const row = await ctx.db.get(itemId);
      expect(row?.photoStorageId).toBeUndefined();
      expect(row?.unavailableSince).toBeUndefined();
      expect(row?.allergens).toEqual([]);
    });
  });

  it("round-trips a modifierGroups row (reusable, min/max + options) and exposes by_tenant", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "bb",
        name: "BB",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const groupId = await ctx.db.insert("modifierGroups", {
        tenantId,
        name: "Sauce",
        minSelect: 1, // ≥1 ⇒ mandatory
        maxSelect: 1, // 1 ⇒ single-choice
        options: [
          { label: "Ketchup", priceDelta: 0 },
          { label: "Sauce maison", priceDelta: 50 },
        ],
        createdAt: Date.now(),
      });
      const row = await ctx.db.get(groupId);
      expect(row?.minSelect).toBe(1);
      expect(row?.maxSelect).toBe(1);
      expect(row?.options[1]).toEqual({
        label: "Sauce maison",
        priceDelta: 50,
      });

      const byTenant = await ctx.db
        .query("modifierGroups")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
      expect(byTenant).toHaveLength(1);
    });
  });

  it("accepts an OPTIONAL modifier group (minSelect 0) with multi-select", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "bb",
        name: "BB",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const groupId = await ctx.db.insert("modifierGroups", {
        tenantId,
        name: "Suppléments",
        minSelect: 0, // 0 ⇒ optional
        maxSelect: 3, // ≥1 ⇒ multi-choice
        options: [
          { label: "Bacon", priceDelta: 150 },
          { label: "Œuf", priceDelta: 100 },
        ],
        createdAt: Date.now(),
      });
      expect((await ctx.db.get(groupId))?.minSelect).toBe(0);
    });
  });

  it("links item ↔ group N-N via menuItemModifierGroups (by_item, by_group, by_item_group)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "bb",
        name: "BB",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const categoryId = await ctx.db.insert("menuCategories", {
        tenantId,
        name: "Smashs",
        order: 0,
        createdAt: Date.now(),
      });
      const itemId = await ctx.db.insert("menuItems", {
        tenantId,
        categoryId,
        name: "Smash Double",
        description: "",
        basePrice: 1290,
        allergens: [],
        available: true,
        order: 0,
        createdAt: Date.now(),
      });
      const groupId = await ctx.db.insert("modifierGroups", {
        tenantId,
        name: "Sauce",
        minSelect: 1,
        maxSelect: 1,
        options: [{ label: "Ketchup", priceDelta: 0 }],
        createdAt: Date.now(),
      });
      // The SAME group reused on a second item (Uber Eats reusability).
      const itemId2 = await ctx.db.insert("menuItems", {
        tenantId,
        categoryId,
        name: "Smash Simple",
        description: "",
        basePrice: 990,
        allergens: [],
        available: true,
        order: 1,
        createdAt: Date.now(),
      });
      const linkId = await ctx.db.insert("menuItemModifierGroups", {
        tenantId,
        itemId,
        modifierGroupId: groupId,
        order: 0,
      });
      await ctx.db.insert("menuItemModifierGroups", {
        tenantId,
        itemId: itemId2,
        modifierGroupId: groupId,
        order: 0,
      });

      // by_item — the groups attached to ONE item.
      const byItem = await ctx.db
        .query("menuItemModifierGroups")
        .withIndex("by_item", (q) => q.eq("itemId", itemId))
        .collect();
      expect(byItem).toHaveLength(1);

      // by_group — the items reusing ONE group (proves reusability N-N).
      const byGroup = await ctx.db
        .query("menuItemModifierGroups")
        .withIndex("by_group", (q) => q.eq("modifierGroupId", groupId))
        .collect();
      expect(byGroup).toHaveLength(2);

      // by_item_group — the unique (item, group) edge.
      const edge = await ctx.db
        .query("menuItemModifierGroups")
        .withIndex("by_item_group", (q) =>
          q.eq("itemId", itemId).eq("modifierGroupId", groupId),
        )
        .unique();
      expect(edge?._id).toBe(linkId);
    });
  });

  it("round-trips a serviceHours row (windows shared delivery + C&C) and exposes by_tenant", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "bb",
        name: "BB",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      // Buns & Bao example: 11h30–14h30 (690–870) + 18h30–22h30 (1110–1350),
      // Mon–Fri. Single shared slot delivery + C&C (Q40-Q acté 2026-05-24).
      const shId = await ctx.db.insert("serviceHours", {
        tenantId,
        windows: [
          { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
          { dayOfWeek: 1, startMinute: 1110, endMinute: 1350 },
          { dayOfWeek: 2, startMinute: 690, endMinute: 870 },
        ],
        updatedAt: Date.now(),
      });
      const row = await ctx.db.get(shId);
      expect(row?.windows).toHaveLength(3);
      expect(row?.windows[0]).toEqual({
        dayOfWeek: 1,
        startMinute: 690,
        endMinute: 870,
      });

      const byTenant = await ctx.db
        .query("serviceHours")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .unique();
      expect(byTenant?._id).toBe(shId);
    });
  });
});

describe("2.2-A allergens — frozen UE 1169/2011 set (14 literals, not free text)", () => {
  it("freezes exactly the 14 UE 1169/2011 allergens", () => {
    expect(ALLERGENS_UE_1169).toEqual([
      "gluten",
      "crustacés",
      "œufs",
      "poissons",
      "arachides",
      "soja",
      "lait",
      "fruits à coque",
      "céleri",
      "moutarde",
      "graines de sésame",
      "sulfites",
      "lupin",
      "mollusques",
    ]);
    expect(ALLERGENS_UE_1169).toHaveLength(14);
  });

  it("rejects an allergen value outside the frozen set (literal union, not free string)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const tenantId = await ctx.db.insert("tenants", {
        slug: "bb",
        name: "BB",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const categoryId = await ctx.db.insert("menuCategories", {
        tenantId,
        name: "Smashs",
        order: 0,
        createdAt: Date.now(),
      });
      await expect(
        ctx.db.insert("menuItems", {
          tenantId,
          categoryId,
          name: "X",
          description: "",
          basePrice: 100,
          // @ts-expect-error — "noix" is NOT one of the 14 frozen UE allergens.
          allergens: ["noix"],
          available: true,
          order: 0,
          createdAt: Date.now(),
        }),
      ).rejects.toThrow();
    });
  });
});

/**
 * Cross-tenant fuzz — every menu table carries `tenantId` (ADR 0010). The
 * schema slice exports NO business function, so the fuzzed surface is the set of
 * test-only tenancy probes that read each menu table through `tenantQuery`
 * (keyed on `ctx.tenantId`). Every unauthorized actor MUST be thrown out
 * (Forbidden) before any row is read — a returning call is a leak.
 */
describe("2.2-A cross-tenant fuzz — menu probes reject unauthorized tenants", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("menu readers reject actors without access to the tenant under attack", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.tenancy._probes.tenantMenuCategoriesProbe,
        api.lib.tenancy._probes.tenantMenuItemsProbe,
        api.lib.tenancy._probes.tenantModifierGroupsProbe,
        api.lib.tenancy._probes.tenantMenuItemModifierGroupsProbe,
        api.lib.tenancy._probes.tenantServiceHoursProbe,
      ],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(pairs).toBe(20); // 5 probes × 4 actors
    expect(leaks).toEqual([]);
  });

  it("a kb_manager of tenant A CAN read its OWN menu via the probes", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    const cats = await asA.query(
      api.lib.tenancy._probes.tenantMenuCategoriesProbe,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(Array.isArray(cats)).toBe(true);
    const sh = await asA.query(
      api.lib.tenancy._probes.tenantServiceHoursProbe,
      {
        tenantId: seed.tenantA.tenantId,
      },
    );
    expect(Array.isArray(sh)).toBe(true);
  });
});
