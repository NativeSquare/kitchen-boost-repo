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
      available: true,
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

/**
 * B-MENU-PUBLICATION slice 4 (#166) — `previewMenu` (admin reads the DRAFT as the
 * PWA would render the published snapshot, ADR 0015 « Aperçu admin lit le
 * brouillon »). It mirrors `getPublicMenu`'s wire contract (`PublicMenu`) but is
 * built LIVE from the draft tables, so the gérant can preview unpublished
 * changes before clicking « Publier ».
 *
 * Key invariants (pinned by tests below):
 *  - `tenantQuery({ allow: ["kb_manager"] })` with root override for `kb_admin`
 *    (cohérent avec `lib/menu`). Staff REJECTED (preview is editor-only).
 *  - Returns the same `PublicMenu` shape (categories ordered → items → modifier
 *    groups + `photoUrl` + `available`), built from the LIVE draft via the
 *    SHARED projection helper used by `publishMenu` (DRY enforced via type-level
 *    expectation: `previewMenu` calls the same `buildSnapshotPayload` exported
 *    from `publication.ts`, see code comments).
 *  - `available` overlay applied LIVE from `menuItems` (same source as
 *    `getPublicMenu`) — toggling out of stock affects both surfaces immediately.
 *  - Cross-tenant fuzz: `previewMenu(A)` never surfaces tenant B draft rows.
 */
describe("B-MENU-PUBLICATION slice 4 — previewMenu (admin lit le brouillon, #166, ADR 0015)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_manager preview reflects DRAFT mutations not yet published (drift test)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Smash Double",
      description: "v1",
      basePrice: 1000,
      allergens: ["gluten"],
    });
    // 1) Publish current draft.
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // 2) Mutate the draft WITHOUT republishing.
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      name: "Smash Double v2 (DRAFT)",
      description: "draft only",
      basePrice: 9999,
      allergens: ["arachides"],
      available: true,
    });

    // previewMenu reflects the draft mutation immediately.
    const preview = await asManager.query(
      api.lib.menu.publication.previewMenu,
      { tenantId: seed.tenantA.tenantId },
    );
    const previewItem = preview.categories[0]?.items[0];
    expect(previewItem?.name).toBe("Smash Double v2 (DRAFT)");
    expect(previewItem?.basePrice).toBe(9999);
    expect(previewItem?.description).toBe("draft only");
    expect(previewItem?.allergens).toEqual(["arachides"]);

    // getPublicMenu still serves the previously published snapshot — drift pin.
    const publicMenu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const publicItem = publicMenu.categories[0]?.items[0];
    expect(publicItem?.name).toBe("Smash Double");
    expect(publicItem?.basePrice).toBe(1000);
    expect(publicItem?.description).toBe("v1");
    expect(publicItem?.allergens).toEqual(["gluten"]);
  });

  it("after publish, preview and getPublicMenu return equivalent menus (modulo available overlay)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Item A",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const preview = await asManager.query(
      api.lib.menu.publication.previewMenu,
      { tenantId: seed.tenantA.tenantId },
    );
    const publicMenu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // Both compute `available` LIVE — equal here since both read the same row.
    expect(preview).toEqual(publicMenu);
  });

  it("returns the DRAFT for a tenant that NEVER published (independent of snapshot state)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Item",
      description: "d",
      basePrice: 400,
      allergens: [],
    });
    // No publishMenu call — getPublicMenu returns empty, previewMenu returns draft.
    const preview = await asManager.query(
      api.lib.menu.publication.previewMenu,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(preview.categories).toHaveLength(1);
    expect(preview.categories[0]?.name).toBe("Cat");
    expect(preview.categories[0]?.items[0]?.name).toBe("Item");

    const publicMenu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(publicMenu.categories).toEqual([]);
  });

  it("returns an empty menu for a tenant with NO draft at all", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const preview = await asManager.query(
      api.lib.menu.publication.previewMenu,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(preview.categories).toEqual([]);
  });

  it("`available` reflects the LIVE menuItems flag (same overlay rule as getPublicMenu)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Item",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    const before = await asManager.query(api.lib.menu.publication.previewMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(before.categories[0]?.items[0]?.available).toBe(true);

    await asManager.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    const after = await asManager.query(api.lib.menu.publication.previewMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(after.categories[0]?.items[0]?.available).toBe(false);
  });

  it("resolves modifier groups via the N-N link with options + priceDelta + min/max (DRY with publish projection)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Item",
      description: "d",
      basePrice: 1000,
      allergens: [],
    });
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
    const preview = await asManager.query(
      api.lib.menu.publication.previewMenu,
      { tenantId: seed.tenantA.tenantId },
    );
    const group = preview.categories[0]?.items[0]?.modifierGroups[0];
    expect(group?._id).toBe(groupId);
    expect(group?.name).toBe("Sauce");
    expect(group?.minSelect).toBe(1);
    expect(group?.maxSelect).toBe(2);
    expect(group?.options).toEqual([
      { label: "Ketchup", priceDelta: 0 },
      { label: "Bacon", priceDelta: 150 },
    ]);
  });

  it("resolves photoUrl from the DRAFT's photoStorageId at READ time", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Item",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    const storageId = await t.run(async (ctx) => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      return ctx.storage.store(blob);
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(itemId, { photoStorageId: storageId });
    });
    const preview = await asManager.query(
      api.lib.menu.publication.previewMenu,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(preview.categories[0]?.items[0]?.photoUrl).not.toBeNull();
    expect(typeof preview.categories[0]?.items[0]?.photoUrl).toBe("string");
  });

  it("kb_admin (root override) can preview any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const cat = await asAdmin.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    await asAdmin.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: cat,
      name: "B-item",
      description: "d",
      basePrice: 700,
      allergens: [],
    });
    const preview = await asAdmin.query(api.lib.menu.publication.previewMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(preview.categories[0]?.name).toBe("B-cat");
    expect(preview.categories[0]?.items[0]?.name).toBe("B-item");
  });

  it("staff is REJECTED (preview is editor-only)", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await expect(
      asStaff.query(api.lib.menu.publication.previewMenu, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("kb_manager of a foreign tenant is REJECTED on tenantA's preview", async () => {
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      bMgr.query(api.lib.menu.publication.previewMenu, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("anonymous caller is REJECTED (no public twin)", async () => {
    await expect(
      t.query(api.lib.menu.publication.previewMenu, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("cross-tenant fuzz: previewMenu(A) NEVER surfaces tenant B's draft rows", async () => {
    const aMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    // Seed BOTH tenants with distinct drafts.
    const aCat = await aMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "A-cat",
    });
    const aItemId = await aMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: aCat,
      name: "A-item",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    const bCat = await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const bItemId = await bMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "B-item",
      description: "d",
      basePrice: 800,
      allergens: [],
    });

    const previewA = await aMgr.query(api.lib.menu.publication.previewMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const aCatNames = previewA.categories.map((c) => c.name);
    expect(aCatNames).toEqual(["A-cat"]);
    expect(aCatNames).not.toContain("B-cat");
    const aItemIds = previewA.categories.flatMap((c) =>
      c.items.map((i) => i._id),
    );
    expect(aItemIds).toContain(aItemId);
    expect(aItemIds).not.toContain(bItemId);
  });
});

describe("B-MENU-PUBLICATION slice 4 — previewMenu cross-tenant fuzz (#166, ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("every unauthorized actor is rejected on tenant A's previewMenu", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not in allow-list
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.menu.publication.previewMenu],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(pairs).toBe(6); // 1 function × 6 actors
    expect(leaks).toEqual([]);
  });
});
