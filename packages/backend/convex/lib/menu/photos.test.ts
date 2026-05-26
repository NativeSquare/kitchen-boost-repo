import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
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
 * 2.2-F — item photos via NATIVE Convex file storage (PRD 10 §5/§6,
 * client-ordering CONTEXT "Item", ADR 0010), written BEFORE the implementation
 * (TDD red). The [[KB Manager]] gets an upload URL, uploads the blob client-side,
 * then ATTACHES the resulting `_storage` id to one of its items; the photo URL is
 * served read-side (already wired into `getPublicMenu`). Replacing or removing a
 * photo never leaves an orphan blob. Every photo mutation is tenant-scoped via a
 * `kb_manager` `tenantMutation` and fuzzed cross-tenant.
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

async function makeItem(
  t: ReturnType<typeof convexTest>,
  seed: Seed,
  categoryId: string,
): Promise<string> {
  return t
    .withIdentity({ subject: seed.tenantA.managerId })
    .mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId,
      name: "Smash Double",
      description: "",
      basePrice: 1290,
      allergens: [],
    });
}

/** Store a fake blob and return its `_storage` id. */
async function storeBlob(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"_storage">> {
  return t.run(async (ctx) => ctx.storage.store(new Blob(["png-bytes"])));
}

describe("2.2-F item photos — tenant-scoped via kb_manager", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let catA: string;
  let itemA: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    catA = await makeCategory(t, seed);
    itemA = await makeItem(t, seed, catA);
  });

  it("generateUploadUrl returns an upload URL for a kb_manager", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const url = await asManager.mutation(
      api.lib.menu.photos.generateUploadUrl,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(url).toBeTypeOf("string");
    expect(url.length).toBeGreaterThan(0);
  });

  it("attachPhoto stores the storage id on the item, served via getPublicMenu", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const storageId = await storeBlob(t);
    await asManager.mutation(api.lib.menu.photos.attachPhoto, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemA,
      storageId,
    });

    // The id is persisted on the tenant-scoped item.
    const item = await t.run(async (ctx) => ctx.db.get(itemA as never));
    expect((item as { photoStorageId?: string }).photoStorageId).toBe(
      storageId,
    );

    // The public menu resolves a non-null photo URL for the item.
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const served = menu.categories
      .flatMap((c) => c.items)
      .find((i) => i._id === itemA);
    expect(served?.photoUrl).toBeTypeOf("string");
  });

  it("replacing a photo deletes the previous blob (no orphan)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const first = await storeBlob(t);
    const second = await storeBlob(t);

    await asManager.mutation(api.lib.menu.photos.attachPhoto, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemA,
      storageId: first,
    });
    await asManager.mutation(api.lib.menu.photos.attachPhoto, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemA,
      storageId: second,
    });

    // The first (replaced) blob is gone; the second is live and attached.
    const firstUrl = await t.run(async (ctx) => ctx.storage.getUrl(first));
    expect(firstUrl).toBeNull();
    const secondUrl = await t.run(async (ctx) => ctx.storage.getUrl(second));
    expect(secondUrl).not.toBeNull();
    const item = await t.run(async (ctx) => ctx.db.get(itemA as never));
    expect((item as { photoStorageId?: string }).photoStorageId).toBe(second);
  });

  it("removePhoto deletes the blob and clears the field (no orphan)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const storageId = await storeBlob(t);
    await asManager.mutation(api.lib.menu.photos.attachPhoto, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemA,
      storageId,
    });

    await asManager.mutation(api.lib.menu.photos.removePhoto, {
      tenantId: seed.tenantA.tenantId,
      itemId: itemA,
    });

    const url = await t.run(async (ctx) => ctx.storage.getUrl(storageId));
    expect(url).toBeNull();
    const item = await t.run(async (ctx) => ctx.db.get(itemA as never));
    expect(
      (item as { photoStorageId?: string }).photoStorageId,
    ).toBeUndefined();
    // And the public menu serves null again.
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const served = menu.categories
      .flatMap((c) => c.items)
      .find((i) => i._id === itemA);
    expect(served?.photoUrl).toBeNull();
  });

  it("removePhoto on an item without a photo is a no-op", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.menu.photos.removePhoto, {
        tenantId: seed.tenantA.tenantId,
        itemId: itemA,
      }),
    ).resolves.toBeNull();
  });

  it("attachPhoto refuses an itemId owned by another tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const storageId = await storeBlob(t);
    // tenant A manager tries to attach a photo to tenant A's item but declares
    // tenant B — wrapper forbids. And declaring tenant A with a foreign item id
    // is NOT_FOUND. Here: a foreign item id under the caller's own tenant.
    const bCat = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .mutation(api.lib.menu.categories.create, {
        tenantId: seed.tenantB.tenantId,
        name: "B-cat",
      });
    const bItem = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .mutation(api.lib.menu.items.create, {
        tenantId: seed.tenantB.tenantId,
        categoryId: bCat,
        name: "B-item",
        description: "",
        basePrice: 100,
        allergens: [],
      });
    await expect(
      asManager.mutation(api.lib.menu.photos.attachPhoto, {
        tenantId: seed.tenantA.tenantId,
        itemId: bItem, // tenant B's item
        storageId,
      }),
    ).rejects.toThrow();
  });

  it("a kb_admin (root) can attach a photo on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const bCat = await asAdmin.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const bItem = await asAdmin.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "B-item",
      description: "",
      basePrice: 100,
      allergens: [],
    });
    const storageId = await storeBlob(t);
    await asAdmin.mutation(api.lib.menu.photos.attachPhoto, {
      tenantId: seed.tenantB.tenantId,
      itemId: bItem,
      storageId,
    });
    const item = await t.run(async (ctx) => ctx.db.get(bItem as never));
    expect((item as { photoStorageId?: string }).photoStorageId).toBe(
      storageId,
    );
  });
});

describe("2.2-F cross-tenant fuzz — item photo mutations, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let catA: string;
  let itemA: string;
  let storageId: Id<"_storage">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    catA = await makeCategory(t, seed);
    itemA = await makeItem(t, seed, catA);
    storageId = await storeBlob(t);
  });

  it("every photo mutation rejects every unauthorized actor on tenant A", async () => {
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
        api.lib.menu.photos.generateUploadUrl,
        api.lib.menu.photos.attachPhoto,
        api.lib.menu.photos.removePhoto,
      ],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors,
      extraArgs: { itemId: itemA, storageId },
    });
    expect(pairs).toBe(18); // 3 mutations × 6 actors
    expect(leaks).toEqual([]);
  });
});
