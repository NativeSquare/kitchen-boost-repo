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
// the pricing / tenancy suites).
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
 * 2.2-B — `menuCategories` tenant-scoped CRUD, written BEFORE the implementation
 * (TDD red). Every function goes through `tenantQuery` / `tenantMutation`
 * (`allow: ["kb_manager"]`, root override for kb_admin), scoped to
 * `ctx.tenantId` — no raw `ctx.db.query` in this business module (ADR 0010).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.2-B menuCategories CRUD — tenant-scoped via kb_manager", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("create + list a category scoped to the calling tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    expect(id).toBeTypeOf("string");

    const cats = await asManager.query(api.lib.menu.categories.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(cats).toHaveLength(1);
    expect(cats[0]?._id).toBe(id);
    expect(cats[0]?.name).toBe("Smashs");
    expect(cats[0]?.order).toBe(0); // first category gets order 0
    expect(cats[0]?.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("create appends with an incrementing order, list returns them ordered", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Sides",
    });
    await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Boissons",
    });

    const cats = await asManager.query(api.lib.menu.categories.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(cats.map((c) => c.name)).toEqual(["Smashs", "Sides", "Boissons"]);
    expect(cats.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it("rename changes only the name of the tenant's own category", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    await asManager.mutation(api.lib.menu.categories.rename, {
      tenantId: seed.tenantA.tenantId,
      categoryId: id,
      name: "Burgers",
    });
    const cats = await asManager.query(api.lib.menu.categories.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(cats[0]?.name).toBe("Burgers");
  });

  it("reorder rewrites the display order of the tenant's categories", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const a = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    const b = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Sides",
    });
    const c = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Boissons",
    });
    // New order: Boissons, Smashs, Sides
    await asManager.mutation(api.lib.menu.categories.reorder, {
      tenantId: seed.tenantA.tenantId,
      orderedIds: [c, a, b],
    });
    const cats = await asManager.query(api.lib.menu.categories.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(cats.map((cat) => cat.name)).toEqual([
      "Boissons",
      "Smashs",
      "Sides",
    ]);
    expect(cats.map((cat) => cat.order)).toEqual([0, 1, 2]);
  });

  it("reorder refuses an id set that is not exactly the tenant's categories", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const a = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Sides",
    });
    // Missing the second id → must throw, not silently partial-apply.
    await expect(
      asManager.mutation(api.lib.menu.categories.reorder, {
        tenantId: seed.tenantA.tenantId,
        orderedIds: [a],
      }),
    ).rejects.toThrow();
  });

  it("remove deletes the tenant's own category", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    });
    await asManager.mutation(api.lib.menu.categories.remove, {
      tenantId: seed.tenantA.tenantId,
      categoryId: id,
    });
    const cats = await asManager.query(api.lib.menu.categories.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(cats).toEqual([]);
  });

  it("list returns ONLY the calling tenant's categories (index isolation)", async () => {
    const aMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    await aMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "A-cat",
    });
    await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const aCats = await aMgr.query(api.lib.menu.categories.list, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(aCats).toHaveLength(1);
    expect(aCats[0]?.name).toBe("A-cat");
  });

  it("rename refuses a categoryId owned by another tenant (no cross-tenant write)", async () => {
    const aMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const aCat = await aMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "A-cat",
    });
    // B-manager points its OWN tenantId but a category id belonging to A.
    await expect(
      bMgr.mutation(api.lib.menu.categories.rename, {
        tenantId: seed.tenantB.tenantId,
        categoryId: aCat,
        name: "stolen",
      }),
    ).rejects.toThrow();
  });

  it("a kb_admin (root) can CRUD on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "root-cat",
    });
    const cats = await asAdmin.query(api.lib.menu.categories.list, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(cats.map((c) => c._id)).toContain(id);
  });
});

describe("2.2-B cross-tenant fuzz — menuCategories CRUD, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let catAId: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    catAId = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.menu.categories.create, {
        tenantId: seed.tenantA.tenantId,
        name: "A-cat",
      });
  });

  it("every category mutation/query rejects every unauthorized actor on tenant A", async () => {
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
        api.lib.menu.categories.list,
        api.lib.menu.categories.create,
        api.lib.menu.categories.rename,
        api.lib.menu.categories.reorder,
        api.lib.menu.categories.remove,
      ],
      isQuery: (fn) => fn === api.lib.menu.categories.list,
      tenantId: seed.tenantA.tenantId,
      actors,
      extraArgs: {
        categoryId: catAId,
        name: "x",
        orderedIds: [catAId],
      },
    });
    expect(pairs).toBe(30); // 5 functions × 6 actors
    expect(leaks).toEqual([]);
  });
});
