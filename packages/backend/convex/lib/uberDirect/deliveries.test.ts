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
    path.startsWith("./") ? `../../lib/uberDirect/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.6-A — `deliveries` tenant-scoped persistence, written BEFORE implementation
 * (TDD red). Every read/write goes through `tenantQuery` / `tenantMutation`
 * (`allow: ["kb_manager", "staff"]` for reads — KB Orders is operational; writes
 * are kb_manager-scoped here), strictly keyed on `ctx.tenantId`. No raw
 * `ctx.db.query("deliveries")` in this business module (`no-untenanted-query` is
 * active, ADR 0010); the table is reached only through the sanctioned
 * `lib/tenancy/deliveriesStore` seam. Ships a cross-tenant fuzz suite.
 *
 * No real Uber call here — pure persistence + isolation. A delivery row in C&C
 * mode has no `uberDeliveryId` (PRD 40 §4).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.6-A deliveries — tenant-scoped persistence via wrappers", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("creates a delivery-mode row scoped to the calling tenant and lists it", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    const id = await asManager.mutation(
      api.lib.uberDirect.deliveries.createDelivery,
      {
        tenantId: seed.tenantA.tenantId,
        orderId: "order_a_1",
        mode: "delivery",
        status: "pending",
        quoteId: "quote_1",
        quoteFee: 590,
      },
    );
    expect(id).toBeTypeOf("string");

    const rows = await asManager.query(
      api.lib.uberDirect.deliveries.listDeliveries,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].mode).toBe("delivery");
    expect(rows[0].uberDeliveryId).toBeUndefined(); // not assigned yet
  });

  it("a click_collect row carries no uberDeliveryId", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(
      api.lib.uberDirect.deliveries.createDelivery,
      {
        tenantId: seed.tenantA.tenantId,
        orderId: "order_cc_1",
        mode: "click_collect",
        status: "pending",
      },
    );
    const row = await asManager.query(
      api.lib.uberDirect.deliveries.getDeliveryByOrder,
      { tenantId: seed.tenantA.tenantId, orderId: "order_cc_1" },
    );
    expect(row?._id).toBe(id);
    expect(row?.mode).toBe("click_collect");
    expect(row?.uberDeliveryId).toBeUndefined();
  });

  it("patches Uber tracking fields (delivery id, courier, ETAs) on an existing row", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id = await asManager.mutation(
      api.lib.uberDirect.deliveries.createDelivery,
      {
        tenantId: seed.tenantA.tenantId,
        orderId: "order_a_2",
        mode: "delivery",
        status: "pending",
      },
    );
    await asManager.mutation(api.lib.uberDirect.deliveries.patchDelivery, {
      tenantId: seed.tenantA.tenantId,
      deliveryId: id,
      patch: {
        uberDeliveryId: "del_uber_123",
        status: "pickup",
        courierName: "Sami",
        courierPhone: "+33600000000",
        pickupEta: 1_700_000_000_000,
      },
    });

    const row = await asManager.query(
      api.lib.uberDirect.deliveries.getDeliveryByOrder,
      { tenantId: seed.tenantA.tenantId, orderId: "order_a_2" },
    );
    expect(row?.uberDeliveryId).toBe("del_uber_123");
    expect(row?.status).toBe("pickup");
    expect(row?.courierName).toBe("Sami");
  });

  it("staff (KB Orders, operational) can read deliveries but NOT create them", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.deliveries.createDelivery, {
        tenantId: seed.tenantA.tenantId,
        orderId: "order_a_3",
        mode: "delivery",
        status: "pending",
      });

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const rows = await asStaff.query(
      api.lib.uberDirect.deliveries.listDeliveries,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(rows).toHaveLength(1);

    await expect(
      asStaff.mutation(api.lib.uberDirect.deliveries.createDelivery, {
        tenantId: seed.tenantA.tenantId,
        orderId: "order_a_4",
        mode: "delivery",
        status: "pending",
      }),
    ).rejects.toThrow();
  });

  it("a patch targeting a foreign tenant's deliveryId throws (ownership re-check)", async () => {
    const aId = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.deliveries.createDelivery, {
        tenantId: seed.tenantA.tenantId,
        orderId: "order_a_5",
        mode: "delivery",
        status: "pending",
      });

    // B's manager, on B's own (accessible) tenant, must not patch A's row.
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.uberDirect.deliveries.patchDelivery, {
          tenantId: seed.tenantB.tenantId,
          deliveryId: aId,
          patch: { status: "canceled" },
        }),
    ).rejects.toThrow();
  });

  it("a suspended tenant keeps its historical deliveries (no hard delete V1)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.uberDirect.deliveries.createDelivery, {
      tenantId: seed.tenantA.tenantId,
      orderId: "order_hist_1",
      mode: "delivery",
      status: "delivered",
    });

    // Suspend the tenant directly (lifecycle is owned by multi-tenant chantier).
    await t.run(async (ctx) =>
      ctx.db.patch(seed.tenantA.tenantId, { status: "suspended" }),
    );

    const rows = await asManager.query(
      api.lib.uberDirect.deliveries.listDeliveries,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("delivered");
  });
});

describe("2.6-A cross-tenant fuzz — deliveries wrappers, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Seed a delivery on tenant A so the read paths have something to (not) leak.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.deliveries.createDelivery, {
        tenantId: seed.tenantA.tenantId,
        orderId: "order_fuzz_1",
        mode: "delivery",
        status: "pending",
      });
  });

  it("create / list / getByOrder reject every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.uberDirect.deliveries.createDelivery,
        api.lib.uberDirect.deliveries.listDeliveries,
        api.lib.uberDirect.deliveries.getDeliveryByOrder,
      ],
      isQuery: (fn) => fn !== api.lib.uberDirect.deliveries.createDelivery,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {
        orderId: "order_fuzz_1",
        mode: "delivery",
        status: "pending",
      },
    });
    expect(pairs).toBe(15);
    expect(leaks).toEqual([]);
  });
});
