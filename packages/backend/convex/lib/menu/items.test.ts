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
 * 2.2-B — `menuItems` tenant-scoped CRUD, written BEFORE the implementation
 * (TDD red). Items carry a category, basePrice (centimes), a subset of the 14
 * frozen UE 1169/2011 allergens, an availability toggle, and an optional photo.
 * Deleting an item cleans up its N-N modifier links (and stored photo) WITHOUT
 * touching the shared group. ADR 0010 (tenant-scoped, fuzzed).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function makeCategory(
  t: ReturnType<typeof convexTest>,
  seed: Seed,
): Promise<string> {
  return t
    .withIdentity({ subject: seed.tenantA.managerId })
    .mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
}

describe("2.2-B menuItems CRUD — tenant-scoped via kb_manager", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let catA: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    catA = await makeCategory(t, seed);
  });

  it("create an item with allergens + list it (created available, ordered)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Smash Double",
      description: "Double steak, cheddar",
      basePrice: 1290,
      allergens: ["gluten", "lait"],
    });
    expect(id).toBeTypeOf("string");

    const items = await asManager.query(api.lib.menu.items.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?._id).toBe(id);
    expect(items[0]?.name).toBe("Smash Double");
    expect(items[0]?.basePrice).toBe(1290);
    expect(items[0]?.allergens).toEqual(["gluten", "lait"]);
    expect(items[0]?.available).toBe(true); // created available
    expect(items[0]?.categoryId).toBe(catA);
    expect(items[0]?.order).toBe(0);
  });

  it("create refuses a categoryId owned by another tenant", async () => {
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      bMgr.mutation(api.lib.menu.items.create, {
        tenantId: seed.tenantB.tenantId,
        categoryId: catA, // belongs to tenant A
        name: "x",
        description: "",
        basePrice: 100,
        allergens: [],
      }),
    ).rejects.toThrow();
  });

  it("create refuses a negative basePrice", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.items.create, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        name: "x",
        description: "",
        basePrice: -1,
        allergens: [],
      }),
    ).rejects.toThrow();
  });

  it("update edits fields of the tenant's own item", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Smash Double",
      description: "",
      basePrice: 1290,
      allergens: ["gluten"],
    });
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId: id,
      name: "Smash Triple",
      description: "Triple steak",
      basePrice: 1590,
      allergens: ["gluten", "œufs"],
      available: false,
    });
    const items = await asManager.query(api.lib.menu.items.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(items[0]?.name).toBe("Smash Triple");
    expect(items[0]?.basePrice).toBe(1590);
    expect(items[0]?.allergens).toEqual(["gluten", "œufs"]);
    expect(items[0]?.available).toBe(false);
  });

  it("update can move an item to another category of the same tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat2 = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Sides",
    });
    const id = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Frites",
      description: "",
      basePrice: 390,
      allergens: [],
    });
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId: id,
      name: "Frites",
      description: "",
      basePrice: 390,
      allergens: [],
      available: true,
      categoryId: cat2,
    });
    const items = await asManager.query(api.lib.menu.items.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(items[0]?.categoryId).toBe(cat2);
  });

  it("update refuses moving an item into another tenant's category", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const bCat = await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const id = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "x",
      description: "",
      basePrice: 100,
      allergens: [],
    });
    await expect(
      asManager.mutation(api.lib.menu.items.update, {
        tenantId: seed.tenantA.tenantId,
        itemId: id,
        name: "x",
        description: "",
        basePrice: 100,
        allergens: [],
        available: true,
        categoryId: bCat, // foreign category
      }),
    ).rejects.toThrow();
  });

  it("listByCategory returns only that category's items", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat2 = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Sides",
    });
    await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Burger",
      description: "",
      basePrice: 1000,
      allergens: [],
    });
    await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat2,
      name: "Frites",
      description: "",
      basePrice: 390,
      allergens: [],
    });
    const sides = await asManager.query(api.lib.menu.items.listByCategory, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat2,
    });
    expect(sides).toHaveLength(1);
    expect(sides[0]?.name).toBe("Frites");
  });

  it("remove deletes the item AND its N-N modifier links, without touching the shared group", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const item1 = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Burger 1",
      description: "",
      basePrice: 1000,
      allergens: [],
    });
    const item2 = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Burger 2",
      description: "",
      basePrice: 1000,
      allergens: [],
    });
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

    await asManager.mutation(api.lib.menu.items.remove, {
      tenantId: seed.tenantA.tenantId,
      itemId: item1,
    });

    const items = await asManager.query(api.lib.menu.items.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(items.map((i) => i._id)).toEqual([item2]);
    // item1's edges are cascade-deleted (read the link table directly — listing
    // groups of a now-deleted item legitimately throws NOT_FOUND).
    const item1Edges = await t.run(async (ctx) =>
      ctx.db
        .query("menuItemModifierGroups")
        .withIndex("by_item", (q) => q.eq("itemId", item1 as never))
        .collect(),
    );
    expect(item1Edges).toEqual([]);
    // …but item2 still has the group, and the group itself survives.
    const links2 = await asManager.query(
      api.lib.menu.modifiers.listItemGroups,
      {
        tenantId: seed.tenantA.tenantId,
        itemId: item2,
      },
    );
    expect(links2.map((g) => g._id)).toEqual([group]);
    const groups = await asManager.query(api.lib.menu.modifiers.listGroups, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(groups.map((g) => g._id)).toContain(group);
  });

  it("remove deletes the stored photo when present", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Seed a stored blob + an item referencing it.
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["png-bytes"])),
    );
    const itemId = await t.run(async (ctx) =>
      ctx.db.insert("menuItems", {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA as never,
        name: "Photo item",
        description: "",
        basePrice: 500,
        photoStorageId: storageId,
        allergens: [],
        available: true,
        order: 0,
        createdAt: Date.now(),
      }),
    );
    await asManager.mutation(api.lib.menu.items.remove, {
      tenantId: seed.tenantA.tenantId,
      itemId,
    });
    // The blob is gone from storage.
    const stillThere = await t.run(async (ctx) =>
      ctx.storage.getUrl(storageId),
    );
    expect(stillThere).toBeNull();
  });

  it("a kb_admin (root) can CRUD on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const bCat = await asAdmin.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const id = await asAdmin.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "root-item",
      description: "",
      basePrice: 100,
      allergens: [],
    });
    const items = await asAdmin.query(api.lib.menu.items.list, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(items.map((i) => i._id)).toContain(id);
  });
});

describe("2.2-B cross-tenant fuzz — menuItems CRUD, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let catA: string;
  let itemAId: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    catA = await makeCategory(t, seed);
    itemAId = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.menu.items.create, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        name: "A-item",
        description: "",
        basePrice: 1000,
        allergens: [],
      });
  });

  it("every item mutation/query rejects every unauthorized actor on tenant A", async () => {
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
        api.lib.menu.items.list,
        api.lib.menu.items.listByCategory,
        api.lib.menu.items.create,
        api.lib.menu.items.update,
        api.lib.menu.items.reorder,
        api.lib.menu.items.remove,
      ],
      isQuery: (fn) =>
        fn === api.lib.menu.items.list ||
        fn === api.lib.menu.items.listByCategory,
      tenantId: seed.tenantA.tenantId,
      actors,
      extraArgs: {
        itemId: itemAId,
        categoryId: catA,
        name: "x",
        description: "",
        basePrice: 100,
        allergens: [],
        available: true,
        orderedIds: [itemAId],
      },
    });
    expect(pairs).toBe(36); // 6 functions × 6 actors
    expect(leaks).toEqual([]);
  });
});

/**
 * B-MENU-PUBLICATION slice 7 (D3, #209) — `items.reorder` is the strict mirror
 * of `categories.reorder` (cf. `categories.test.ts`): it rewrites the `order`
 * field of every item of ONE category in a single atomic mutation tx, and
 * refuses anything other than a permutation of EXACTLY that category's items
 * (no silent partial, no duplicate, no foreign id). ADR 0010 cross-tenant
 * isolation, ADR 0015 « éditeur brouillon » (the reorder writes the draft, not
 * the snapshot — republication is a separate user action).
 */
describe("B-MENU-PUBLICATION slice 7 — items.reorder strictness", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let catA: string;
  let cat2: string;
  let i1: string;
  let i2: string;
  let i3: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    catA = await makeCategory(t, seed);
    cat2 = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Sides",
    });
    i1 = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Burger 1",
      description: "",
      basePrice: 1000,
      allergens: [],
    });
    i2 = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Burger 2",
      description: "",
      basePrice: 1100,
      allergens: [],
    });
    i3 = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      name: "Burger 3",
      description: "",
      basePrice: 1200,
      allergens: [],
    });
  });

  it("rewrites the display order of the category's items to match orderedIds", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // New order: i3, i1, i2
    await asManager.mutation(api.lib.menu.items.reorder, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      orderedIds: [i3, i1, i2],
    });
    const items = await asManager.query(api.lib.menu.items.listByCategory, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
    });
    expect(items.map((i) => i._id)).toEqual([i3, i1, i2]);
    expect(items.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it("throws on a partial orderedIds (missing one item of the category)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.items.reorder, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        orderedIds: [i1, i2], // i3 missing
      }),
    ).rejects.toThrow();
  });

  it("throws on a duplicate in orderedIds", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.items.reorder, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        orderedIds: [i1, i2, i1], // i1 twice, i3 absent
      }),
    ).rejects.toThrow();
  });

  it("throws on an itemId from ANOTHER category of the same tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const otherCatItem = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat2,
      name: "Frites",
      description: "",
      basePrice: 390,
      allergens: [],
    });
    // Wrong-category item: same length (3) as catA's items, but one of them
    // does NOT belong to catA — must throw INVALID_REORDER.
    await expect(
      asManager.mutation(api.lib.menu.items.reorder, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        orderedIds: [i1, i2, otherCatItem],
      }),
    ).rejects.toThrow();
  });

  it("throws NOT_FOUND for a foreign categoryId (owned by another tenant)", async () => {
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const bCat = await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.items.reorder, {
        tenantId: seed.tenantA.tenantId,
        categoryId: bCat,
        orderedIds: [],
      }),
    ).rejects.toThrow();
  });

  it("throws NOT_FOUND when orderedIds contains an item from another tenant", async () => {
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const bCat = await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const bItem = await bMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "B-item",
      description: "",
      basePrice: 1000,
      allergens: [],
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // catA has 3 items; we replace one with a foreign-tenant item id. The
    // helper must reject — `bItem` is not even reachable from tenant A.
    await expect(
      asManager.mutation(api.lib.menu.items.reorder, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        orderedIds: [i1, i2, bItem],
      }),
    ).rejects.toThrow();
  });

  it("does not affect another tenant's items (cross-tenant isolation)", async () => {
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const bCat = await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const b1 = await bMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "B-1",
      description: "",
      basePrice: 100,
      allergens: [],
    });
    const b2 = await bMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "B-2",
      description: "",
      basePrice: 200,
      allergens: [],
    });
    // Reorder tenant A's catA.
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.menu.items.reorder, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      orderedIds: [i3, i2, i1],
    });
    // Tenant B's items are untouched.
    const bItems = await bMgr.query(api.lib.menu.items.listByCategory, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
    });
    expect(bItems.map((i) => i._id)).toEqual([b1, b2]);
    expect(bItems.map((i) => i.order)).toEqual([0, 1]);
  });

  it("kb_admin (root) can reorder any tenant's items", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.menu.items.reorder, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
      orderedIds: [i2, i3, i1],
    });
    const items = await asAdmin.query(api.lib.menu.items.listByCategory, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
    });
    expect(items.map((i) => i._id)).toEqual([i2, i3, i1]);
  });

  it("staff (not in allow-list) cannot reorder", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await expect(
      asStaff.mutation(api.lib.menu.items.reorder, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        orderedIds: [i1, i2, i3],
      }),
    ).rejects.toThrow();
  });

  it("atomicity: a failing reorder leaves the previous order intact", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Initial order [i1, i2, i3], orders 0/1/2. Attempt an invalid reorder
    // (duplicate). Convex mutation tx must roll back any partial patch.
    await expect(
      asManager.mutation(api.lib.menu.items.reorder, {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA,
        orderedIds: [i2, i2, i1], // invalid: i2 twice, i3 missing
      }),
    ).rejects.toThrow();
    const items = await asManager.query(api.lib.menu.items.listByCategory, {
      tenantId: seed.tenantA.tenantId,
      categoryId: catA,
    });
    expect(items.map((i) => i._id)).toEqual([i1, i2, i3]);
    expect(items.map((i) => i.order)).toEqual([0, 1, 2]);
  });
});
