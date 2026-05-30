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
// convex/lib/menu/, so normalise every key to be relative to the convex root
// (../../) so convex-test's findModulesRoot has ONE common prefix (same shape as
// the sibling menu suites).
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
 * B-MENU-PUBLICATION slice 2 — `publishMenu` global atomic snapshot build
 * (ADR 0015 + ADR 0010), written BEFORE the implementation (TDD red).
 *
 * The mutation rebuilds the [[Instantané publié]] of the calling tenant from
 * the current draft (live `menuCategories` / `menuItems` / `modifierGroups` /
 * `menuItemModifierGroups`) inside ONE Convex mutation tx, via the sanctioned
 * `writePublishedMenu` seam from slice #152. The snapshot is the public shape
 * the PWA mangeur will read (slice 6) — categories ordered, items projected to
 * `_id` / name / description / basePrice / allergens / photoStorageId, and the
 * modifier groups resolved with min/max + options. The `available` field is
 * NOT snapshotted (overlay live, ADR 0015 pivot « la rupture ne doit pas
 * exiger une republication globale »).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("B-MENU-PUBLICATION slice 2 — publishMenu (ADR 0015 + 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("publishes a snapshot rebuilt entirely from the live draft", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Seed the draft via the sanctioned CRUD: 2 categories, items in each,
    // one modifier group attached to one item.
    const cat1 = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    const cat2 = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Sides",
    });
    const item1 = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat1,
      name: "Smash Double",
      description: "Double smash burger.",
      basePrice: 1200,
      allergens: ["gluten", "lait"],
    });
    const item2 = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat2,
      name: "Frites",
      description: "Frites maison.",
      basePrice: 400,
      allergens: [],
    });
    const group = await asManager.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantA.tenantId,
      name: "Cuisson",
      minSelect: 1,
      maxSelect: 1,
      options: [
        { label: "Saignant", priceDelta: 0 },
        { label: "À point", priceDelta: 0 },
      ],
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: item1,
      modifierGroupId: group,
    });

    // Publish — atomic snapshot rebuild.
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });

    // Read back via the sanctioned seam (this test still runs in-tx, no public
    // read API in this slice — slice 6 wires `getPublicMenu` onto the snapshot).
    const snapshot = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot?.tenantId).toBe(seed.tenantA.tenantId);
    expect(snapshot?.publishedAt).toBeGreaterThan(0);

    const payload = snapshot?.payload;
    expect(payload?.categories).toHaveLength(2);
    expect(payload?.categories[0]?._id).toBe(cat1);
    expect(payload?.categories[0]?.name).toBe("Smashs");
    expect(payload?.categories[1]?._id).toBe(cat2);
    expect(payload?.categories[1]?.name).toBe("Sides");

    const snapItem1 = payload?.categories[0]?.items[0];
    expect(snapItem1?._id).toBe(item1);
    expect(snapItem1?.name).toBe("Smash Double");
    expect(snapItem1?.description).toBe("Double smash burger.");
    expect(snapItem1?.basePrice).toBe(1200);
    expect(snapItem1?.allergens).toEqual(["gluten", "lait"]);
    expect(snapItem1?.modifierGroups).toHaveLength(1);
    expect(snapItem1?.modifierGroups[0]?._id).toBe(group);
    expect(snapItem1?.modifierGroups[0]?.name).toBe("Cuisson");
    expect(snapItem1?.modifierGroups[0]?.minSelect).toBe(1);
    expect(snapItem1?.modifierGroups[0]?.maxSelect).toBe(1);
    expect(snapItem1?.modifierGroups[0]?.options).toEqual([
      { label: "Saignant", priceDelta: 0 },
      { label: "À point", priceDelta: 0 },
    ]);

    const snapItem2 = payload?.categories[1]?.items[0];
    expect(snapItem2?._id).toBe(item2);
    expect(snapItem2?.name).toBe("Frites");
    expect(snapItem2?.modifierGroups).toEqual([]);
  });

  it("snapshot payload does NOT carry `available` on items (ADR 0015 pivot)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const item = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "I",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    // Flip the item unavailable to make sure the absence of `available` in the
    // snapshot is INTENTIONAL (the seam strips it, regardless of draft state).
    await asManager.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId: item,
      available: false,
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const snapshot = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    const snapItem = snapshot?.payload.categories[0]?.items[0];
    expect(snapItem).toBeDefined();
    expect(
      (snapItem as unknown as { available?: boolean }).available,
    ).toBeUndefined();
  });

  it("re-publishing OVERWRITES the prior snapshot atomically — no residue", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemKeep = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Keep",
      description: "stays after re-publish",
      basePrice: 500,
      allergens: [],
    });
    const itemDrop = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Drop",
      description: "removed before re-publish",
      basePrice: 800,
      allergens: [],
    });
    // First publish: both items.
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // Mutate the draft — remove `itemDrop`, rename `itemKeep`.
    await asManager.mutation(api.lib.menu.items.remove, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemDrop,
    });
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemKeep,
      categoryId: cat,
      name: "Keep v2",
      description: "renamed",
      basePrice: 600,
      allergens: ["gluten"],
    });
    // Re-publish — overwrites the prior snapshot.
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });

    // Exactly ONE row for this tenant (atomic replace, no leftover).
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    const snapItems = rows[0]?.payload.categories[0]?.items;
    expect(snapItems).toHaveLength(1);
    expect(snapItems?.[0]?._id).toBe(itemKeep);
    expect(snapItems?.[0]?.name).toBe("Keep v2");
    expect(snapItems?.[0]?.basePrice).toBe(600);
    expect(snapItems?.[0]?.allergens).toEqual(["gluten"]);
  });

  it("publishes an empty snapshot for a tenant that has no draft yet", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const snapshot = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot?.payload).toEqual({ categories: [] });
  });

  it("kb_admin (root override) can publish any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const cat = await asAdmin.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    await asAdmin.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: cat,
      name: "B-item",
      description: "b",
      basePrice: 700,
      allergens: [],
    });
    await asAdmin.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    const snapshot = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantB.tenantId))
        .unique(),
    );
    expect(snapshot?.payload.categories[0]?.name).toBe("B-cat");
  });

  it("staff is REJECTED (only kb_manager + kb_admin root override)", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await expect(
      asStaff.mutation(api.lib.menu.publication.publishMenu, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("kb_manager of a foreign tenant is REJECTED on tenantA", async () => {
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      bMgr.mutation(api.lib.menu.publication.publishMenu, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("cross-tenant fuzz: publishing tenant A leaves tenant B's snapshot UNTOUCHED", async () => {
    const aMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    // Seed both drafts with distinct categories.
    await aMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "A-cat",
    });
    await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    // B publishes first.
    await bMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    // Then A publishes — must NOT touch B's snapshot.
    await aMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });

    const bSnap = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantB.tenantId))
        .unique(),
    );
    expect(bSnap?.payload.categories[0]?.name).toBe("B-cat");
    expect(bSnap?.payload.categories[0]?.items).toEqual([]);

    const aSnap = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    expect(aSnap?.payload.categories[0]?.name).toBe("A-cat");

    // Vice-versa: re-publish B, A stays untouched.
    await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat-2",
    });
    await bMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    const aSnap2 = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    expect(aSnap2?.payload.categories).toHaveLength(1);
    expect(aSnap2?.payload.categories[0]?.name).toBe("A-cat");
  });
});

describe("B-MENU-PUBLICATION slice 2 — publishMenu cross-tenant fuzz (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("every unauthorized actor is rejected on tenant A's publishMenu", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not in allow-list
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.menu.publication.publishMenu],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(pairs).toBe(6); // 1 function × 6 actors
    expect(leaks).toEqual([]);
  });
});
