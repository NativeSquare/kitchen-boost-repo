import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; the array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/stripe/, so Vite emits keys relative to THIS dir; re-anchor every
// `./x` key at the convex root so convex-test's findModulesRoot has ONE common
// prefix (same intent as the payment / account / webhook suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/stripe/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

// The refund ACTION reads the KB-wide `STRIPE_SECRET_KEY` (not per-tenant). Set a
// dummy so the action reaches the (mocked) Stripe fetch (same as the paymentIntent
// suite). The real secret is an env var, never committed.
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

/**
 * 2.5-C/D — Refund, written BEFORE the implementation (TDD red). Two distinct
 * flows, both ending in a Stripe `POST /refunds` (immediate, TOTAL):
 *
 *  - `refundOnRefusal(tenantId, orderId)` — the payment-domain MECHANISM the
 *    Orders [[Refusal]] (#18) triggers: refund the PaymentIntent in FULL on the
 *    resto's connected account, mark the `payments` row `refunded` (+ `refundId`),
 *    audited. KB does NOT refund its commission (Article 3.3 — no
 *    `refund_application_fee`). The order transition + the client notification are
 *    the Orders concern (already done by 2.3-E `refuse`).
 *  - `refundAbortedOrder(tenantId, orderId)` — the [[Cmd avortée]] auto-refund the
 *    delivery course-failure (#48 Cas A) triggers: same total refund, PLUS pull the
 *    order OUT of KB Orders (`nouvelle → refusée`, so the resto never works it) and
 *    emit the client `refund_issued` push. The order is NEVER transmitted to KB
 *    Orders (it leaves the live queue).
 *
 * Idempotence: a re-trigger of either action (or a redelivered `charge.refunded`
 * webhook) yields exactly ONE Stripe refund + one `refunded` row — no double refund.
 * SYSTEM-SIDE: both are INTERNAL actions, no user-supplied tenant id; the tenant is
 * resolved structurally from the `payments`/`orders` row (ADR 0010). All Stripe HTTP
 * is MOCKED.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PRICING = { subtotal: 1290, deliveryFee: 295, total: 1585 };

/** Mock the Stripe `POST /refunds` call with one canned response. */
function mockStripeRefund(refund: {
  status: number;
  body: Record<string, unknown>;
}): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(
    new Response(JSON.stringify(refund.body), {
      status: refund.status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return spy as ReturnType<typeof vi.spyOn>;
}

/** A reachable customer fiche (wallet + web-push enrolled, email + phone). */
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

/** Stamp a `ready` Stripe connected account on a tenant (needed to refund). */
async function seedReadyStripeAccount(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  stripeAccountId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch(tenantId, { stripeAccountId, stripeStatus: "ready" });
  });
}

/** Seed a confirmed (`nouvelle`, paid) order + its succeeded `payments` row. */
async function seedPaidOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  paymentIntentId: string,
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
    return { orderId, paymentId };
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

async function readNotifs(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
) {
  return t.run((ctx) =>
    ctx.db
      .query("notificationEvents")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .collect(),
  );
}

async function readAudit(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
) {
  return t.run((ctx) =>
    ctx.db
      .query("auditLog")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow A — Refusal resto (#18) → total immediate refund
// ─────────────────────────────────────────────────────────────────────────────

describe("2.5-C refundOnRefusal — total immediate refund on a Refusal", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedReadyStripeAccount(t, seed.tenantA.tenantId, "acct_resto_A");
    customerA = await seedReachableCustomer(t, "eater-a@x.fr");
    ({ orderId, paymentId } = await seedPaidOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_refuse",
    ));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("refunds the PaymentIntent in FULL on the resto's connected account, NOT the commission", async () => {
    fetchSpy = mockStripeRefund({
      status: 200,
      body: { id: "re_total", status: "succeeded" },
    });

    const out = await t.action(internal.lib.stripe.refund.refundOnRefusal, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(out.refunded).toBe(true);

    // Exactly one Stripe call, on the resto's connected account, full amount, and
    // the KB commission is NOT refunded (no refund_application_fee=true).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/refunds");
    expect((init.headers as Record<string, string>)["Stripe-Account"]).toBe(
      "acct_resto_A",
    );
    const body = String(init.body);
    expect(body).toContain("payment_intent=pi_refuse");
    // Total refund: no explicit partial `amount`, and the commission stays with KB.
    expect(body).not.toContain("refund_application_fee=true");
    expect(body).not.toMatch(/(^|&)amount=/);
  });

  it("marks the payments row refunded (+ refundId) and audits the refund", async () => {
    fetchSpy = mockStripeRefund({
      status: 200,
      body: { id: "re_abc", status: "succeeded" },
    });

    await t.action(internal.lib.stripe.refund.refundOnRefusal, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const payment = await readPayment(t, paymentId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.refundId).toBe("re_abc");

    const audit = await readAudit(t, seed.tenantA.tenantId);
    expect(audit.some((a) => a.action.includes("refund"))).toBe(true);
  });

  it("idempotence: re-triggering refunds exactly ONCE (no double refund)", async () => {
    fetchSpy = mockStripeRefund({
      status: 200,
      body: { id: "re_once", status: "succeeded" },
    });

    const first = await t.action(internal.lib.stripe.refund.refundOnRefusal, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    const second = await t.action(internal.lib.stripe.refund.refundOnRefusal, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(first.refunded).toBe(true);
    expect(second.refunded).toBe(false); // already refunded → no second Stripe call

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await readPayment(t, paymentId))?.refundId).toBe("re_once");
  });

  it("resolves ONLY the owning tenant — refunding with tenant B leaves A untouched", async () => {
    fetchSpy = vi.spyOn(global, "fetch");
    const out = await t.action(internal.lib.stripe.refund.refundOnRefusal, {
      tenantId: seed.tenantB.tenantId,
      orderId, // belongs to tenant A
    });
    // A foreign order id resolves to no payment → clean no-op, no Stripe call.
    expect(out.refunded).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await readPayment(t, paymentId))?.status).toBe("succeeded");
  });
});

describe("2.5-C refuse (#18) triggers the refund mechanism", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedReadyStripeAccount(t, seed.tenantA.tenantId, "acct_resto_A");
    customerA = await seedReachableCustomer(t, "eater-refuse@x.fr");
    ({ orderId, paymentId } = await seedPaidOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_via_refuse",
    ));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("a Refusal transitions the order, then the scheduled refund marks it refunded", async () => {
    fetchSpy = mockStripeRefund({
      status: 200,
      body: { id: "re_from_refuse", status: "succeeded" },
    });

    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.workflow.refuse, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        reason: "rupture",
      });

    // The refuse mutation schedules the payment-domain refund; run scheduled jobs.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await readOrder(t, orderId)).order?.status).toBe("refusée");
    const payment = await readPayment(t, paymentId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.refundId).toBe("re_from_refuse");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow B — Cmd avortée (#48 course failure post-payment) → auto refund
// ─────────────────────────────────────────────────────────────────────────────

describe("2.5-D refundAbortedOrder — auto refund + push, order never reaches KB Orders", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  let paymentId: Id<"payments">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedReadyStripeAccount(t, seed.tenantA.tenantId, "acct_resto_A");
    customerA = await seedReachableCustomer(t, "eater-abort@x.fr");
    ({ orderId, paymentId } = await seedPaidOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_abort",
    ));
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("refunds in full, marks the payment refunded, and pulls the order OUT of KB Orders", async () => {
    fetchSpy = mockStripeRefund({
      status: 200,
      body: { id: "re_abort", status: "succeeded" },
    });

    const out = await t.action(internal.lib.stripe.refund.refundAbortedOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(out.refunded).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payment = await readPayment(t, paymentId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.refundId).toBe("re_abort");

    // The order is pulled out of the live KB Orders queue (terminal `refusée`), so
    // the resto never works it.
    const { order } = await readOrder(t, orderId);
    expect(order?.status).toBe("refusée");
    const live = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.orders.workflow.tenantOrders, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(live.map((o) => o._id)).not.toContain(orderId);
  });

  it("emits the client refund_issued push (queued — the send is 2.7)", async () => {
    fetchSpy = mockStripeRefund({
      status: 200,
      body: { id: "re_abort2", status: "succeeded" },
    });

    await t.action(internal.lib.stripe.refund.refundAbortedOrder, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const notifs = await readNotifs(t, customerA);
    expect(
      notifs.every((n) => n.transactionalTrigger === "refund_issued"),
    ).toBe(true);
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs.every((n) => n.status === "queued")).toBe(true);
    expect(notifs.every((n) => n.tenantId === seed.tenantA.tenantId)).toBe(
      true,
    );
  });

  it("idempotence: re-triggering the aborted refund refunds exactly ONCE", async () => {
    fetchSpy = mockStripeRefund({
      status: 200,
      body: { id: "re_abort_once", status: "succeeded" },
    });

    const first = await t.action(
      internal.lib.stripe.refund.refundAbortedOrder,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    const second = await t.action(
      internal.lib.stripe.refund.refundAbortedOrder,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(first.refunded).toBe(true);
    expect(second.refunded).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The order is refused once, not twice (one terminal transition).
    const { events } = await readOrder(t, orderId);
    expect(events.filter((e) => e.status === "refusée")).toHaveLength(1);
  });
});

describe("2.6-C course failure (Cas A) triggers the aborted-order refund", () => {
  const UBER_CREDS = {
    clientId: "kb-client-id",
    clientSecret: "sk_live_uber_secret_777",
    customerId: "cus_uber_A",
    webhookSigningKey: "whsec_uber",
  };

  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
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
    customerA = await seedReachableCustomer(t, "eater-casA@x.fr");
    ({ orderId, paymentId } = await seedPaidOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_casA",
    ));
    // The 2.5-seeded pending delivery row with an accepted quote (course attempt).
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("deliveries", {
        tenantId: seed.tenantA.tenantId,
        orderId,
        mode: "delivery",
        status: "pending",
        quoteId: "dqt_OK",
        quoteFee: 590,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.useRealTimers();
  });

  it("Uber refusing the course post-payment auto-refunds and the order leaves KB Orders", async () => {
    const spy = vi.spyOn(global, "fetch");
    // Uber OAuth token, then Uber POST /deliveries refuses (Cas A), then Stripe
    // POST /refunds succeeds (the aborted-order auto refund).
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
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    // The course action schedules the aborted-order refund; flush it.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const payment = await readPayment(t, paymentId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.refundId).toBe("re_casA");
    expect((await readOrder(t, orderId)).order?.status).toBe("refusée");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// charge.refunded webhook reconciliation — withIdempotence (no double refund)
// ─────────────────────────────────────────────────────────────────────────────

describe("2.5-C chargeRefunded webhook — idempotent local reconciliation", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let paymentId: Id<"payments">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedReadyStripeAccount(t, seed.tenantA.tenantId, "acct_resto_A");
    customerA = await seedReachableCustomer(t, "eater-wh@x.fr");
    ({ paymentId } = await seedPaidOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "pi_wh",
    ));
  });

  it("a charge.refunded event reconciles the local payment to refunded once", async () => {
    const call = () =>
      t.mutation(internal.lib.stripe.refund.applyChargeRefunded, {
        eventId: "evt_wh_refund",
        paymentIntentId: "pi_wh",
        refundId: "re_wh",
      });
    const first = await call();
    const second = await call(); // redelivered event → no-op

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);

    const payment = await readPayment(t, paymentId);
    expect(payment?.status).toBe("refunded");
    expect(payment?.refundId).toBe("re_wh");

    const ledger = await t.run((ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "stripe").eq("externalId", "evt_wh_refund"),
        )
        .collect(),
    );
    expect(ledger).toHaveLength(1);
  });

  it("an unknown paymentIntent is a clean no-op", async () => {
    const out = await t.mutation(
      internal.lib.stripe.refund.applyChargeRefunded,
      {
        eventId: "evt_wh_unknown",
        paymentIntentId: "pi_nope",
        refundId: "re_x",
      },
    );
    expect(out.applied).toBe(false);
  });
});
