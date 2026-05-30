import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  deletePublishedMenu,
  getPublishedMenu,
  readTenantItemsAvailability,
  writePublishedMenu,
} from "./menuStore";
import { seedTwoTenantsAllRoles } from "./fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/tenancy/, so normalise every key to be relative to the convex root
// (../../) so convex-test's findModulesRoot has ONE common prefix (same shape as
// the customer / audit suites alongside).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/tenancy/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * B-MENU-PUBLICATION slice 1 — store seam for the `publishedMenus` snapshot
 * (ADR 0015 + ADR 0010), written BEFORE the implementation (TDD red).
 *
 * This slice introduces the [[Instantané publié]] schema + the three sanctioned
 * seam helpers (`getPublishedMenu` / `writePublishedMenu` / `deletePublishedMenu`)
 * that the next slices (publish mutation, public read pivot) will consume. NO
 * Convex function is registered in this slice — we drive the helpers directly via
 * `t.run((ctx) => ...)`, exactly like the test harness is supposed to (the lint
 * exempts test files under `convex` from `no-untenanted-query`).
 *
 * The pivot of ADR 0015 — « la rupture ne doit pas exiger une republication
 * globale » — is enforced STRUCTURALLY here: the snapshot payload schema does NOT
 * carry `available`. A type-level assertion below pins that contract so a future
 * edit accidentally re-introducing `available` on the snapshot fails the build.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A minimal valid snapshot payload for tenant A (one category, one item). */
function payloadAlpha(
  categoryId: Id<"menuCategories">,
  itemId: Id<"menuItems">,
) {
  return {
    categories: [
      {
        _id: categoryId,
        name: "Smashs",
        items: [
          {
            _id: itemId,
            name: "Smash Double",
            description: "Double smash burger.",
            basePrice: 1200,
            allergens: ["gluten", "lait"] as const,
            photoStorageId: undefined,
            modifierGroups: [],
          },
        ],
      },
    ],
  };
}

/** A different payload for tenant A (different name + 2 categories) — proves replace. */
function payloadBeta(
  cat1: Id<"menuCategories">,
  cat2: Id<"menuCategories">,
  item: Id<"menuItems">,
) {
  return {
    categories: [
      {
        _id: cat1,
        name: "Smashs (v2)",
        items: [
          {
            _id: item,
            name: "Smash Triple",
            description: "Triple smash burger.",
            basePrice: 1500,
            allergens: ["gluten"] as const,
            photoStorageId: undefined,
            modifierGroups: [],
          },
        ],
      },
      {
        _id: cat2,
        name: "Sides",
        items: [],
      },
    ],
  };
}

describe("B-MENU-PUBLICATION slice 1 — publishedMenus seam (ADR 0015 + 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let catA1: Id<"menuCategories">;
  let catA2: Id<"menuCategories">;
  let itemA1: Id<"menuItems">;
  let catB1: Id<"menuCategories">;
  let itemB1: Id<"menuItems">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Seed one category + one item per tenant so payloads carry real ids the
    // schema validator accepts.
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const ca1 = await ctx.db.insert("menuCategories", {
        tenantId: seed.tenantA.tenantId,
        name: "Smashs",
        order: 0,
        createdAt: now,
      });
      const ca2 = await ctx.db.insert("menuCategories", {
        tenantId: seed.tenantA.tenantId,
        name: "Sides",
        order: 1,
        createdAt: now,
      });
      const ia1 = await ctx.db.insert("menuItems", {
        tenantId: seed.tenantA.tenantId,
        categoryId: ca1,
        name: "Smash Double",
        description: "Double smash burger.",
        basePrice: 1200,
        allergens: ["gluten", "lait"],
        available: true,
        order: 0,
        createdAt: now,
      });
      const cb1 = await ctx.db.insert("menuCategories", {
        tenantId: seed.tenantB.tenantId,
        name: "Pizzas",
        order: 0,
        createdAt: now,
      });
      const ib1 = await ctx.db.insert("menuItems", {
        tenantId: seed.tenantB.tenantId,
        categoryId: cb1,
        name: "Margherita",
        description: "Tomate, mozza, basilic.",
        basePrice: 1100,
        allergens: ["gluten", "lait"],
        available: true,
        order: 0,
        createdAt: now,
      });
      return { ca1, ca2, ia1, cb1, ib1 };
    });
    catA1 = ids.ca1;
    catA2 = ids.ca2;
    itemA1 = ids.ia1;
    catB1 = ids.cb1;
    itemB1 = ids.ib1;
  });

  it("getPublishedMenu returns null for a tenant that has never published", async () => {
    const got = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantA.tenantId),
    );
    expect(got).toBeNull();
  });

  it("writePublishedMenu then getPublishedMenu returns the same payload + publishedAt", async () => {
    const payload = payloadAlpha(catA1, itemA1);
    const nowMs = 1_700_000_000_000;
    await t.run((ctx) =>
      writePublishedMenu(ctx, seed.tenantA.tenantId, payload, nowMs),
    );
    const got = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantA.tenantId),
    );
    expect(got).not.toBeNull();
    expect(got?.tenantId).toBe(seed.tenantA.tenantId);
    expect(got?.publishedAt).toBe(nowMs);
    expect(got?.payload).toEqual(payload);
  });

  it("writePublishedMenu replaces the previous snapshot ATOMICALLY (no leftover rows)", async () => {
    // First publish: alpha.
    await t.run((ctx) =>
      writePublishedMenu(
        ctx,
        seed.tenantA.tenantId,
        payloadAlpha(catA1, itemA1),
        1_000,
      ),
    );
    // Second publish: beta — must REPLACE, not accumulate.
    await t.run((ctx) =>
      writePublishedMenu(
        ctx,
        seed.tenantA.tenantId,
        payloadBeta(catA1, catA2, itemA1),
        2_000,
      ),
    );

    // The read seam returns the LATEST.
    const got = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantA.tenantId),
    );
    expect(got?.publishedAt).toBe(2_000);
    expect(got?.payload).toEqual(payloadBeta(catA1, catA2, itemA1));

    // And there is exactly ONE row for that tenant — no leftover of the previous
    // snapshot in the table (atomic replace in a single tx).
    const rowCount = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("publishedMenus")
            .withIndex("by_tenant", (q) =>
              q.eq("tenantId", seed.tenantA.tenantId),
            )
            .collect()
        ).length,
    );
    expect(rowCount).toBe(1);
  });

  it("deletePublishedMenu wipes the snapshot — getPublishedMenu returns null again", async () => {
    await t.run((ctx) =>
      writePublishedMenu(
        ctx,
        seed.tenantA.tenantId,
        payloadAlpha(catA1, itemA1),
        1_000,
      ),
    );
    await t.run((ctx) => deletePublishedMenu(ctx, seed.tenantA.tenantId));
    const got = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantA.tenantId),
    );
    expect(got).toBeNull();
  });

  it("deletePublishedMenu on a never-published tenant is a no-op (idempotent)", async () => {
    // Should not throw — and the snapshot still reads null afterwards.
    await t.run((ctx) => deletePublishedMenu(ctx, seed.tenantA.tenantId));
    const got = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantA.tenantId),
    );
    expect(got).toBeNull();
    // Also calling delete twice in a row stays a no-op.
    await t.run((ctx) => deletePublishedMenu(ctx, seed.tenantA.tenantId));
    const got2 = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantA.tenantId),
    );
    expect(got2).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Cross-tenant fuzz — the ADR 0010 non-negotiable.
  // ---------------------------------------------------------------------------

  it("cross-tenant fuzz: writing tenant A does NOT appear in tenant B's read", async () => {
    await t.run((ctx) =>
      writePublishedMenu(
        ctx,
        seed.tenantA.tenantId,
        payloadAlpha(catA1, itemA1),
        1_000,
      ),
    );
    const gotB = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantB.tenantId),
    );
    expect(gotB).toBeNull();
  });

  it("cross-tenant fuzz: two tenants keep separate snapshots, side-by-side", async () => {
    const pA = payloadAlpha(catA1, itemA1);
    const pB = {
      categories: [
        {
          _id: catB1,
          name: "Pizzas",
          items: [
            {
              _id: itemB1,
              name: "Margherita",
              description: "Tomate, mozza, basilic.",
              basePrice: 1100,
              allergens: ["gluten", "lait"] as const,
              photoStorageId: undefined,
              modifierGroups: [],
            },
          ],
        },
      ],
    };
    await t.run((ctx) =>
      writePublishedMenu(ctx, seed.tenantA.tenantId, pA, 1_000),
    );
    await t.run((ctx) =>
      writePublishedMenu(ctx, seed.tenantB.tenantId, pB, 2_000),
    );
    const gotA = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantA.tenantId),
    );
    const gotB = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantB.tenantId),
    );
    expect(gotA?.payload).toEqual(pA);
    expect(gotB?.payload).toEqual(pB);
    // Re-publish tenant A — tenant B's snapshot must stay intact.
    await t.run((ctx) =>
      writePublishedMenu(
        ctx,
        seed.tenantA.tenantId,
        payloadBeta(catA1, catA2, itemA1),
        3_000,
      ),
    );
    const gotBAfter = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantB.tenantId),
    );
    expect(gotBAfter?.payload).toEqual(pB);
    expect(gotBAfter?.publishedAt).toBe(2_000);
  });

  it("cross-tenant fuzz: deleting tenant A's snapshot does NOT touch tenant B", async () => {
    await t.run((ctx) =>
      writePublishedMenu(
        ctx,
        seed.tenantA.tenantId,
        payloadAlpha(catA1, itemA1),
        1_000,
      ),
    );
    await t.run((ctx) =>
      writePublishedMenu(
        ctx,
        seed.tenantB.tenantId,
        {
          categories: [
            {
              _id: catB1,
              name: "Pizzas",
              items: [
                {
                  _id: itemB1,
                  name: "Margherita",
                  description: "Tomate, mozza, basilic.",
                  basePrice: 1100,
                  allergens: ["gluten", "lait"] as const,
                  photoStorageId: undefined,
                  modifierGroups: [],
                },
              ],
            },
          ],
        },
        2_000,
      ),
    );
    await t.run((ctx) => deletePublishedMenu(ctx, seed.tenantA.tenantId));
    const gotB = await t.run((ctx) =>
      getPublishedMenu(ctx, seed.tenantB.tenantId),
    );
    expect(gotB).not.toBeNull();
    expect(gotB?.tenantId).toBe(seed.tenantB.tenantId);
    expect(gotB?.publishedAt).toBe(2_000);
  });

  // ---------------------------------------------------------------------------
  // ADR 0015 PIVOT — the snapshot does NOT carry `available`.
  // ---------------------------------------------------------------------------

  it("the snapshot payload type does NOT carry `available` (ADR 0015 pivot, type-level)", () => {
    // The pivot of ADR 0015 is « la rupture ne doit pas exiger une republication
    // globale » → `available` is an overlay read live from `menuItems` (slice 6),
    // it MUST NOT live on the snapshot. Pinned at the TYPE level so a future edit
    // re-introducing it accidentally fails the build.
    type PublishedMenuPayload = NonNullable<
      Awaited<ReturnType<typeof getPublishedMenu>>
    >["payload"];
    type Item = PublishedMenuPayload["categories"][number]["items"][number];
    // @ts-expect-error — `available` MUST NOT exist on the snapshot item shape.
    type _NoAvailable = Item["available"];
    expect(true).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // B-MENU-PUBLICATION slice 3 (#160) — live `available` overlay helper.
  // ---------------------------------------------------------------------------

  it("readTenantItemsAvailability returns the LIVE `available` map for tenant-owned ids", async () => {
    // The publication snapshot strips `available` (ADR 0015 pivot) — slice 3's
    // `getPublicMenu` reads it LIVE from `menuItems` per item id. This seam is
    // the sanctioned bulk-read helper for that overlay.
    const itemA2 = await t.run(async (ctx) => {
      const id = await ctx.db.insert("menuItems", {
        tenantId: seed.tenantA.tenantId,
        categoryId: catA1,
        name: "Smash Triple",
        description: "Triple smash burger.",
        basePrice: 1500,
        allergens: [],
        available: false,
        order: 1,
        createdAt: Date.now(),
      });
      return id;
    });
    const map = await t.run((ctx) =>
      readTenantItemsAvailability(ctx, seed.tenantA.tenantId, [itemA1, itemA2]),
    );
    expect(map.get(itemA1)).toBe(true);
    expect(map.get(itemA2)).toBe(false);
  });

  it("readTenantItemsAvailability omits ids that don't belong to the tenant (live overlay cannot leak across tenants)", async () => {
    const map = await t.run((ctx) =>
      readTenantItemsAvailability(ctx, seed.tenantA.tenantId, [
        itemA1,
        itemB1, // foreign id — must be silently omitted (snapshot row remains, overlay treats it as unknown)
      ]),
    );
    expect(map.get(itemA1)).toBe(true);
    expect(map.has(itemB1)).toBe(false);
  });

  it("readTenantItemsAvailability omits ids whose live row was deleted (caller treats missing as `false`)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.delete(itemA1);
    });
    const map = await t.run((ctx) =>
      readTenantItemsAvailability(ctx, seed.tenantA.tenantId, [itemA1]),
    );
    expect(map.has(itemA1)).toBe(false);
  });

  it("readTenantItemsAvailability returns an empty map for an empty input list (no-op)", async () => {
    const map = await t.run((ctx) =>
      readTenantItemsAvailability(ctx, seed.tenantA.tenantId, []),
    );
    expect(map.size).toBe(0);
  });
});
