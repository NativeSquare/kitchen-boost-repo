import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/delivery/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

// The 2.5 refund action reads the KB-wide STRIPE_SECRET_KEY (not per-tenant). Set a
// dummy so a triggered refund reaches the (mocked) Stripe fetch. Never committed.
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

/**
 * 2.6-D — the delivery-incident STATE MACHINE acting on the 4 acted cases, written
 * BEFORE the implementation (TDD red). The webhook apply (slice C) already maps the
 * Uber event onto the row; slice D makes it ACT per delivery CONTEXT (Q40-Q6→Q40-Q14):
 *
 *  - Cas C `incident_after_pickup` (canceled/failed) ⇒ auto-refund VIA 2.5 (scheduled,
 *    Stripe mocked) + incident push signal; KB opens NO Uber/resto reclamation.
 *  - Cas D `customer_absent` (returned) ⇒ NO auto-refund + `manualRefundAvailable`
 *    flag on the row + customer-absent push signal.
 *  - Cas B `courier_cancel_before_pickup` (courier_update) ⇒ passive relay; the
 *    "petit retard" push fires ONLY when cumulative ETA drift > 10 min; no refund.
 *  - Cas A `refused_post_payment` ⇒ covered by the course executor (createCourse…):
 *    auto-refund VIA 2.5 + NO KDS signal (cmd never transmitted).
 *
 * The customer-absent / petit-retard / incident pushes are NOT closed transactional
 * triggers (ADR 0006) — they are SIGNALS returned for the Phase 3 fronts. All Stripe
 * + Uber HTTP is MOCKED.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PRICING = { subtotal: 1290, deliveryFee: 295, total: 1585 };
const UBER_CREDS = {
  clientId: "kb-client-id",
  clientSecret: "sk_live_uber_secret_777",
  customerId: "cus_uber_A",
  webhookSigningKey: "whsec_uber",
};

/** A reachable customer (so the refund push has a recipient). */
async function seedReachableCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    return ctx.db.insert("customers", {
      userId,
      email,
      phone: "+33600000000",
      pushEnrollment: { walletStatus: "enrolled", webPushStatus: "enrolled" },
      createdAt: Date.now(),
    });
  });
}

async function seedReadyStripeAccount(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  stripeAccountId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch(tenantId, { stripeAccountId, stripeStatus: "ready" });
  });
}

/**
 * Seed a paid order + its succeeded payment + the dispatched delivery row carrying
 * an `uberDeliveryId` (course already created — the webhook now drives incidents).
 */
async function seedDispatchedOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  paymentIntentId: string,
  uberDeliveryId: string,
): Promise<{ orderId: Id<"orders">; paymentId: Id<"payments"> }> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status: "nouvelle",
      mode: "delivery",
      source: "direct",
      address: "12 rue de Paris, 91000 Évry",
      pricingSnapshot: PRICING,
      createdAt: now,
      paidAt: now,
    });
    await ctx.db.insert("orderEvents", {
      tenantId,
      orderId,
      status: "nouvelle",
      at: now,
    });
    const paymentId = await ctx.db.insert("payments", {
      tenantId,
      orderId,
      paymentIntentId,
      status: "succeeded",
      applicationFeeAmountHt: 200,
      amountTotal: PRICING.total,
      pricingSnapshot: PRICING,
      failedAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("deliveries", {
      tenantId,
      orderId,
      mode: "delivery",
      status: "pickup",
      uberDeliveryId,
      quoteId: "dqt_OK",
      quoteFee: 590,
      createdAt: now,
      updatedAt: now,
    });
    return { orderId, paymentId };
  });
}

async function readDeliveryByUberId(
  t: ReturnType<typeof convexTest>,
  uberDeliveryId: string,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("deliveries")
      .withIndex("by_uber_delivery_id", (q) =>
        q.eq("uberDeliveryId", uberDeliveryId),
      )
      .unique(),
  );
}

async function readPayment(
  t: ReturnType<typeof convexTest>,
  paymentId: Id<"payments">,
) {
  return t.run(async (ctx) => ctx.db.get(paymentId));
}

async function readOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
) {
  return t.run(async (ctx) => ctx.db.get(orderId));
}

async function readAuditRefunds(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("auditLog")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .filter((q) => q.eq(q.field("action"), "payment.refund"))
      .collect(),
  );
}

describe("2.6-D incident state machine — Cas C incident_after_pickup auto-refund via 2.5", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedReadyStripeAccount(t, seed.tenantA.tenantId, "acct_resto_A");
    const customerA = await seedReachableCustomer(t, "eater-casC@x.fr");
    ({ orderId, paymentId } = await seedDispatchedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_casC",
      "del_casC",
    ));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("a canceled event auto-refunds the order (via 2.5), flags incident, no manual button", async () => {
    // Stripe POST /refunds (the only network call this flow makes — 2.5 mocked).
    const spy = vi.spyOn(global, "fetch");
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_casC", status: "succeeded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchSpy = spy as ReturnType<typeof vi.spyOn>;

    const out = await t.mutation(
      internal.lib.delivery.webhooks.applyUberWebhookEvent,
      {
        tenantId: seed.tenantA.tenantId,
        eventId: "evt_casC",
        event: {
          kind: "event.delivery_status",
          delivery_id: "del_casC",
          status: "canceled",
          data: { delivery_id: "del_casC", status: "canceled" },
        },
      },
    );
    expect(out.applied).toBe(true);
    expect(out.autoRefundTriggered).toBe(true);
    expect(out.incidentPush).toBe("delivery_incident");
    expect(out.manualRefundAvailable).toBeUndefined();

    // The scheduled 2.5 refund runs.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await readDeliveryByUberId(t, "del_casC");
    expect(row?.incidentType).toBe("incident_after_pickup");
    expect(row?.status).toBe("canceled");
    expect(row?.manualRefundAvailable).toBeUndefined();

    const payment = await readPayment(t, paymentId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.refundId).toBe("re_casC");
    // The order leaves KB Orders (refusée) — KB opens no Uber/resto reclamation.
    expect((await readOrder(t, seed.tenantA.tenantId, orderId))?.status).toBe(
      "refusée",
    );

    // Every auto-refund is audited (logAudit), and only ONE Stripe refund happens.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readAuditRefunds(t, seed.tenantA.tenantId)).toHaveLength(1);
  });

  it("a failed event also auto-refunds (Cas C is canceled OR failed)", async () => {
    const spy = vi.spyOn(global, "fetch");
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_failed", status: "succeeded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchSpy = spy as ReturnType<typeof vi.spyOn>;

    const out = await t.mutation(
      internal.lib.delivery.webhooks.applyUberWebhookEvent,
      {
        tenantId: seed.tenantA.tenantId,
        eventId: "evt_failed",
        event: {
          kind: "event.delivery_status",
          delivery_id: "del_casC",
          status: "failed",
          data: { delivery_id: "del_casC", status: "failed" },
        },
      },
    );
    expect(out.autoRefundTriggered).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await readPayment(t, paymentId))?.status).toBe("refunded");
  });

  it("a redelivered canceled event refunds exactly once (idempotent state machine)", async () => {
    const spy = vi.spyOn(global, "fetch");
    spy.mockResolvedValue(
      new Response(JSON.stringify({ id: "re_dup", status: "succeeded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchSpy = spy as ReturnType<typeof vi.spyOn>;

    const event = {
      tenantId: seed.tenantA.tenantId,
      eventId: "evt_dup_casC",
      event: {
        kind: "event.delivery_status",
        delivery_id: "del_casC",
        status: "canceled" as const,
        data: { delivery_id: "del_casC", status: "canceled" },
      },
    };
    await t.mutation(
      internal.lib.delivery.webhooks.applyUberWebhookEvent,
      event,
    );
    await t.mutation(
      internal.lib.delivery.webhooks.applyUberWebhookEvent,
      event,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await readPayment(t, paymentId))?.status).toBe("refunded");
    expect(await readAuditRefunds(t, seed.tenantA.tenantId)).toHaveLength(1);
  });
});

describe("2.6-D incident state machine — Cas D customer_absent (NO auto-refund + manual button)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedReadyStripeAccount(t, seed.tenantA.tenantId, "acct_resto_A");
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: UBER_CREDS,
      });
    const customerA = await seedReachableCustomer(t, "eater-casD@x.fr");
    ({ orderId, paymentId } = await seedDispatchedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_casD",
      "del_casD",
    ));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("a returned event flags client-absent, exposes the manual refund button, NO auto-refund", async () => {
    fetchSpy = vi.spyOn(global, "fetch"); // must NOT be called (no auto-refund)

    const out = await t.mutation(
      internal.lib.delivery.webhooks.applyUberWebhookEvent,
      {
        tenantId: seed.tenantA.tenantId,
        eventId: "evt_casD",
        event: {
          kind: "event.delivery_status",
          delivery_id: "del_casD",
          status: "returned",
          data: { delivery_id: "del_casD", status: "returned" },
        },
      },
    );
    expect(out.applied).toBe(true);
    expect(out.autoRefundTriggered).toBeUndefined();
    expect(out.manualRefundAvailable).toBe(true);
    expect(out.incidentPush).toBe("customer_absent");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await readDeliveryByUberId(t, "del_casD");
    expect(row?.incidentType).toBe("customer_absent");
    expect(row?.manualRefundAvailable).toBe(true);
    // NO auto-refund: payment untouched, order still live, no Stripe call.
    expect((await readPayment(t, paymentId))?.status).toBe("succeeded");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readAuditRefunds(t, seed.tenantA.tenantId)).toHaveLength(0);
  });

  it("the resto can then trigger the discretionary manual refund (via 2.5)", async () => {
    // Flag it absent first.
    await t.mutation(internal.lib.delivery.webhooks.applyUberWebhookEvent, {
      tenantId: seed.tenantA.tenantId,
      eventId: "evt_casD2",
      event: {
        kind: "event.delivery_status",
        delivery_id: "del_casD",
        status: "returned",
        data: { delivery_id: "del_casD", status: "returned" },
      },
    });

    const spy = vi.spyOn(global, "fetch");
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_manual", status: "succeeded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchSpy = spy as ReturnType<typeof vi.spyOn>;

    // The resto (kb_manager) clicks the manual refund button.
    const out = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.delivery.incidents.triggerManualRefund, {
        tenantId: seed.tenantA.tenantId,
        orderId,
      });
    expect(out.triggered).toBe(true);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await readPayment(t, paymentId))?.status).toBe("refunded");
    expect((await readPayment(t, paymentId))?.refundId).toBe("re_manual");
  });

  it("manual refund is rejected when the delivery is NOT flagged customer_absent", async () => {
    // No returned event posted → no manual refund eligibility.
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.delivery.incidents.triggerManualRefund, {
          tenantId: seed.tenantA.tenantId,
          orderId,
        }),
    ).rejects.toThrow();
  });
});

describe("2.6-D incident state machine — Cas B courier re-dispatch + petit-retard gate", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerA = await seedReachableCustomer(t, "eater-casB@x.fr");
    await seedDispatchedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_casB",
      "del_casB",
    );
    // Seed a prior pickup ETA on the row so the next update has a baseline.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("deliveries")
        .withIndex("by_uber_delivery_id", (q) =>
          q.eq("uberDeliveryId", "del_casB"),
        )
        .unique();
      if (row) await ctx.db.patch(row._id, { pickupEta: 1_700_000_000_000 });
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  /** Post a courier_update bumping the pickup ETA forward by `slipMs`. */
  async function courierUpdate(eventId: string, slipMs: number) {
    return t.mutation(internal.lib.delivery.webhooks.applyUberWebhookEvent, {
      tenantId: seed.tenantA.tenantId,
      eventId,
      event: {
        kind: "event.courier_update",
        delivery_id: "del_casB",
        data: {
          delivery_id: "del_casB",
          courier: { name: "Yacine", phone_number: "+33611111111" },
          pickup_eta: 1_700_000_000_000 + slipMs,
        },
      },
    });
  }

  it("a small ETA slip relays the new courier passively, NO petit-retard, NO refund", async () => {
    const out = await courierUpdate("evt_b1", 5 * 60 * 1000); // +5 min
    expect(out.applied).toBe(true);
    expect(out.petitRetard).toBeUndefined();
    expect(out.autoRefundTriggered).toBeUndefined();

    const row = await readDeliveryByUberId(t, "del_casB");
    expect(row?.courierName).toBe("Yacine"); // relayed
    expect(row?.cumulativeEtaDriftMs).toBe(5 * 60 * 1000);
    expect(row?.incidentType).toBeUndefined();
  });

  it("cumulative drift crossing 10 min fires the petit-retard push exactly once", async () => {
    await courierUpdate("evt_b2a", 7 * 60 * 1000); // +7 min (≤ 10)
    const crossing = await courierUpdate("evt_b2b", 12 * 60 * 1000); // now 12 min
    expect(crossing.petitRetard).toBe(true);

    const after = await readDeliveryByUberId(t, "del_casB");
    expect(after?.cumulativeEtaDriftMs).toBe(12 * 60 * 1000);

    // A further slip past the threshold does NOT re-fire the push (one-shot).
    const again = await courierUpdate("evt_b2c", 15 * 60 * 1000);
    expect(again.petitRetard).toBeUndefined();
  });
});

describe("2.6-D — Cas A refused_post_payment is the course executor's path (no KDS signal)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedReadyStripeAccount(t, seed.tenantA.tenantId, "acct_resto_A");
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: UBER_CREDS,
      });
    const customerA = await seedReachableCustomer(t, "eater-casA@x.fr");
    ({ orderId, paymentId } = await seedDispatchedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_casA",
      "del_casA_placeholder",
    ));
    // Reset the seeded row to a true pre-course state (no uberDeliveryId yet).
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("deliveries")
        .withIndex("by_order", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("orderId", orderId),
        )
        .unique();
      if (row)
        await ctx.db.patch(row._id, {
          uberDeliveryId: undefined,
          status: "pending",
        });
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("Uber refusing the course post-payment auto-refunds and leaves the kitchen untouched", async () => {
    const spy = vi.spyOn(global, "fetch");
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ub_token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "address_undeliverable" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_casA", status: "succeeded" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchSpy = spy as ReturnType<typeof vi.spyOn>;

    await t.action(
      internal.lib.delivery.course.createCourseOnPaymentConfirmed,
      {
        tenantId: seed.tenantA.tenantId,
        orderId,
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("deliveries")
        .withIndex("by_order", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("orderId", orderId),
        )
        .unique(),
    );
    expect(row?.incidentType).toBe("refused_post_payment");
    // Auto-refund happened (via 2.5) and the order left KB Orders.
    expect((await readPayment(t, paymentId))?.status).toBe("refunded");
    expect((await readOrder(t, seed.tenantA.tenantId, orderId))?.status).toBe(
      "refusée",
    );
    // The cmd was never transmitted to the KDS — the row never reached a kitchen
    // status (still no courier dispatch / pickup signal recorded).
    expect(row?.status).toBe("pending");
  });
});

describe("2.6-D incident state machine — cross-tenant isolation (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerA = await seedReachableCustomer(t, "eater-iso@x.fr");
    await seedDispatchedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_iso",
      "del_iso_A",
    );
  });

  it("a returned event resolved under tenant B does NOT flag tenant A's delivery", async () => {
    const out = await t.mutation(
      internal.lib.delivery.webhooks.applyUberWebhookEvent,
      {
        tenantId: seed.tenantB.tenantId, // foreign tenant
        eventId: "evt_iso",
        event: {
          kind: "event.delivery_status",
          delivery_id: "del_iso_A",
          status: "returned",
          data: { delivery_id: "del_iso_A", status: "returned" },
        },
      },
    );
    expect(out.applied).toBe(false); // foreign delivery → no-op
    expect(out.manualRefundAvailable).toBeUndefined();

    const row = await readDeliveryByUberId(t, "del_iso_A");
    expect(row?.incidentType).toBeUndefined();
    expect(row?.manualRefundAvailable).toBeUndefined();
    expect(row?.status).toBe("pickup"); // untouched — still A's
  });

  it("the manual refund mutation refuses a delivery the tenant does not own", async () => {
    // Tenant A seeded del_iso_A; flag it absent (under A).
    await t.mutation(internal.lib.delivery.webhooks.applyUberWebhookEvent, {
      tenantId: seed.tenantA.tenantId,
      eventId: "evt_iso2",
      event: {
        kind: "event.delivery_status",
        delivery_id: "del_iso_A",
        status: "returned",
        data: { delivery_id: "del_iso_A", status: "returned" },
      },
    });
    const aOrderId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("deliveries")
        .withIndex("by_uber_delivery_id", (q) =>
          q.eq("uberDeliveryId", "del_iso_A"),
        )
        .unique();
      return row?.orderId as Id<"orders">;
    });

    // Tenant B's manager tries to manually refund A's order → Forbidden / not found.
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.delivery.incidents.triggerManualRefund, {
          tenantId: seed.tenantB.tenantId,
          orderId: aOrderId,
        }),
    ).rejects.toThrow();
  });
});
