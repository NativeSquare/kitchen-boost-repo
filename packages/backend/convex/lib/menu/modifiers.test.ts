import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/menu/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.2-B — REUSABLE `modifierGroups` + the N-N item↔group link, written BEFORE
 * the implementation (TDD red). A group is created ONCE and attached to N items
 * (Uber Eats model); editing the group reflects on EVERY linked item; detaching
 * from one item leaves the others (and the group) intact. Bounds: minSelect ≥ 0,
 * maxSelect ≥ 1, every option priceDelta ≥ 0. ADR 0010 (tenant-scoped, fuzzed).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function makeItem(
  t: ReturnType<typeof convexTest>,
  seed: Seed,
  name: string,
): Promise<string> {
  const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
  const cat = await asManager.mutation(api.lib.menu.categories.create, {
    tenantId: seed.tenantA.tenantId,
    name: `cat-${name}`,
  });
  return asManager.mutation(api.lib.menu.items.create, {
    tenantId: seed.tenantA.tenantId,
    categoryId: cat,
    name,
    description: "",
    basePrice: 1000,
    allergens: [],
  });
}

describe("2.2-B modifierGroups (reusable) — tenant-scoped via kb_manager", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("createGroup + listGroups scoped to the calling tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Sauce",
      minSelect: 1,
      maxSelect: 1,
      options: [
        { label: "Ketchup", priceDelta: 0 },
        { label: "Bacon", priceDelta: 150 },
      ],
    });
    expect(id).toBeTypeOf("string");
    const groups = await asManager.query(api.lib.menu.modifiers.listGroups, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Sauce");
    expect(groups[0]?.minSelect).toBe(1);
    expect(groups[0]?.maxSelect).toBe(1);
    expect(groups[0]?.options).toEqual([
      { label: "Ketchup", priceDelta: 0 },
      { label: "Bacon", priceDelta: 150 },
    ]);
  });

  it("createGroup refuses minSelect < 0", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.modifiers.createGroup, {
        tenantId: seed.tenantA.tenantId,
        name: "Bad",
        minSelect: -1,
        maxSelect: 1,
        options: [{ label: "x", priceDelta: 0 }],
      }),
    ).rejects.toThrow();
  });

  it("createGroup refuses maxSelect < 1", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.modifiers.createGroup, {
        tenantId: seed.tenantA.tenantId,
        name: "Bad",
        minSelect: 0,
        maxSelect: 0,
        options: [{ label: "x", priceDelta: 0 }],
      }),
    ).rejects.toThrow();
  });

  it("createGroup refuses a negative priceDelta", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.modifiers.createGroup, {
        tenantId: seed.tenantA.tenantId,
        name: "Bad",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "x", priceDelta: -50 }],
      }),
    ).rejects.toThrow();
  });

  it("updateGroup edits a reusable group; the edit reflects on ALL linked items", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const item1 = await makeItem(t, seed, "Burger1");
    const item2 = await makeItem(t, seed, "Burger2");
    const group = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "Ketchup", priceDelta: 0 }],
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item1,
      modifierGroupId: group,
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item2,
      modifierGroupId: group,
    });

    // Edit the single shared group.
    await asManager.mutation(api.lib.menu.modifiers.updateGroup, {
      tenantId: seed.tenantA.tenantId,
      modifierGroupId: group,
      name: "Sauces",
      minSelect: 1,
      maxSelect: 2,
      options: [
        { label: "Ketchup", priceDelta: 0 },
        { label: "Mayo", priceDelta: 50 },
      ],
    });

    // Both items see the SAME, edited group (no per-item copy).
    for (const item of [item1, item2]) {
      const linked = await asManager.query(
        api.lib.menu.modifiers.listItemGroups,
        { tenantId: seed.tenantA.tenantId, itemId: item },
      );
      expect(linked).toHaveLength(1);
      expect(linked[0]?._id).toBe(group);
      expect(linked[0]?.name).toBe("Sauces");
      expect(linked[0]?.minSelect).toBe(1);
      expect(linked[0]?.maxSelect).toBe(2);
      expect(linked[0]?.options).toHaveLength(2);
    }
  });

  it("attachGroupToItem is idempotent (no duplicate edge)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const item = await makeItem(t, seed, "Burger");
    const group = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "Ketchup", priceDelta: 0 }],
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item,
      modifierGroupId: group,
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item,
      modifierGroupId: group,
    });
    const linked = await asManager.query(
      api.lib.menu.modifiers.listItemGroups,
      { tenantId: seed.tenantA.tenantId, itemId: item },
    );
    expect(linked).toHaveLength(1);
  });

  it("a group attached to 2 items appears on BOTH; listGroupItems lists them", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const item1 = await makeItem(t, seed, "Burger1");
    const item2 = await makeItem(t, seed, "Burger2");
    const group = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "Ketchup", priceDelta: 0 }],
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item1,
      modifierGroupId: group,
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item2,
      modifierGroupId: group,
    });
    const items = await asManager.query(api.lib.menu.modifiers.listGroupItems, {
      tenantId: seed.tenantA.tenantId,
      modifierGroupId: group,
    });
    expect(items.map((i) => i._id).sort()).toEqual([item1, item2].sort());
  });

  it("detachGroupFromItem removes ONE edge, leaving the other link + the group intact", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const item1 = await makeItem(t, seed, "Burger1");
    const item2 = await makeItem(t, seed, "Burger2");
    const group = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "Ketchup", priceDelta: 0 }],
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item1,
      modifierGroupId: group,
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item2,
      modifierGroupId: group,
    });

    await asManager.mutation(api.lib.menu.modifiers.detachGroupFromItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item1,
      modifierGroupId: group,
    });

    const links1 = await asManager.query(
      api.lib.menu.modifiers.listItemGroups,
      { tenantId: seed.tenantA.tenantId, itemId: item1 },
    );
    expect(links1).toEqual([]);
    const links2 = await asManager.query(
      api.lib.menu.modifiers.listItemGroups,
      { tenantId: seed.tenantA.tenantId, itemId: item2 },
    );
    expect(links2.map((g) => g._id)).toEqual([group]);
    // The group itself is NOT deleted by a detach.
    const groups = await asManager.query(api.lib.menu.modifiers.listGroups, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(groups.map((g) => g._id)).toContain(group);
  });

  it("removeGroup deletes the group AND all its edges (on every item)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const item1 = await makeItem(t, seed, "Burger1");
    const item2 = await makeItem(t, seed, "Burger2");
    const group = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "Ketchup", priceDelta: 0 }],
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item1,
      modifierGroupId: group,
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item2,
      modifierGroupId: group,
    });
    await asManager.mutation(api.lib.menu.modifiers.removeGroup, {
      tenantId: seed.tenantA.tenantId,
      modifierGroupId: group,
    });
    const groups = await asManager.query(api.lib.menu.modifiers.listGroups, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(groups.map((g) => g._id)).not.toContain(group);
    for (const item of [item1, item2]) {
      const linked = await asManager.query(
        api.lib.menu.modifiers.listItemGroups,
        { tenantId: seed.tenantA.tenantId, itemId: item },
      );
      expect(linked).toEqual([]);
    }
  });

  it("attachGroupToItem refuses a group from another tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const item = await makeItem(t, seed, "Burger");
    const bGroup = await bMgr.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantB.tenantId,
      name: "B-sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "x", priceDelta: 0 }],
    });
    await expect(
      asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
        tenantId: seed.tenantA.tenantId,
        itemId: item,
        modifierGroupId: bGroup, // foreign group
      }),
    ).rejects.toThrow();
  });

  it("attachGroupToItem refuses an item from another tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const group = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "Ketchup", priceDelta: 0 }],
    });
    const bCat = await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const bItem = await bMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "B-item",
      description: "",
      basePrice: 100,
      allergens: [],
    });
    await expect(
      asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
        tenantId: seed.tenantA.tenantId,
        itemId: bItem, // foreign item
        modifierGroupId: group,
      }),
    ).rejects.toThrow();
  });
});

describe("2.2-B cross-tenant fuzz — modifierGroups + N-N link, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemAId: string;
  let groupAId: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    itemAId = await makeItem(t, seed, "A-item");
    groupAId = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.menu.modifiers.createGroup, {
        tenantId: seed.tenantA.tenantId,
        name: "A-sauce",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "Ketchup", priceDelta: 0 }],
      });
  });

  it("every modifier mutation/query rejects every unauthorized actor on tenant A", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.menu.modifiers.listGroups,
        api.lib.menu.modifiers.listItemGroups,
        api.lib.menu.modifiers.listGroupItems,
        api.lib.menu.modifiers.createGroup,
        api.lib.menu.modifiers.updateGroup,
        api.lib.menu.modifiers.removeGroup,
        api.lib.menu.modifiers.attachGroupToItem,
        api.lib.menu.modifiers.detachGroupFromItem,
      ],
      isQuery: (fn) =>
        fn === api.lib.menu.modifiers.listGroups ||
        fn === api.lib.menu.modifiers.listItemGroups ||
        fn === api.lib.menu.modifiers.listGroupItems,
      tenantId: seed.tenantA.tenantId,
      actors,
      extraArgs: {
        modifierGroupId: groupAId,
        itemId: itemAId,
        name: "x",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "x", priceDelta: 0 }],
      },
    });
    expect(pairs).toBe(48); // 8 functions × 6 actors
    expect(leaks).toEqual([]);
  });
});
