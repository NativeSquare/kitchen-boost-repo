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

// convex-test needs the function modules; the array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/orders/, so Vite emits keys relative to THIS dir (`./workflow.ts`,
// `../tenancy/...`, `../../table/...`). Re-anchor every `./x` key at the convex
// root so convex-test's findModulesRoot has ONE common prefix (same intent as the
// orders / cart / menu suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/orders/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.3-C — `confirmPayment`: the ORDER-SIDE handler of the payment confirmation,
 * written BEFORE the implementation (TDD red).
 *
 * On a confirmed payment (the Stripe event relayed by 2.5 — NOT built here), in
 * ONE mutation (Convex transaction): transition `en attente de paiement →
 * nouvelle` (the order becomes visible to the resto), stamp `paidAt`, FREEZE the
 * `pricingSnapshot`, append a `nouvelle` `orderEvents`, and increment
 * `customerOrdersPerTenant` (totalOrders / lastOrderAt / ltv) for the order's
 * `(customerId, tenantId)`. Consumed idempotently via `withIdempotence` so a
 * replayed event neither re-transitions nor double-counts. Ships a cross-tenant
 * fuzz suite (ADR 0010).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PRICING = {
  subtotal: 1290,
  deliveryFee: 295,
  total: 1585, // cents — the amount actually charged
};

/** A GLOBAL `customers` fiche, seeded directly for the order FK. */
async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    return ctx.db.insert("customers", { userId, email, createdAt: Date.now() });
  });
}

/**
 * Seed a pending order (status `en attente de paiement`, no pricingSnapshot, no
 * event) on `tenantId` for `customerId` — exactly the shape 2.3-B leaves at
 * checkout. Returns the new order id.
 */
async function seedPendingOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
): Promise<Id<"orders">> {
  return t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status: "en attente de paiement",
      mode: "delivery",
      source: "direct",
      address: "12 rue de Paris, 91000 Évry",
      createdAt: Date.now(),
    });
    await ctx.db.insert("orderItems", {
      tenantId,
      orderId,
      itemName: "Smash Double",
      unitPrice: 1290,
      quantity: 1,
      modifiers: [],
      allergens: ["gluten", "lait"],
    });
    return orderId;
  });
}

/** Read one order with its events directly (test-only, bypassing wrappers). */
async function readOrder(
  t: ReturnType<typeof convexTest>,
  orderId: Id<"orders">,
) {
  return t.run(async (ctx) => {
    const order = await ctx.db.get(orderId);
    const events = await ctx.db
      .query("orderEvents")
      .withIndex("by_order", (q) =>
        q
          .eq("tenantId", order?.tenantId as Id<"tenants">)
          .eq("orderId", orderId),
      )
      .collect();
    return { order, events };
  });
}

/** Read the (tenant, customer) link row, or null. */
async function readLink(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("customerOrdersPerTenant")
      .withIndex("by_tenant_customer", (q) =>
        q.eq("tenantId", tenantId).eq("customerId", customerId),
      )
      .unique(),
  );
}

describe("2.3-C confirmPayment — payment → nouvelle + stats", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater-a@x.fr");
    orderId = await seedPendingOrder(t, seed.tenantA.tenantId, customerA);
  });

  it("transitions en attente de paiement → nouvelle, stamping paidAt + pricingSnapshot + a 'nouvelle' event", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    await asManager.mutation(api.lib.orders.workflow.confirmPayment, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventId: "evt_1",
      pricingSnapshot: PRICING,
    });

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("nouvelle");
    expect(order?.paidAt).toBeTypeOf("number");
    expect(order?.pricingSnapshot?.total).toBe(1585);
    expect(order?.pricingSnapshot?.subtotal).toBe(1290);
    expect(order?.pricingSnapshot?.deliveryFee).toBe(295);
    // The workflow audit starts at `nouvelle` (the pending order had no event).
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("nouvelle");
    expect(events[0].at).toBeTypeOf("number");
  });

  it("creates the customerOrdersPerTenant link on the first paid order (totalOrders=1, ltv in euros)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    await asManager.mutation(api.lib.orders.workflow.confirmPayment, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventId: "evt_1",
      pricingSnapshot: PRICING,
    });

    const link = await readLink(t, seed.tenantA.tenantId, customerA);
    expect(link).not.toBeNull();
    expect(link?.totalOrders).toBe(1);
    expect(link?.lastOrderAt).toBeTypeOf("number");
    // ltv cumulative is stored in EUROS (the VIP segment threshold is 150€) —
    // total is in cents, so it converts (1585 cents → 15.85 €).
    expect(link?.ltv).toBeCloseTo(15.85, 5);
  });

  it("increments the existing link on a subsequent paid order (no duplicate row)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    await asManager.mutation(api.lib.orders.workflow.confirmPayment, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventId: "evt_1",
      pricingSnapshot: PRICING,
    });

    const order2 = await seedPendingOrder(t, seed.tenantA.tenantId, customerA);
    await asManager.mutation(api.lib.orders.workflow.confirmPayment, {
      tenantId: seed.tenantA.tenantId,
      orderId: order2,
      eventId: "evt_2",
      pricingSnapshot: { subtotal: 1000, deliveryFee: 0, total: 1000 },
    });

    const link = await readLink(t, seed.tenantA.tenantId, customerA);
    expect(link?.totalOrders).toBe(2);
    expect(link?.ltv).toBeCloseTo(25.85, 5); // 15.85 + 10.00

    // Exactly one link row for this (tenant, customer) pair.
    const allLinks = await t.run((ctx) =>
      ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_tenant_customer", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("customerId", customerA),
        )
        .collect(),
    );
    expect(allLinks).toHaveLength(1);
  });

  it("idempotence: replaying the same event neither re-transitions nor double-counts", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const call = () =>
      asManager.mutation(api.lib.orders.workflow.confirmPayment, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        eventId: "evt_dup",
        pricingSnapshot: PRICING,
      });

    await call();
    await call(); // redelivery — must be a clean no-op

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("nouvelle");
    // Still exactly one 'nouvelle' event (no second transition).
    expect(events).toHaveLength(1);

    const link = await readLink(t, seed.tenantA.tenantId, customerA);
    expect(link?.totalOrders).toBe(1); // counted once
    expect(link?.ltv).toBeCloseTo(15.85, 5);
  });

  it("rejects confirming an order that is not 'en attente de paiement' (state machine guard)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Move it past pending so a confirm signal must be refused.
    await asManager.mutation(api.lib.orders.workflow.confirmPayment, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventId: "evt_1",
      pricingSnapshot: PRICING,
    });

    // A DIFFERENT event id for the same (already-nouvelle) order: not idempotent,
    // so it reaches the guard, which must reject the invalid transition.
    await expect(
      asManager.mutation(api.lib.orders.workflow.confirmPayment, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        eventId: "evt_other",
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow();

    // The order is unchanged: still one 'nouvelle' event, link still counts once.
    const { events } = await readOrder(t, orderId);
    expect(events).toHaveLength(1);
    const link = await readLink(t, seed.tenantA.tenantId, customerA);
    expect(link?.totalOrders).toBe(1);
  });

  it("confirming a foreign tenant's order throws (ownership re-check, no cross-tenant write)", async () => {
    // tenant B's manager tries to confirm tenant A's pending order via tenant B.
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.orders.workflow.confirmPayment, {
          tenantId: seed.tenantB.tenantId,
          orderId,
          eventId: "evt_x",
          pricingSnapshot: PRICING,
        }),
    ).rejects.toThrow();

    // A's order is untouched and no link leaked onto either tenant.
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("en attente de paiement");
    expect(events).toHaveLength(0);
    expect(await readLink(t, seed.tenantB.tenantId, customerA)).toBeNull();
    expect(await readLink(t, seed.tenantA.tenantId, customerA)).toBeNull();
  });
});

describe("2.3-C cross-tenant fuzz — confirmPayment rejects unauthorized actors (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater-fuzz@x.fr");
    orderId = await seedPendingOrder(t, seed.tenantA.tenantId, customerA);
  });

  it("every unauthorized actor on tenant A is rejected", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.orders.workflow.confirmPayment],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {
        orderId,
        eventId: "evt_fuzz",
        pricingSnapshot: PRICING,
      },
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });
});
