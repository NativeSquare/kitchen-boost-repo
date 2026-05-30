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

/**
 * Helper — seed a draft and PUBLISH it. After slice 3 (#160), `getPublicMenu`
 * reads the published snapshot, not the live draft, so every legacy test that
 * expects to see seeded data must publish first (rétro-compat: same wire shape
 * for callers that publish, `{ categories: [] }` for tenants that don't).
 */
async function publish(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  managerId: Id<"users">,
): Promise<void> {
  await t
    .withIdentity({ subject: managerId })
    .mutation(api.lib.menu.publication.publishMenu, { tenantId });
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
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
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
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
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
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
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
    // Toggle the item out of stock (available=false) BEFORE publishing.
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      name: "Smash Double",
      description: "desc",
      basePrice: 1000,
      allergens: [],
      available: false,
    });
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // Still RETURNED (front greys it out), with available=false from the LIVE
    // overlay (the snapshot itself does not carry `available`, ADR 0015 pivot).
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
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
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
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
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

  // (#106-c) V1 allergen-filter scope (PRD 10 §5): getPublicMenu returns the
  // PER-ITEM allergen set (a subset of the frozen 14 UE 1169/2011). The simple
  // "Sans-gluten / Vegan / Végé" filter is applied FRONT-SIDE over this set —
  // there is NO backend filtering query and NO filter argument in V1. This pins
  // that the eater surface ships the raw declarations and nothing filters them
  // server-side.
  it("(V1 filter scope) returns the full per-item allergen set, unfiltered", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const categoryId = await asManager.mutation(
      api.lib.menu.categories.create,
      { tenantId: seed.tenantA.tenantId, name: "Smashs" },
    );
    await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId,
      name: "Multi-allergène",
      description: "",
      basePrice: 1290,
      allergens: ["gluten", "lait", "graines de sésame"],
    });
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // The whole declared set is returned verbatim (no server-side filtering).
    expect(menu.categories[0]?.items[0]?.allergens).toEqual([
      "gluten",
      "lait",
      "graines de sésame",
    ]);
  });

  it("(V1 filter scope) takes NO filter argument — filtering is front-side only", () => {
    // `getPublicMenu` accepts ONLY `tenantId` (the public wrapper's tenant key) —
    // no allergen filter. A backend filter arg must be a TYPE error: there is no
    // server-side allergen-filter query in V1 (PRD 10 §5). Asserted at the type
    // level (a runtime call with an extra field is rejected by the validator, so
    // the contract is pinned statically, like the read-only-twin test below).
    type PublicMenuArgs = (typeof api.lib.menu.catalog.getPublicMenu)["_args"];
    // @ts-expect-error there is no backend allergen filter argument in V1.
    type _NoFilterArg = PublicMenuArgs["excludeAllergens"];
    expect(true).toBe(true);
  });

  it("returns an empty menu (no categories) for a tenant with no menu yet", async () => {
    // No draft, no publication — the snapshot is null, the wrapper returns
    // { categories: [] } (slice 3 / #160 edge: tenant jamais publié, ADR 0015).
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories).toEqual([]);
  });

  it("returns { categories: [] } for a tenant that HAS a draft but never published", async () => {
    // Seed a full draft (category + item), but DO NOT publish — the public PWA
    // must not see anything until the manager hits « Publier » (ADR 0015 D2).
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
    // Publish both tenants so getPublicMenu returns their data (slice 3 / #160).
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    await publish(t, seed.tenantB.tenantId, seed.tenantB.managerId);
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

/**
 * B-MENU-PUBLICATION slice 3 (#160) — `getPublicMenu` now sources from the
 * [[Instantané publié]] of the tenant (ADR 0015), not the live draft. Slice 2
 * (#155) writes the snapshot via `publishMenu`; this slice pivots the public
 * read so that the front PWA only sees what the manager has explicitly
 * published — drafts in flight stay invisible.
 *
 * Wire contract `PublicMenu` does NOT change (rétro-compat, ADR 0015): same
 * categories ordered → items (name / description / basePrice / allergens /
 * available / photoUrl) → modifierGroups (min / max / options). Two overlays
 * are resolved at READ time on top of the snapshot:
 *   1. `photoUrl` — resolved from the snapshot `photoStorageId` via
 *      `ctx.storage.getUrl(...)` (snapshot is immutable, URLs are not).
 *   2. `available` — read LIVE from the `menuItems` table (the snapshot does
 *      NOT carry `available`; ADR 0015 pivot). Toggling « out of stock »
 *      therefore never requires a republication.
 *
 * Edge: a tenant that has never published returns `{ categories: [] }` (no
 * throw — the public wrapper still validates the tenant exists, only the
 * snapshot is missing).
 */
describe("B-MENU-PUBLICATION slice 3 — getPublicMenu reads the snapshot (#160, ADR 0015)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the SNAPSHOT, not the live draft, after a mutation that was NOT republished (drift test)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    // 1) Publish the current draft.
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    // 2) Mutate the draft (rename + price change) WITHOUT republishing.
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      name: "Smash Double v2 (DRAFT)",
      description: "draft only",
      basePrice: 9999,
      allergens: ["arachides"],
      available: true,
    });
    // 3) The PWA still sees the PUBLISHED snapshot, not the draft mutations.
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const item = menu.categories[0]?.items[0];
    expect(item?.name).toBe("Smash Double");
    expect(item?.basePrice).toBe(1000);
    expect(item?.allergens).toEqual(["gluten"]);
    expect(item?.description).toBe("desc-Smash Double");
  });

  it("re-publishing AFTER a draft mutation surfaces the new snapshot", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      name: "Smash Double v2",
      description: "updated",
      basePrice: 1500,
      allergens: ["lait"],
      available: true,
    });
    // Re-publish — the snapshot now matches the new draft.
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const item = menu.categories[0]?.items[0];
    expect(item?.name).toBe("Smash Double v2");
    expect(item?.basePrice).toBe(1500);
    expect(item?.allergens).toEqual(["lait"]);
    expect(item?.description).toBe("updated");
  });

  it("`available` reflects the LIVE menuItems flag, not the snapshot (ADR 0015 pivot — no republish needed)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    // Publish with available=true (default at creation).
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    const before = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(before.categories[0]?.items[0]?.available).toBe(true);

    // Flip the LIVE availability OFF (out of stock) — WITHOUT republishing.
    await asManager.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    // The PWA sees `available: false` immediately, same snapshot.
    const after = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(after.categories[0]?.items[0]?._id).toBe(itemId);
    expect(after.categories[0]?.items[0]?.available).toBe(false);

    // Flipping back ON is also immediate.
    await asManager.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: true,
    });
    const back = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(back.categories[0]?.items[0]?.available).toBe(true);
  });

  it("returns an item snapshotted with the SNAPSHOT name even after the live item was renamed (drift between snapshot and live)", async () => {
    // Pin the source of truth: the eater sees the snapshot, not the live row.
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Old Name",
    );
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      name: "New Name",
      description: "x",
      basePrice: 2000,
      allergens: [],
      available: true,
    });
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories[0]?.items[0]?.name).toBe("Old Name");
  });

  it("`available` is FALSE for a snapshotted item whose live row has been DELETED (cannot order what no longer exists)", async () => {
    // Edge: the manager deletes an item from the draft without republishing.
    // The snapshot still carries the item (eater sees it), but the live overlay
    // can no longer attest availability — default to `false` (safe).
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Doomed",
    );
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    await asManager.mutation(api.lib.menu.items.remove, {
      tenantId: seed.tenantA.tenantId,
      itemId,
    });
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const item = menu.categories[0]?.items[0];
    expect(item?.name).toBe("Doomed");
    expect(item?.available).toBe(false);
  });

  it("resolves photoUrl from the snapshot's photoStorageId at READ time", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const { itemId } = await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    // Inject a synthetic photo into storage and attach it to the item, then
    // publish — the snapshot carries the storage id, the wire returns the URL.
    const storageId = await t.run(async (ctx) => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], {
        type: "image/png",
      });
      return ctx.storage.store(blob);
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(itemId, { photoStorageId: storageId });
    });
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories[0]?.items[0]?.photoUrl).not.toBeNull();
    expect(typeof menu.categories[0]?.items[0]?.photoUrl).toBe("string");
  });

  it("photoUrl is null when the snapshotted item has no photoStorageId", async () => {
    await seedCategoryItem(
      t,
      seed.tenantA.tenantId,
      seed.tenantA.managerId,
      "Smashs",
      "Smash Double",
    );
    await publish(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories[0]?.items[0]?.photoUrl).toBeNull();
  });
});
