import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { isLegalTransition } from "../tenancy";
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
 * 2.3-D — the RESTO WORKFLOW state machine (PRD 20 §5 + the issue body), written
 * BEFORE the implementation (TDD red).
 *
 * Transitions (kb_manager + staff, each writing a timestamped `orderEvents`):
 *   nouvelle        --acknowledge--------> en préparation
 *   en préparation  --markPrepared-------> prête
 *   prête           --markHandedOff------> remise            (delivery: awaits 2.6)
 *   prête           --markHandedOff------> remise → collectée (pickup: immediate)
 *
 * `assertLegalTransition` rejects every non-listed edge (state jumps, re-transition
 * of a terminal livrée/collectée/refusée). Kitchen reads: `tenantOrders` (live
 * queue, NEVER `en attente de paiement`) + `tenantOrderHistory` (terminal). Client
 * reads: `myOrders` / `myOrder` (customerQuery, self). Ships a cross-tenant fuzz
 * suite over every exported query/mutation (ADR 0010).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A GLOBAL `customers` fiche linked to a `users` row, seeded directly. */
async function seedCustomerWithUser(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<{ userId: Id<"users">; customerId: Id<"customers"> }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    const customerId = await ctx.db.insert("customers", {
      userId,
      email,
      createdAt: Date.now(),
    });
    return { userId, customerId };
  });
}

/**
 * Seed an order already in `status` on `tenantId` for `customerId`, with one frozen
 * line. No event rows are seeded — the workflow audit is asserted via the mutations.
 */
async function seedOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  status:
    | "en attente de paiement"
    | "nouvelle"
    | "en préparation"
    | "prête"
    | "remise"
    | "livrée"
    | "collectée"
    | "refusée",
  mode: "delivery" | "pickup" = "delivery",
): Promise<Id<"orders">> {
  return t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status,
      mode,
      source: "direct",
      address: mode === "delivery" ? "12 rue de Paris, 91000 Évry" : undefined,
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

/** Read one order + its time-ordered events directly (test-only). */
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

describe("2.3-D workflow transitions — legal edges advance + stamp events", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = (await seedCustomerWithUser(t, "eater-a@x.fr")).customerId;
  });

  it("acknowledge: nouvelle → en préparation, stamping acceptedAt + an event", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );

    await asManager.mutation(api.lib.orders.workflow.acknowledge, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("en préparation");
    expect(order?.acceptedAt).toBeTypeOf("number");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("en préparation");
    expect(events[0].actorUserId).toBe(seed.tenantA.managerId);
    expect(events[0].at).toBeTypeOf("number");
  });

  it("markPrepared: en préparation → prête, stamping readyAt + an event", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "en préparation",
    );

    await asStaff.mutation(api.lib.orders.workflow.markPrepared, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("prête");
    expect(order?.readyAt).toBeTypeOf("number");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("prête");
    expect(events[0].actorUserId).toBe(seed.tenantA.staffId);
  });

  it("markHandedOff (delivery): prête → remise, stamping handedOverAt, awaiting 2.6", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "prête",
      "delivery",
    );

    await asManager.mutation(api.lib.orders.workflow.markHandedOff, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const { order, events } = await readOrder(t, orderId);
    // Delivery STOPS at remise — `livrée` is driven by Uber Direct events (2.6).
    expect(order?.status).toBe("remise");
    expect(order?.handedOverAt).toBeTypeOf("number");
    expect(order?.completedAt).toBeUndefined();
    expect(events.map((e) => e.status)).toEqual(["remise"]);
  });

  it("markHandedOff (pickup): prête → remise → collectée, archived immediately", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "prête",
      "pickup",
    );

    await asManager.mutation(api.lib.orders.workflow.markHandedOff, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const { order, events } = await readOrder(t, orderId);
    // Click & collect is terminal at handoff: remise then collectée immediately.
    expect(order?.status).toBe("collectée");
    expect(order?.handedOverAt).toBeTypeOf("number");
    expect(order?.completedAt).toBeTypeOf("number");
    // Both transitions are audited (PRD 20 §5 remise → collectée).
    expect(events.map((e) => e.status)).toEqual(["remise", "collectée"]);
  });

  it("walks the full delivery happy path nouvelle → en préparation → prête → remise", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );

    await asManager.mutation(api.lib.orders.workflow.acknowledge, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    await asManager.mutation(api.lib.orders.workflow.markPrepared, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    await asManager.mutation(api.lib.orders.workflow.markHandedOff, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("remise");
    expect(events.map((e) => e.status)).toEqual([
      "en préparation",
      "prête",
      "remise",
    ]);
  });
});

describe("#108 state machine — the aborted-before-transmission edge", () => {
  it("`en attente de paiement → refusée` is legal (Cmd avortée before transmission)", () => {
    // A delivery course that fails post-payment aborts the order while it is still
    // `en attente de paiement` (never transmitted to KB Orders) — this terminal edge
    // is what the auto-refund uses, so the order leaves without ever being `nouvelle`.
    expect(isLegalTransition("en attente de paiement", "refusée")).toBe(true);
  });

  it("the kitchen confirm edge `en attente de paiement → nouvelle` stays legal", () => {
    expect(isLegalTransition("en attente de paiement", "nouvelle")).toBe(true);
  });

  it("a terminal order still has no outgoing edge (refusée is terminal)", () => {
    expect(isLegalTransition("refusée", "nouvelle")).toBe(false);
    expect(isLegalTransition("livrée", "refusée")).toBe(false);
  });
});

describe("#413 state machine — refuse from `en préparation` / `prête` is legal (3-step variant)", () => {
  // PRD 20 §6a — the cuisinier can still refuse an order in flight (rupture
  // découverte au milieu de la cuisson, incident hygiène). The anti-fat-
  // finger discipline lives in the UI (3-step dialog #413), NOT in the
  // state machine: the backend just adds the two edges and reuses the same
  // refund / notif pipeline as `nouvelle → refusée`.
  it("`en préparation → refusée` is legal (kitchen had started but must abort)", () => {
    expect(isLegalTransition("en préparation", "refusée")).toBe(true);
  });

  it("`prête → refusée` is legal (cooked but cannot be handed off — must abort + refund)", () => {
    expect(isLegalTransition("prête", "refusée")).toBe(true);
  });

  it("post-handoff states stay non-refusable (no refund door after handoff)", () => {
    // Once the order has been handed off to a courier / client, it is no
    // longer commercially refundable from the resto side (delivery is
    // Uber Direct's responsibility from there, and a `collectée` order
    // has already left the door).
    expect(isLegalTransition("remise", "refusée")).toBe(false);
    expect(isLegalTransition("livrée", "refusée")).toBe(false);
    expect(isLegalTransition("collectée", "refusée")).toBe(false);
  });
});

describe("2.3-D state machine guard — illegal transitions throw", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = (await seedCustomerWithUser(t, "eater-guard@x.fr")).customerId;
  });

  it("acknowledge on a non-nouvelle order throws (state jump)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "prête",
    );
    await expect(
      asManager.mutation(api.lib.orders.workflow.acknowledge, {
        tenantId: seed.tenantA.tenantId,
        orderId,
      }),
    ).rejects.toThrow();
  });

  it("markPrepared from nouvelle throws (cannot skip en préparation)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );
    await expect(
      asManager.mutation(api.lib.orders.workflow.markPrepared, {
        tenantId: seed.tenantA.tenantId,
        orderId,
      }),
    ).rejects.toThrow();
  });

  it("markHandedOff from nouvelle throws (PRD: cannot go nouvelle → remise)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );
    await expect(
      asManager.mutation(api.lib.orders.workflow.markHandedOff, {
        tenantId: seed.tenantA.tenantId,
        orderId,
      }),
    ).rejects.toThrow();
  });

  it("a terminal order (livrée) cannot be re-transitioned (acknowledge throws)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "livrée",
    );
    await expect(
      asManager.mutation(api.lib.orders.workflow.acknowledge, {
        tenantId: seed.tenantA.tenantId,
        orderId,
      }),
    ).rejects.toThrow();
  });

  it("a terminal order (collectée) cannot be handed off again", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "collectée",
      "pickup",
    );
    await expect(
      asManager.mutation(api.lib.orders.workflow.markHandedOff, {
        tenantId: seed.tenantA.tenantId,
        orderId,
      }),
    ).rejects.toThrow();
  });

  it("a refused order cannot be acknowledged", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "refusée",
    );
    await expect(
      asManager.mutation(api.lib.orders.workflow.acknowledge, {
        tenantId: seed.tenantA.tenantId,
        orderId,
      }),
    ).rejects.toThrow();
  });
});

describe("2.3-D kitchen queries — tenantOrders / tenantOrderHistory (staff+manager)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = (await seedCustomerWithUser(t, "eater-q@x.fr")).customerId;
  });

  it("tenantOrders returns the LIVE queue and NEVER 'en attente de paiement'", async () => {
    await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "en attente de paiement",
    );
    const live1 = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );
    const live2 = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "en préparation",
    );

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const rows = await asStaff.query(api.lib.orders.workflow.tenantOrders, {
      tenantId: seed.tenantA.tenantId,
    });
    const ids = rows.map((r) => r._id);
    expect(ids).toContain(live1);
    expect(ids).toContain(live2);
    expect(rows.every((r) => r.status !== "en attente de paiement")).toBe(true);
    // Terminal orders are NOT in the live queue.
    const done = await seedOrder(t, seed.tenantA.tenantId, customerA, "livrée");
    const rows2 = await asStaff.query(api.lib.orders.workflow.tenantOrders, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rows2.map((r) => r._id)).not.toContain(done);
  });

  it("tenantOrderHistory returns only terminal orders (livrée/collectée/refusée)", async () => {
    const delivered = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "livrée",
    );
    const collected = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "collectée",
      "pickup",
    );
    const refused = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "refusée",
    );
    const live = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const rows = await asManager.query(
      api.lib.orders.workflow.tenantOrderHistory,
      { tenantId: seed.tenantA.tenantId },
    );
    const ids = rows.map((r) => r._id);
    expect(ids).toContain(delivered);
    expect(ids).toContain(collected);
    expect(ids).toContain(refused);
    expect(ids).not.toContain(live);
  });

  it("tenantOrders is tenant-scoped (B never sees A's orders)", async () => {
    await seedOrder(t, seed.tenantA.tenantId, customerA, "nouvelle");
    const bRows = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.orders.workflow.tenantOrders, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bRows).toHaveLength(0);
  });
});

describe("2.3-D customer reads — myOrders / myOrder (self-scope)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let userA: Id<"users">;
  let customerA: Id<"customers">;
  let userOther: Id<"users">;
  let customerOther: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const a = await seedCustomerWithUser(t, "self@x.fr");
    userA = a.userId;
    customerA = a.customerId;
    const other = await seedCustomerWithUser(t, "other@x.fr");
    userOther = other.userId;
    customerOther = other.customerId;
  });

  it("myOrders returns ONLY the caller's own orders at the tenant", async () => {
    const mine1 = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );
    const mine2 = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "livrée",
    );
    // Another customer's order at the same tenant must NOT leak.
    await seedOrder(t, seed.tenantA.tenantId, customerOther, "nouvelle");

    const asSelf = t.withIdentity({ subject: userA });
    const rows = await asSelf.query(api.lib.orders.workflow.myOrders, {
      tenantId: seed.tenantA.tenantId,
    });
    const ids = rows.map((r) => r._id).sort();
    expect(ids).toEqual([mine1, mine2].sort());
  });

  it("myOrder returns the caller's own order with detail, null for another's", async () => {
    const mine = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );
    const foreign = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerOther,
      "nouvelle",
    );

    const asSelf = t.withIdentity({ subject: userA });
    const ownDetail = await asSelf.query(api.lib.orders.workflow.myOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId: mine,
    });
    expect(ownDetail?._id).toBe(mine);
    expect(ownDetail?.items.length).toBeGreaterThan(0);

    // Another customer's order is not reachable (self-scope) — null, no oracle.
    const leaked = await asSelf.query(api.lib.orders.workflow.myOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId: foreign,
    });
    expect(leaked).toBeNull();
  });

  it("myOrders for a customer with no fiche returns an empty list", async () => {
    // The fuzz seed's plain `customer` user has no `customers` fiche.
    const rows = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.orders.workflow.myOrders, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(rows).toEqual([]);
    expect(userOther).toBe(userOther); // (keep the seeded foreign user referenced)
  });
});

describe("2.3-D cross-tenant fuzz — every workflow function rejects unauthorized actors (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = (await seedCustomerWithUser(t, "eater-fuzz@x.fr")).customerId;
    orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, "prête");
  });

  it("staff+manager transitions/reads reject every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.orders.workflow.acknowledge,
        api.lib.orders.workflow.markPrepared,
        api.lib.orders.workflow.markHandedOff,
        api.lib.orders.workflow.tenantOrders,
        api.lib.orders.workflow.tenantOrderHistory,
      ],
      isQuery: (fn) =>
        fn === api.lib.orders.workflow.tenantOrders ||
        fn === api.lib.orders.workflow.tenantOrderHistory,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { orderId },
    });
    expect(pairs).toBe(25);
    expect(leaks).toEqual([]);
  });

  it("customer self reads reject the global root + anonymous (customer surface)", async () => {
    // myOrders / myOrder are `customerQuery`: they require the GLOBAL `customer`
    // role. The only GLOBAL non-customer actor is `kb_admin` (resto roles are
    // per-tenant — a manager/staff is globally a customer and IS a legitimate eater,
    // who simply sees their own empty self-scoped list). So the isolation pinned
    // here is: the global root + the anonymous caller never read through the customer
    // surface; the cross-CUSTOMER self-scope (another eater's order is unreachable)
    // is asserted in the self-scope suite above. (Mirrors lib/customer/identity.)
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.orders.workflow.myOrders,
        api.lib.orders.workflow.myOrder,
      ],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { orderId },
    });
    expect(pairs).toBe(4);
    expect(leaks).toEqual([]);
  });
});
