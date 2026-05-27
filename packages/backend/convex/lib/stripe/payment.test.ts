import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; the array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/stripe/, so Vite emits keys relative to THIS dir; re-anchor every
// `./x` key at the convex root so convex-test's findModulesRoot has ONE common
// prefix (same intent as the account / webhook suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/stripe/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.5-B + 2.3-fix (#108) — the payment webhook side of the direct-charge flow.
 * The INTERNAL mutations dispatched by the verified `stripeWebhook` httpAction:
 *  - `confirmPaymentSucceeded` — `payment_intent.succeeded` → mark the payment
 *    `succeeded`, then apply the STRICT payment↔delivery coupling (#108):
 *      - PICKUP (click & collect): CONFIRM the order immediately
 *        (`en attente de paiement → nouvelle`, freezing the pricing snapshot +
 *        incrementing the `customerOrdersPerTenant` MOAT stats) and seed a
 *        `click_collect` delivery row — no course gate.
 *      - DELIVERY: do NOT confirm the order yet (it stays `en attente de paiement`,
 *        INVISIBLE to the resto — no beep) and do NOT increment stats; only SEED
 *        the `pending` `deliveries` row and HAND OFF to the course executor. The
 *        `→ nouvelle` transition + the stats increment happen ONLY once the Uber
 *        course is created successfully (2.6-C `createCourseOnPaymentConfirmed`).
 *    Idempotent per `(stripe, eventId)`: a replay neither double-confirms nor
 *    double-seeds.
 *  - `recordPaymentFailed` — `payment_intent.payment_failed` → mark `payment_failed`
 *    and count the attempt; the order is NEVER confirmed (3 attempts max then
 *    abandon, no order created as `nouvelle`).
 *
 * The webhook is SYSTEM-SIDE (no actor): the tenant is resolved structurally from
 * the Stripe-supplied `paymentIntentId` (the `payments` row carries `tenantId`),
 * NOT from any user-supplied id — so it can only ever touch the owning tenant.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PRICING = { subtotal: 1290, deliveryFee: 295, total: 1585 };

async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    return ctx.db.insert("customers", { userId, email, createdAt: Date.now() });
  });
}

/** Seed a pending order (the shape 2.3-B leaves at checkout). */
async function seedPendingOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  mode: "delivery" | "pickup" = "delivery",
): Promise<Id<"orders">> {
  return t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status: "en attente de paiement",
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
      allergens: ["gluten"],
    });
    return orderId;
  });
}

/** Seed a `payments` row in `requires_payment_method` (the shape the action leaves). */
async function seedPayment(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  paymentIntentId: string,
): Promise<Id<"payments">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("payments", {
      tenantId,
      orderId,
      paymentIntentId,
      status: "requires_payment_method",
      applicationFeeAmountHt: 200,
      amountTotal: PRICING.total,
      pricingSnapshot: PRICING,
      failedAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

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

async function readPayment(
  t: ReturnType<typeof convexTest>,
  paymentId: Id<"payments">,
) {
  return t.run(async (ctx) => ctx.db.get(paymentId));
}

async function readDeliveries(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("deliveries")
      .withIndex("by_order", (q) =>
        q.eq("tenantId", tenantId).eq("orderId", orderId),
      )
      .collect(),
  );
}

/** The `customerOrdersPerTenant` MOAT stats row for a (tenant, customer), or null. */
async function readStats(
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

describe("2.5-B confirmPaymentSucceeded — confirms the order + seeds the course", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater-a@x.fr");
    orderId = await seedPendingOrder(t, seed.tenantA.tenantId, customerA);
    paymentId = await seedPayment(t, seed.tenantA.tenantId, orderId, "pi_ok");
  });

  it("#108 DELIVERY: succeeded marks the payment + seeds the course but does NOT make the order visible (no nouvelle, no stats) until the course is created", async () => {
    const out = await t.mutation(
      internal.lib.stripe.payment.confirmPaymentSucceeded,
      { eventId: "evt_ok", paymentIntentId: "pi_ok" },
    );
    expect(out.applied).toBe(true);

    // The payment cleared.
    expect((await readPayment(t, paymentId))?.status).toBe("succeeded");

    // STRICT COUPLING: the delivery order is NOT yet transmitted to KB Orders — it
    // stays `en attente de paiement` (invisible, no beep), no `paidAt`, no workflow
    // event, and the pricing is NOT yet frozen onto the order.
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("en attente de paiement");
    expect(order?.paidAt).toBeUndefined();
    expect(events).toHaveLength(0);

    // ...and the MOAT stats are NOT incremented yet (gated on course-created).
    expect(await readStats(t, seed.tenantA.tenantId, customerA)).toBeNull();

    // The delivery course IS SEEDED as a pending row (the actual Uber call is 2.6-C).
    const deliveries = await readDeliveries(t, seed.tenantA.tenantId, orderId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].mode).toBe("delivery");
    expect(deliveries[0].status).toBe("pending");
  });

  it("#108 PICKUP: a click & collect order goes `nouvelle` + stats immediately at payment (no course gate)", async () => {
    const pickupCustomer = await seedCustomer(t, "eater-pickup@x.fr");
    const pickupOrder = await seedPendingOrder(
      t,
      seed.tenantA.tenantId,
      pickupCustomer,
      "pickup",
    );
    await seedPayment(t, seed.tenantA.tenantId, pickupOrder, "pi_pickup");

    await t.mutation(internal.lib.stripe.payment.confirmPaymentSucceeded, {
      eventId: "evt_pickup",
      paymentIntentId: "pi_pickup",
    });

    // Pickup is visible immediately — no course gate.
    const { order, events } = await readOrder(t, pickupOrder);
    expect(order?.status).toBe("nouvelle");
    expect(order?.paidAt).toBeTypeOf("number");
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("nouvelle");
    // Stats incremented immediately for the pickup customer.
    expect(
      (await readStats(t, seed.tenantA.tenantId, pickupCustomer))?.totalOrders,
    ).toBe(1);

    const deliveries = await readDeliveries(
      t,
      seed.tenantA.tenantId,
      pickupOrder,
    );
    // Click & collect seeds a `click_collect` row, never an Uber course.
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].mode).toBe("click_collect");
    expect(deliveries[0].uberDeliveryId).toBeUndefined();
  });

  it("idempotence: replaying the same event seeds the course exactly once (delivery: no transition)", async () => {
    const call = () =>
      t.mutation(internal.lib.stripe.payment.confirmPaymentSucceeded, {
        eventId: "evt_dup",
        paymentIntentId: "pi_ok",
      });
    const first = await call();
    const second = await call();
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false); // duplicate → clean no-op

    // DELIVERY (#108): no transition happens at payment — gated on course-created.
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("en attente de paiement");
    expect(events).toHaveLength(0);
    const deliveries = await readDeliveries(t, seed.tenantA.tenantId, orderId);
    expect(deliveries).toHaveLength(1); // one course only

    const ledger = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "stripe").eq("externalId", "evt_dup"),
        )
        .collect(),
    );
    expect(ledger).toHaveLength(1);
  });

  it("an event for an UNKNOWN paymentIntent is a clean no-op", async () => {
    const out = await t.mutation(
      internal.lib.stripe.payment.confirmPaymentSucceeded,
      { eventId: "evt_unknown", paymentIntentId: "pi_nope" },
    );
    expect(out.applied).toBe(false);
    expect((await readOrder(t, orderId)).order?.status).toBe(
      "en attente de paiement",
    );
  });

  it("resolves ONLY the owning tenant — tenant B's order is never touched", async () => {
    const customerB = await seedCustomer(t, "eater-b@x.fr");
    const orderB = await seedPendingOrder(t, seed.tenantB.tenantId, customerB);
    await seedPayment(t, seed.tenantB.tenantId, orderB, "pi_b");

    await t.mutation(internal.lib.stripe.payment.confirmPaymentSucceeded, {
      eventId: "evt_a",
      paymentIntentId: "pi_ok",
    });

    // A's delivery payment cleared (succeeded) but the order stays gated, and its
    // delivery course was seeded — tenant B is never touched.
    expect(
      (await readDeliveries(t, seed.tenantA.tenantId, orderId)).length,
    ).toBe(1);
    expect((await readOrder(t, orderId)).order?.status).toBe(
      "en attente de paiement",
    );
    // tenant B's order untouched (no course seeded, still awaiting payment).
    expect((await readOrder(t, orderB)).order?.status).toBe(
      "en attente de paiement",
    );
    expect(
      (await readDeliveries(t, seed.tenantB.tenantId, orderB)).length,
    ).toBe(0);
  });
});

describe("2.5-B recordPaymentFailed — notify + retry, 3 max then abandon", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater-fail@x.fr");
    orderId = await seedPendingOrder(t, seed.tenantA.tenantId, customerA);
    paymentId = await seedPayment(t, seed.tenantA.tenantId, orderId, "pi_fail");
  });

  it("a failed payment marks payment_failed, counts the attempt, leaves the order pending", async () => {
    const out = await t.mutation(
      internal.lib.stripe.payment.recordPaymentFailed,
      { eventId: "evt_f1", paymentIntentId: "pi_fail" },
    );
    expect(out.applied).toBe(true);
    expect(out.abandoned).toBe(false);

    const payment = await readPayment(t, paymentId);
    expect(payment?.status).toBe("payment_failed");
    expect(payment?.failedAttempts).toBe(1);
    // Order NOT created/confirmed — still awaiting payment, no workflow event.
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("en attente de paiement");
    expect(events).toHaveLength(0);
  });

  it("on the 3rd distinct failure the payment is abandoned (order never created)", async () => {
    for (const evt of ["evt_f1", "evt_f2"]) {
      const out = await t.mutation(
        internal.lib.stripe.payment.recordPaymentFailed,
        { eventId: evt, paymentIntentId: "pi_fail" },
      );
      expect(out.abandoned).toBe(false);
    }
    const third = await t.mutation(
      internal.lib.stripe.payment.recordPaymentFailed,
      { eventId: "evt_f3", paymentIntentId: "pi_fail" },
    );
    expect(third.abandoned).toBe(true);
    expect((await readPayment(t, paymentId))?.failedAttempts).toBe(3);
    // Still no order created.
    expect((await readOrder(t, orderId)).order?.status).toBe(
      "en attente de paiement",
    );
  });

  it("idempotence: replaying a failure event counts once", async () => {
    await t.mutation(internal.lib.stripe.payment.recordPaymentFailed, {
      eventId: "evt_dup_f",
      paymentIntentId: "pi_fail",
    });
    await t.mutation(internal.lib.stripe.payment.recordPaymentFailed, {
      eventId: "evt_dup_f",
      paymentIntentId: "pi_fail",
    });
    expect((await readPayment(t, paymentId))?.failedAttempts).toBe(1);
  });
});
