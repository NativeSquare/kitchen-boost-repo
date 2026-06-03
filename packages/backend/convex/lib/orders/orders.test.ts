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
    path.startsWith("./") ? `../../lib/orders/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.3-A — `orders` + `orderItems` (FROZEN snapshots) + `orderEvents` schema +
 * tenant-scoped persistence, written BEFORE implementation (TDD red).
 *
 * Every read/write goes through `tenantQuery` / `tenantMutation` strictly keyed
 * on `ctx.tenantId`; the business module never touches raw `ctx.db`
 * (`no-untenanted-query` active, ADR 0010) — the tables are reached only through
 * the sanctioned `lib/tenancy/ordersStore` seam. Ships a cross-tenant fuzz suite
 * replaying each function under unauthorized actors and asserting a throw.
 *
 * `orderItems` are FROZEN: a denormalised copy of name/price/modifiers/allergens
 * at order time, NOT FKs into the (later) menu tables — the order is self-
 * contained and immutable even if the menu changes afterwards (PRD 10 §7 / PRD
 * 20 §4, Q10-Q8c: 1 line per item × modifiers combination, no aggregation).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A customer fiche (GLOBAL `customers` table) seeded directly for the FK. */
async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    return ctx.db.insert("customers", { userId, email, createdAt: Date.now() });
  });
}

/** A minimal valid order payload for tenant A's customer. */
function orderInput(customerId: Id<"customers">) {
  return {
    customerId,
    mode: "delivery" as const,
    address: "12 rue de Paris, 91000 Évry",
    lat: 48.62,
    lng: 2.44,
    restaurantNote: "Sans oignon svp",
    items: [
      {
        itemName: "Smash Double",
        unitPrice: 1290,
        quantity: 1,
        modifiers: [
          { groupName: "Sauce", optionName: "Ketchup", priceDelta: 0 },
        ],
        allergens: ["gluten", "lait"],
      },
      {
        // Same item, different modifiers ⇒ a DISTINCT line (Q10-Q8c).
        itemName: "Smash Double",
        unitPrice: 1290,
        quantity: 2,
        modifiers: [{ groupName: "Sauce", optionName: "Mayo", priceDelta: 0 }],
        allergens: ["gluten", "lait", "œufs"],
      },
    ],
  };
}

describe("2.3-A orders — schema + tenant-scoped persistence via wrappers", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater-a@x.fr");
  });

  it("places an order with frozen items + a 'nouvelle' event, scoped to the tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    const orderId = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      ...orderInput(customerA),
    });
    expect(orderId).toBeTypeOf("string");

    const order = await asManager.query(api.lib.orders.orders.getOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(order).not.toBeNull();
    expect(order?.status).toBe("nouvelle");
    expect(order?.mode).toBe("delivery");
    expect(order?.source).toBe("direct"); // V1 = direct only (ADR 0009)
    expect(order?.customerId).toBe(customerA);
    expect(order?.restaurantNote).toBe("Sans oignon svp");
    expect(order?.createdAt).toBeTypeOf("number");

    // Frozen line items: 1 line per item × modifiers combination (no aggregation).
    expect(order?.items).toHaveLength(2);
    expect(order?.items[0].itemName).toBe("Smash Double");
    expect(order?.items[0].quantity).toBe(1);
    expect(order?.items[0].modifiers[0].optionName).toBe("Ketchup");
    expect(order?.items[1].quantity).toBe(2);
    expect(order?.items[1].modifiers[0].optionName).toBe("Mayo");
    expect(order?.items[1].allergens).toContain("œufs");

    // An order is born with exactly one event: the 'nouvelle' state.
    expect(order?.events).toHaveLength(1);
    expect(order?.events[0].status).toBe("nouvelle");
    expect(order?.events[0].at).toBeTypeOf("number");
  });

  it("lists the tenant's orders newest-first and filters by status", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const id1 = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      ...orderInput(customerA),
    });
    const id2 = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      ...orderInput(customerA),
    });

    const all = await asManager.query(api.lib.orders.orders.listOrders, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(all).toHaveLength(2);
    // Newest first (id2 placed after id1).
    expect(all[0]._id).toBe(id2);
    expect(all[1]._id).toBe(id1);

    // The kitchen queue: orders in a given status (by_tenant_status index).
    const nouvelles = await asManager.query(api.lib.orders.orders.listOrders, {
      tenantId: seed.tenantA.tenantId,
      status: "nouvelle",
    });
    expect(nouvelles).toHaveLength(2);
    const prets = await asManager.query(api.lib.orders.orders.listOrders, {
      tenantId: seed.tenantA.tenantId,
      status: "prête",
    });
    expect(prets).toHaveLength(0);
  });

  it("advances the workflow status and appends an order event each time", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      ...orderInput(customerA),
    });

    await asManager.mutation(api.lib.orders.orders.recordStatus, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      status: "en préparation",
    });
    await asManager.mutation(api.lib.orders.orders.recordStatus, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      status: "prête",
    });

    const order = await asManager.query(api.lib.orders.orders.getOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(order?.status).toBe("prête");
    // nouvelle → en préparation → prête = 3 events.
    expect(order?.events.map((e) => e.status)).toEqual([
      "nouvelle",
      "en préparation",
      "prête",
    ]);
  });

  it("records a refusal with a reason on the order event", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      ...orderInput(customerA),
    });

    await asManager.mutation(api.lib.orders.orders.recordStatus, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      status: "refusée",
      reason: "surcharge",
    });

    const order = await asManager.query(api.lib.orders.orders.getOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(order?.status).toBe("refusée");
    const last = order?.events.at(-1);
    expect(last?.status).toBe("refusée");
    expect(last?.reason).toBe("surcharge");
  });

  it("freezes the line items: editing the snapshot input afterwards never mutates the stored order", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const input = orderInput(customerA);
    const orderId = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      ...input,
    });

    // Mutate the caller's local copy — the stored snapshot is independent.
    input.items[0].unitPrice = 9999;

    const order = await asManager.query(api.lib.orders.orders.getOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(order?.items[0].unitPrice).toBe(1290);
  });

  it("a click & collect order needs no delivery address", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const orderId = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      mode: "pickup",
      items: orderInput(customerA).items,
    });
    const order = await asManager.query(api.lib.orders.orders.getOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(order?.mode).toBe("pickup");
    expect(order?.address).toBeUndefined();
  });

  it("staff (operational) can read orders + advance status but NOT place an order", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.orders.placeOrder, {
        tenantId: seed.tenantA.tenantId,
        ...orderInput(customerA),
      });

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const rows = await asStaff.query(api.lib.orders.orders.listOrders, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rows).toHaveLength(1);

    // Staff can move the kitchen workflow…
    await asStaff.mutation(api.lib.orders.orders.recordStatus, {
      tenantId: seed.tenantA.tenantId,
      orderId: rows[0]._id,
      status: "en préparation",
    });

    // …but placing an order is a checkout-side write (kb_manager / system).
    await expect(
      asStaff.mutation(api.lib.orders.orders.placeOrder, {
        tenantId: seed.tenantA.tenantId,
        ...orderInput(customerA),
      }),
    ).rejects.toThrow();
  });

  it("isolation: tenant B cannot read tenant A's order (foreign id reads as null, no oracle)", async () => {
    const orderId = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.orders.placeOrder, {
        tenantId: seed.tenantA.tenantId,
        ...orderInput(customerA),
      });

    // B's manager, on B's own (accessible) tenant, gets `null` for A's order id —
    // a foreign id is indistinguishable from a missing one (no existence oracle),
    // and crucially never returns A's data.
    const leaked = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.orders.orders.getOrder, {
        tenantId: seed.tenantB.tenantId,
        orderId,
      });
    expect(leaked).toBeNull();

    // And tenant B's order list never includes A's order.
    const bRows = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.orders.orders.listOrders, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bRows).toHaveLength(0);
  });

  it("recordStatus on a foreign tenant's order throws (ownership re-check)", async () => {
    const orderId = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.orders.placeOrder, {
        tenantId: seed.tenantA.tenantId,
        ...orderInput(customerA),
      });

    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.orders.orders.recordStatus, {
          tenantId: seed.tenantB.tenantId,
          orderId,
          status: "refusée",
          reason: "boom",
        }),
    ).rejects.toThrow();
  });
});

describe("2.3-A operationalPause — transient tenant status (PRD 20 §7)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("sets and clears an operational pause with an ETA on the calling tenant", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const until = Date.now() + 30 * 60 * 1000;

    await asManager.mutation(api.lib.orders.orders.setOperationalPause, {
      tenantId: seed.tenantA.tenantId,
      until,
    });
    let status = await asManager.query(
      api.lib.orders.orders.getOperationalPause,
      {
        tenantId: seed.tenantA.tenantId,
      },
    );
    expect(status?.until).toBe(until);

    await asManager.mutation(api.lib.orders.orders.clearOperationalPause, {
      tenantId: seed.tenantA.tenantId,
    });
    status = await asManager.query(api.lib.orders.orders.getOperationalPause, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(status).toBeNull();
  });

  it("pausing tenant A does not leak onto tenant B (identity fields untouched)", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.orders.setOperationalPause, {
        tenantId: seed.tenantA.tenantId,
        until: Date.now() + 60_000,
      });

    const bStatus = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.orders.orders.getOperationalPause, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bStatus).toBeNull();
  });
});

describe("#397 exceptionalClosure — durable closure 1+ jour (PRD 20 §7b, ADR 0018)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("get returns null when no exceptional closure is configured on the tenant", async () => {
    const status = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.orders.orders.getExceptionalClosure, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(status).toBeNull();
  });

  it("sets a durable exceptional closure ({from, until}) on the calling tenant, then clears it", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const from = Date.now();
    const until = from + 3 * 24 * 60 * 60 * 1000; // 3 days

    await asManager.mutation(api.lib.orders.orders.setExceptionalClosure, {
      tenantId: seed.tenantA.tenantId,
      from,
      until,
    });
    let status = await asManager.query(
      api.lib.orders.orders.getExceptionalClosure,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(status?.from).toBe(from);
    expect(status?.until).toBe(until);

    await asManager.mutation(api.lib.orders.orders.clearExceptionalClosure, {
      tenantId: seed.tenantA.tenantId,
    });
    status = await asManager.query(
      api.lib.orders.orders.getExceptionalClosure,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(status).toBeNull();
  });

  it("rejects an exceptional closure where `from >= until` (zero-length / inverted window)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const from = Date.now();
    // Inverted: `until` is before `from` — no meaningful closure window can be
    // derived. Throws so a typo in the date picker never persists garbage.
    await expect(
      asManager.mutation(api.lib.orders.orders.setExceptionalClosure, {
        tenantId: seed.tenantA.tenantId,
        from,
        until: from - 1,
      }),
    ).rejects.toThrow();
    // Zero-length is also rejected (same code path).
    await expect(
      asManager.mutation(api.lib.orders.orders.setExceptionalClosure, {
        tenantId: seed.tenantA.tenantId,
        from,
        until: from,
      }),
    ).rejects.toThrow();
  });

  it("closing tenant A does not leak onto tenant B (independent field per tenant, ADR 0010)", async () => {
    const from = Date.now();
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.orders.setExceptionalClosure, {
        tenantId: seed.tenantA.tenantId,
        from,
        until: from + 24 * 60 * 60 * 1000,
      });

    const bStatus = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.orders.orders.getExceptionalClosure, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bStatus).toBeNull();
  });
});

describe("2.3-A cross-tenant fuzz — orders wrappers, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater-fuzz@x.fr");
    // Seed an order on tenant A so the read paths have something to (not) leak.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.orders.placeOrder, {
        tenantId: seed.tenantA.tenantId,
        ...orderInput(customerA),
      });
  });

  it("every order/event/pause function rejects every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.orders.orders.placeOrder,
        api.lib.orders.orders.listOrders,
        api.lib.orders.orders.getOrder,
        api.lib.orders.orders.recordStatus,
        api.lib.orders.orders.setOperationalPause,
        api.lib.orders.orders.getOperationalPause,
        api.lib.orders.orders.clearOperationalPause,
        // #397 — Fermeture exceptionnelle (PRD 20 §7b, ADR 0018).
        api.lib.orders.orders.setExceptionalClosure,
        api.lib.orders.orders.getExceptionalClosure,
        api.lib.orders.orders.clearExceptionalClosure,
      ],
      isQuery: (fn) =>
        fn === api.lib.orders.orders.listOrders ||
        fn === api.lib.orders.orders.getOrder ||
        fn === api.lib.orders.orders.getOperationalPause ||
        fn === api.lib.orders.orders.getExceptionalClosure,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {
        customerId: customerA,
        mode: "delivery",
        items: [],
        orderId: "nonexistent",
        status: "refusée",
        until: Date.now() + 60_000,
        // #397 — `setExceptionalClosure` needs a valid (from < until) couple
        // so the fuzz is testing AUTH refusal, not arg validation. `from` is
        // strictly before `until` (60_000 above), so the validator never short-
        // circuits a Forbidden assertion.
        from: Date.now(),
      },
    });
    expect(pairs).toBe(50);
    expect(leaks).toEqual([]);
  });
});
