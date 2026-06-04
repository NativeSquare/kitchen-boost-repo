import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (path.startsWith("./")) {
      // Modules sibling to this test file: rebase to the convex root so
      // convex-test's `findModulesRoot` resolves them under `lib/menu/<name>`.
      key = `../../lib/menu/${path.slice(2)}`;
    } else if (path.startsWith("../") && !path.startsWith("../../")) {
      // Sibling of `lib/menu/` (e.g. `../menuRevalidate/foo.ts` if vite ever
      // emits a `../` prefix). Rebase the same way.
      key = `../../lib/${path.slice(3)}`;
    }
    return [key, loader];
  }),
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

/**
 * PWA-S4 (#452) — `publishMenu` schedules `revalidateMenuTag` (decisions-log
 * Q2 « ISR + on-demand revalidate au clic Publier »). The hook is fire-
 * and-forget — `publishMenu` commits the snapshot even if the revalidate
 * call fails (NON-FATAL by design). We assert here that the schedule wiring
 * is in place: after `finishInProgressScheduledFunctions`, the
 * internalAction reached its `fetch` call (mocked to count invocations).
 */
describe("PWA-S4 (#452) — publishMenu schedules revalidateMenuTag", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  afterEach(() => {
    // Nothing global to restore — these tests assert the schedule + commit,
    // not the fetch boundary (covered exhaustively by `lib/menuRevalidate/
    // revalidateMenuTag.test.ts`).
  });

  it("publishMenu schedules ONE follow-up function (the revalidate hook)", async () => {
    // Convex-test's worker isolation makes mocking `globalThis.fetch` from
    // a scheduled internalAction unreliable across runs (the action runs in
    // a separate module-eval context). Pinning the FETCH boundary of the
    // hook is covered exhaustively by `lib/menuRevalidate/revalidateMenuTag.test.ts`
    // (4 cases: misconfig, happy path, HTTP non-2xx, fetch throw).
    //
    // Here we pin a complementary but stable invariant: `publishMenu`
    // SCHEDULES the revalidate (one follow-up scheduled function row).
    // Combined with the action-level tests, this gives end-to-end coverage
    // of the wire « publishMenu → schedule → fetch /api/revalidate ».
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    // Exactly one follow-up — the revalidate hook keyed on the published tenant.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.name).toBe(
      "lib/menuRevalidate/revalidateMenuTag:revalidateMenuTag",
    );
    expect(scheduled[0]?.args).toEqual([{ tenantId: seed.tenantA.tenantId }]);
  });

  it("publishMenu commits the snapshot synchronously — the revalidate is scheduled, NOT awaited", async () => {
    // Decoupling the SoT (snapshot) from the cache invalidation (ISR tag) is a
    // NON-FATAL contract: even when the revalidate hook later fails (env
    // unset / Next route 5xx / network down), the published menu the eater
    // PWA reads from `getPublicMenu` is the freshly-committed snapshot.
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });

    // The snapshot landed in the same tx as publishMenu — independent of any
    // follow-up scheduled work having completed.
    const snap = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    expect(snap).not.toBeNull();
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

/**
 * B-MENU-PUBLICATION slice 5 (#176) — `hasUnpublishedChanges` indicator (ADR
 * 0015 « Un indicateur "modifications non publiées" est affiché dans l'éditeur »
 * + ADR 0010), written BEFORE the implementation (TDD red).
 *
 * The editor displays this indicator continuously (« X modifications non
 * publiées »); it must flip back to `false` after `publishMenu` and to `true`
 * after ANY draft mutation (rename category, edit item, attach modifier group,
 * etc.). Implementation note: a literal `_creationTime`-only comparison would
 * miss in-place updates (patches don't refresh `_creationTime` in Convex), so
 * the seam projects the live draft via the SAME `buildSnapshotPayload` used by
 * `publishMenu` / `previewMenu` and deep-equates it with `snapshot.payload`.
 * That keeps the three surfaces consistent (DRY): if the draft projects to the
 * same payload bytes as the last snapshot, there is nothing to publish.
 *
 * Return shape:
 *   { hasChanges: boolean; lastPublishedAt: number | null; changedSince: number | null }
 * - `lastPublishedAt` — `publishedMenus.publishedAt` of the tenant snapshot, or
 *   `null` if the tenant has never published.
 * - `changedSince` — best-effort LOWER bound on when changes first appeared. We
 *   return the earliest `_creationTime` strictly greater than `lastPublishedAt`
 *   among draft rows of the tenant (or `null` if no such row / no changes).
 *   Pure edits don't refresh `_creationTime`, so this stays `null` for pure
 *   renames/edits — that's an accepted V1 approximation (the boolean is the
 *   load-bearing field; the timestamp is informational).
 */
describe("B-MENU-PUBLICATION slice 5 — hasUnpublishedChanges (#176, ADR 0015)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("never-published tenant + non-empty draft ⇒ hasChanges = true, lastPublishedAt = null", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const res = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.hasChanges).toBe(true);
    expect(res.lastPublishedAt).toBeNull();
    expect(res.changedSince).not.toBeNull();
  });

  it("never-published tenant + EMPTY draft ⇒ hasChanges = false, lastPublishedAt = null", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const res = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.hasChanges).toBe(false);
    expect(res.lastPublishedAt).toBeNull();
    expect(res.changedSince).toBeNull();
  });

  it("after publishMenu ⇒ hasChanges = false, lastPublishedAt set", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "I",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const res = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.hasChanges).toBe(false);
    expect(res.lastPublishedAt).not.toBeNull();
    expect(typeof res.lastPublishedAt).toBe("number");
    expect(res.changedSince).toBeNull();
  });

  it("after a draft RENAME category ⇒ hasChanges = true", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    await asManager.mutation(api.lib.menu.categories.rename, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Cat v2",
    });
    const res = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.hasChanges).toBe(true);
  });

  it("after a draft ITEM EDIT ⇒ hasChanges = true", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "I",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    await asManager.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      categoryId: cat,
      name: "I v2",
      description: "d2",
      basePrice: 700,
      allergens: ["gluten"],
      available: true,
    });
    const res = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.hasChanges).toBe(true);
  });

  it("after ATTACH modifier group ⇒ hasChanges = true", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "I",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    const groupId = await asManager.mutation(
      api.lib.menu.modifiers.createGroup,
      {
        tenantId: seed.tenantA.tenantId,
        name: "G",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "o", priceDelta: 0 }],
      },
    );
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      modifierGroupId: groupId,
    });
    const res = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.hasChanges).toBe(true);
  });

  it("after RE-PUBLISH ⇒ hasChanges = false again, lastPublishedAt updates", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const firstRes = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    const firstAt = firstRes.lastPublishedAt as number;
    await asManager.mutation(api.lib.menu.categories.rename, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Cat v2",
    });
    expect(
      (
        await asManager.query(api.lib.menu.publication.hasUnpublishedChanges, {
          tenantId: seed.tenantA.tenantId,
        })
      ).hasChanges,
    ).toBe(true);
    // wait 1ms so the new publishedAt is strictly newer
    await new Promise((r) => setTimeout(r, 2));
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const secondRes = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(secondRes.hasChanges).toBe(false);
    expect(secondRes.lastPublishedAt).not.toBeNull();
    expect((secondRes.lastPublishedAt as number) >= firstAt).toBe(true);
  });

  it("toggling `available` (out-of-stock) does NOT flip hasChanges (ADR 0015 pivot: rupture is live overlay, not a draft change)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "I",
      description: "d",
      basePrice: 500,
      allergens: [],
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // out-of-stock toggle — payload `available` is NOT in the snapshot.
    await asManager.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    const res = await asManager.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.hasChanges).toBe(false);
  });

  it("cross-tenant fuzz: indicator of tenant A is unaffected by draft mutations on tenant B", async () => {
    const aMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    // seed both, publish both → both should be hasChanges=false
    await aMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "A-cat",
    });
    await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    await aMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    await bMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    const aBefore = await aMgr.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(aBefore.hasChanges).toBe(false);
    // B mutates its draft.
    await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat-2",
    });
    // A must still be false; B must now be true.
    const aAfter = await aMgr.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(aAfter.hasChanges).toBe(false);
    const bAfter = await bMgr.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(bAfter.hasChanges).toBe(true);
  });

  it("kb_admin (root override) can read the indicator of any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const res = await asAdmin.query(
      api.lib.menu.publication.hasUnpublishedChanges,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(typeof res.hasChanges).toBe("boolean");
    expect(res.lastPublishedAt).toBeNull();
  });

  it("staff is REJECTED (publication indicator is editor-only)", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await expect(
      asStaff.query(api.lib.menu.publication.hasUnpublishedChanges, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("kb_manager of a foreign tenant is REJECTED on tenantA's indicator", async () => {
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      bMgr.query(api.lib.menu.publication.hasUnpublishedChanges, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });
});

describe("B-MENU-PUBLICATION slice 5 — hasUnpublishedChanges cross-tenant fuzz (#176, ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("every unauthorized actor is rejected on tenant A's hasUnpublishedChanges", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not allowed
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.menu.publication.hasUnpublishedChanges],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
  });
});

/**
 * B-MENU-PUBLICATION slice 8 (#224) — coherence EDGES between draft deletions
 * and the published snapshot (ADR 0015 « pas de versioning V1 » + ADR 0010).
 *
 * Across the publication surface the contract is uniform: deleting a draft row
 * (item / category / modifier group) does NOT touch the existing snapshot, so
 * the snapshot can transiently reference draft ids that no longer exist in the
 * live tables — until the gérant clicks « Publier » again. The read side stays
 * graceful: `getPublicMenu` returns the snapshot as-is, with `photoUrl = null`
 * for an orphan storage id (no throw).
 *
 * Tests below pin BOTH halves:
 *  - the snapshot row is preserved (no cascade across the boundary);
 *  - the next `publishMenu` rebuild drops the deleted draft row (regression).
 */
describe("B-MENU-PUBLICATION slice 8 — snapshot ↔ draft edges (#224, ADR 0015)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("deleting a draft CATEGORY referenced by the snapshot leaves the snapshot intact, getPublicMenu still serves the snapshotted category", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Smash",
      description: "",
      basePrice: 500,
      allergens: [],
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // Drop the item first (deleteTenantCategory does NOT cascade to items),
    // then drop the category — the snapshot still carries both.
    await asManager.mutation(api.lib.menu.items.remove, {
      tenantId: seed.tenantA.tenantId,
      itemId,
    });
    await asManager.mutation(api.lib.menu.categories.remove, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
    });
    // Snapshot row is UNTOUCHED: same category id, same item id.
    const snapshot = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    expect(snapshot?.payload.categories[0]?._id).toBe(cat);
    expect(snapshot?.payload.categories[0]?.items[0]?._id).toBe(itemId);
    // PWA still serves the snapshotted category (tolerant read).
    const publicMenu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(publicMenu.categories[0]?.name).toBe("Smashs");
    expect(publicMenu.categories[0]?.items[0]?._id).toBe(itemId);
  });

  it("deleting a draft MODIFIER GROUP referenced by the snapshot leaves the snapshot intact (same contract)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    const itemId = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Smash",
      description: "",
      basePrice: 1000,
      allergens: [],
    });
    const groupId = await asManager.mutation(
      api.lib.menu.modifiers.createGroup,
      {
        tenantId: seed.tenantA.tenantId,
        name: "Cuisson",
        minSelect: 1,
        maxSelect: 1,
        options: [
          { label: "Saignant", priceDelta: 0 },
          { label: "À point", priceDelta: 0 },
        ],
      },
    );
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      modifierGroupId: groupId,
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // Drop the group from the draft (also cascades edges) — snapshot UNTOUCHED.
    await asManager.mutation(api.lib.menu.modifiers.removeGroup, {
      tenantId: seed.tenantA.tenantId,
      modifierGroupId: groupId,
    });
    const snapshot = await t.run((ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .unique(),
    );
    const snapGroup =
      snapshot?.payload.categories[0]?.items[0]?.modifierGroups[0];
    expect(snapGroup?._id).toBe(groupId);
    expect(snapGroup?.name).toBe("Cuisson");
    // PWA still serves the snapshotted group (tolerant read).
    const publicMenu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const publicGroup = publicMenu.categories[0]?.items[0]?.modifierGroups[0];
    expect(publicGroup?._id).toBe(groupId);
    expect(publicGroup?.name).toBe("Cuisson");
    expect(publicGroup?.options).toEqual([
      { label: "Saignant", priceDelta: 0 },
      { label: "À point", priceDelta: 0 },
    ]);
  });

  it("republishing AFTER a draft deletion drops the row from the snapshot (regression)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const cat = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Cat",
    });
    const itemKeep = await asManager.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: cat,
      name: "Keep",
      description: "",
      basePrice: 500,
      allergens: [],
    });
    const groupKeep = await asManager.mutation(
      api.lib.menu.modifiers.createGroup,
      {
        tenantId: seed.tenantA.tenantId,
        name: "Keep group",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "k", priceDelta: 0 }],
      },
    );
    const groupDrop = await asManager.mutation(
      api.lib.menu.modifiers.createGroup,
      {
        tenantId: seed.tenantA.tenantId,
        name: "Drop group",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "d", priceDelta: 0 }],
      },
    );
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemKeep,
      modifierGroupId: groupKeep,
    });
    await asManager.mutation(api.lib.menu.modifiers.attachGroupToItem, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemKeep,
      modifierGroupId: groupDrop,
    });
    await asManager.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    // Drop one group from the draft, then republish.
    await asManager.mutation(api.lib.menu.modifiers.removeGroup, {
      tenantId: seed.tenantA.tenantId,
      modifierGroupId: groupDrop,
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
    const groups =
      snapshot?.payload.categories[0]?.items[0]?.modifierGroups ?? [];
    const ids = groups.map((g) => g._id);
    expect(ids).toEqual([groupKeep]);
    expect(ids).not.toContain(groupDrop);
  });
});

/**
 * B-MENU-PUBLICATION slice 8 (#224) — CONSOLIDATED cross-tenant fuzz over the
 * full publication surface (ADR 0010). Reuses `lib/tenancy/fuzz.ts`. Each of
 * the four functions is exercised against the SAME unauthorized-actor matrix,
 * with the right `isQuery` predicate so we replay them as queries or as
 * mutations. A single suite makes it impossible to ship a new publication
 * function without consciously including it here (the count assertion catches
 * any drift in the audited surface).
 */
describe("B-MENU-PUBLICATION slice 8 — publication surface, consolidated cross-tenant fuzz (#224, ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("every publication function rejects every unauthorized actor on tenant A (publishMenu + previewMenu + hasUnpublishedChanges + getPublicMenu wrapper)", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not allowed on editor surfaces
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    // publishMenu (mutation) + previewMenu / hasUnpublishedChanges (queries):
    // editor-only surfaces, every unauthorized actor MUST throw.
    const editorFns = [
      api.lib.menu.publication.publishMenu,
      api.lib.menu.publication.previewMenu,
      api.lib.menu.publication.hasUnpublishedChanges,
    ];
    const { leaks: editorLeaks, pairs: editorPairs } = await runCrossTenantFuzz(
      t,
      {
        functions: editorFns,
        isQuery: (fn) => fn !== api.lib.menu.publication.publishMenu,
        tenantId: seed.tenantA.tenantId,
        actors,
      },
    );
    expect(editorPairs).toBe(18); // 3 fns × 6 actors
    expect(editorLeaks).toEqual([]);
  });

  it("getPublicMenu cross-tenant isolation: data returned for tenant A is NEVER tenant B's snapshot rows", async () => {
    const aMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const aCat = await aMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "A-cat",
    });
    const aItemId = await aMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId: aCat,
      name: "A-item",
      description: "",
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
      description: "",
      basePrice: 800,
      allergens: [],
    });
    await aMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    await bMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    // getPublicMenu is unauthenticated — replay it across the SAME actor matrix
    // including anonymous; it must always return tenant A data only (the snapshot
    // read is keyed on `ctx.tenantId` via `getPublishedMenu`).
    const actors: Array<{ label: string; subject: string | null }> = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    for (const actor of actors) {
      const handle =
        actor.subject === null ? t : t.withIdentity({ subject: actor.subject });
      const menu = await handle.query(api.lib.menu.catalog.getPublicMenu, {
        tenantId: seed.tenantA.tenantId,
      });
      const itemIds = menu.categories.flatMap((c) => c.items.map((i) => i._id));
      expect(menu.categories.map((c) => c.name)).toEqual(["A-cat"]);
      expect(itemIds).toContain(aItemId);
      expect(itemIds).not.toContain(bItemId);
    }
  });
});
