import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/menu/, so Vite keys same-dir matches as "./x"; normalise every key
// to be relative to the convex root (../../). Same shape as modifiers.test.ts.
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
 * 2.2-C — PUBLIC read of a tenant's menu for the PWA eater (`getPublicMenu`),
 * written BEFORE the implementation (TDD red). It is the UNIQUE eater-facing
 * surface (PRD 10 §5/§6, client-ordering CONTEXT): an UNAUTHENTICATED, read-only
 * query via `publicTenantQuery`, scoped to the tenant of the sub-domain. It
 * returns the structured menu — categories ORDERED → items (incl. unavailable,
 * with the availability flag so the front greys them out, PRD §5) → modifier
 * groups resolved via the N-N link, with options + priceDelta.
 *
 * Isolation (ADR 0010): `getPublicMenu(tenantA)` must NEVER surface a
 * category/item/modifier of tenant B — pinned by the cross-tenant suite below.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Seed one tenant's category with one item; returns their ids. */
async function seedCategoryItem(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  managerId: Id<"users">,
  catName: string,
  itemName: string,
): Promise<{ categoryId: Id<"menuCategories">; itemId: Id<"menuItems"> }> {
  const asManager = t.withIdentity({ subject: managerId });
  const categoryId = await asManager.mutation(api.lib.menu.categories.create, {
    tenantId,
    name: catName,
  });
  const itemId = await asManager.mutation(api.lib.menu.items.create, {
    tenantId,
    categoryId,
    name: itemName,
    description: `desc-${itemName}`,
    basePrice: 1000,
    allergens: ["gluten"],
  });
  return { categoryId, itemId };
}

describe("2.2-C getPublicMenu — public, read-only, structured menu", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("requires an explicit tenantId argument (rejects when missing)", async () => {
    await expect(
      // @ts-expect-error tenantId is a required explicit argument
      t.query(api.lib.menu.catalog.getPublicMenu, {}),
    ).rejects.toThrow();
  });

  it("throws when the tenantId does not resolve to an existing tenant", async () => {
    const danglingId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost",
        name: "Ghost",
        siret: "ghost",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      t.query(api.lib.menu.catalog.getPublicMenu, { tenantId: danglingId }),
    ).rejects.toThrow(/forbidden|not found/i);
  });

  it("is accessible WITHOUT any authentication (anonymous eater)", async () => {
    await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories).toHaveLength(1);
    expect(menu.categories[0]?.name).toBe("Smashs");
    expect(menu.categories[0]?.items[0]?.name).toBe("Smash Double");
  });

  it("is also accessible to an authenticated customer (no pro auth required)", async () => {
    await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Boissons",
      "Cristaline",
    );
    const menu = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.menu.catalog.getPublicMenu, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(menu.categories[0]?.items[0]?.name).toBe("Cristaline");
  });

  it("returns categories ORDERED by their display order", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const first = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "First",
    });
    const second = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Second",
    });
    // Re-order so "Second" comes first.
    await asManager.mutation(api.lib.menu.categories.reorder, {
      tenantId: seed.tenantA.tenantId,
      orderedIds: [second, first],
    });
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories.map((c) => c.name)).toEqual(["Second", "First"]);
  });

  it("exposes the availability flag (out-of-stock items are RETURNED, greyed)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    // Toggle the item out of stock (available=false).
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      name: "Smash Double",
      description: "desc",
      basePrice: 1000,
      allergens: [],
      available: false,
    });
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // Still RETURNED (front greys it out), with available=false.
    const item = menu.categories[0]?.items[0];
    expect(item?.name).toBe("Smash Double");
    expect(item?.available).toBe(false);
  });

  it("exposes item price, description, allergens", async () => {
    await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const item = menu.categories[0]?.items[0];
    expect(item?.basePrice).toBe(1000);
    expect(item?.description).toBe("desc-Smash Double");
    expect(item?.allergens).toEqual(["gluten"]);
    // photoUrl is exposed (null when no photo uploaded).
    expect(item?.photoUrl).toBeNull();
  });

  it("resolves modifier groups via the N-N link, with options + priceDelta + min/max", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    const groupId = await asManager.mutation(
      api.lib.menu.modifiers.createGroup,
      {
        tenantId: seed.tenantA.tenantId,
        name: "Sauce",
        minSelect: 1,
        maxSelect: 2,
        options: [
          { label: "Ketchup", priceDelta: 0 },
          { label: "Bacon", priceDelta: 150 },
        ],
      },
    );
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      modifierGroupId: groupId,
    });
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const group = menu.categories[0]?.items[0]?.modifierGroups[0];
    expect(group?.name).toBe("Sauce");
    expect(group?.minSelect).toBe(1);
    expect(group?.maxSelect).toBe(2);
    expect(group?.options).toEqual([
      { label: "Ketchup", priceDelta: 0 },
      { label: "Bacon", priceDelta: 150 },
    ]);
  });

  it("returns an empty menu (no categories) for a tenant with no menu yet", async () => {
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories).toEqual([]);
  });

  it("is read-only: no public mutation twin in the module contract (type-level)", () => {
    // `api` is a runtime proxy (a missing member returns a proxy, not undefined —
    // project memory), so assert "no public write" at the TYPE level.
    type Catalog = typeof import("./catalog");
    // @ts-expect-error setPublicMenu does not exist — the public surface is read-only.
    type _NoPublicWrite = Catalog["setPublicMenu"];
    expect(true).toBe(true);
  });
});

describe("2.2-C cross-tenant isolation — getPublicMenu(A) never leaks B (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let aItemId: Id<"menuItems">;
  let bItemId: Id<"menuItems">;
  let bGroupId: Id<"modifierGroups">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Both tenants get a full menu (category + item + reusable group attached).
    const a = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "A-cat",
      "A-item",
    );
    aItemId = a.itemId;
    const b = await seedCategoryItem(
      t,
      seed.tenantB.tenantId,
      seed.tenantB.managerId,
      "B-cat",
      "B-item",
    );
    bItemId = b.itemId;
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    bGroupId = await bMgr.mutation(api.lib.menu.modifiers.createGroup, {
      tenantId: seed.tenantB.tenantId,
      name: "B-sauce",
      minSelect: 0,
      maxSelect: 1,
      options: [{ label: "B-opt", priceDelta: 0 }],
    });
    await bMgr.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantB.tenantId,
      itemId: bItemId,
      modifierGroupId: bGroupId,
    });
  });

  it("getPublicMenu(A) returns ONLY tenant A's categories/items/modifiers", async () => {
    const menuA = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const catNames = menuA.categories.map((c) => c.name);
    expect(catNames).toEqual(["A-cat"]);
    expect(catNames).not.toContain("B-cat");

    const itemIds = menuA.categories.flatMap((c) => c.items.map((i) => i._id));
    expect(itemIds).toContain(aItemId);
    expect(itemIds).not.toContain(bItemId);

    const groupIds = menuA.categories.flatMap((c) =>
      c.items.flatMap((i) => i.modifierGroups.map((g) => g._id)),
    );
    expect(groupIds).not.toContain(bGroupId);
  });

  it("getPublicMenu(B) symmetrically returns ONLY tenant B's menu", async () => {
    const menuB = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(menuB.categories.map((c) => c.name)).toEqual(["B-cat"]);
    const itemIds = menuB.categories.flatMap((c) => c.items.map((i) => i._id));
    expect(itemIds).toContain(bItemId);
    expect(itemIds).not.toContain(aItemId);
  });
});
