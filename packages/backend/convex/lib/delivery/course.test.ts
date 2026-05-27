import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required.
// This file lives in convex/lib/delivery/, so normalise every key to be relative
// to the convex root (../../) so convex-test's findModulesRoot has ONE prefix.
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

/**
 * 2.6-C + 2.3-fix (#108) — `createCourseOnPaymentConfirmed(tenantId, orderId)`.
 * Triggered by the `payment_intent.succeeded` confirmed SIGNAL (provided by 2.5 —
 * 2.6 does NOT wire the Stripe webhook): 2.5 seeds a `pending` `deliveries` row in
 * `delivery` mode WITHOUT confirming the order (the order stays `en attente de
 * paiement`, invisible, no stats — strict payment↔delivery coupling, #108). This
 * action turns the row into a real Uber Course (`uberDeliveryId` + status + ETA +
 * courier), and ONLY on a successfully created course does it CONFIRM the order
 * (`en attente de paiement → nouvelle`, freeze pricing, +1 `customerOrdersPerTenant`
 * MOAT stats) so the resto sees it (beep) exactly when the course exists. A refused
 * course (Cas A) never confirms the order — it triggers the aborted-order auto-refund
 * (#49). Mode `click_collect` ⇒ NO Uber call, fee 0, no Course (the pickup order was
 * already confirmed at payment). All Uber HTTP is MOCKED.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const CREDS = {
  clientId: "kb-client-id",
  clientSecret: "sk_live_uber_secret_777",
  customerId: "cus_uber_A",
  webhookSigningKey: "whsec_uber",
};

function mockUberCreate(create: {
  status: number;
  body: Record<string, unknown>;
}): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(
    new Response(JSON.stringify({ access_token: "ub_token_abc" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  spy.mockResolvedValueOnce(
    new Response(JSON.stringify(create.body), {
      status: create.status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return spy as ReturnType<typeof vi.spyOn>;
}

/**
 * Seed an order + its (2.5-seeded) pending delivery row directly, in the realistic
 * pre-course state of the strict-coupling flow (#108): a DELIVERY order is still
 * `en attente de paiement` (NOT yet visible, NOT yet counted) with a frozen pricing
 * snapshot so the course executor can confirm it on success. A click & collect order
 * is already `nouvelle` (confirmed at payment — no course gate).
 */
const PRICING = { subtotal: 1290, deliveryFee: 295, total: 1585 };

async function seedOrderWithDelivery(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  mode: "delivery" | "click_collect",
): Promise<{ orderId: Id<"orders">; customerId: Id<"customers"> }> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "eater@x.fr",
      role: "customer",
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      createdAt: now,
    });
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      // Delivery is gated on course-created → still pending here; pickup is confirmed.
      status: mode === "delivery" ? "en attente de paiement" : "nouvelle",
      mode: mode === "click_collect" ? "pickup" : "delivery",
      source: "direct",
      address: mode === "delivery" ? "12 rue de Paris, 91000 Évry" : undefined,
      pricingSnapshot: PRICING,
      createdAt: now,
      ...(mode === "click_collect" ? { paidAt: now } : {}),
    });
    await ctx.db.insert("payments", {
      tenantId,
      orderId,
      paymentIntentId: `pi_${orderId}`,
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
      mode,
      status: "pending",
      quoteId: "dqt_OK",
      quoteFee: 590,
      createdAt: now,
      updatedAt: now,
    });
    return { orderId, customerId };
  });
}

/** Read one order + its stats row (#108: confirmed-on-course-created assertions). */
async function readOrderAndStats(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  customerId: Id<"customers">,
) {
  return t.run(async (ctx) => {
    const order = await ctx.db.get(orderId);
    const stats = await ctx.db
      .query("customerOrdersPerTenant")
      .withIndex("by_tenant_customer", (q) =>
        q.eq("tenantId", tenantId).eq("customerId", customerId),
      )
      .unique();
    return { order, stats };
  });
}

async function readDelivery(
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
      .unique(),
  );
}

describe("2.6-C createCourseOnPaymentConfirmed — delivery mode creates an Uber Course", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("persists uberDeliveryId + status + courier/ETAs on the seeded delivery row", async () => {
    const { orderId } = await seedOrderWithDelivery(
      t,
      seed.tenantA.tenantId,
      "delivery",
    );
    fetchSpy = mockUberCreate({
      status: 200,
      body: {
        id: "del_uber_99",
        status: "pending",
        pickup_eta: 1_700_000_000_000,
        courier: { name: "Sami", phone_number: "+33600000000" },
      },
    });

    const out = await t.action(
      internal.lib.delivery.course.createCourseOnPaymentConfirmed,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(out.courseCreated).toBe(true);

    const row = await readDelivery(t, seed.tenantA.tenantId, orderId);
    expect(row?.uberDeliveryId).toBe("del_uber_99");
    expect(row?.courierName).toBe("Sami");
    expect(row?.pickupEta).toBe(1_700_000_000_000);
    // Two Uber HTTP calls: OAuth token + POST /deliveries.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("#108 a created course MAKES the delivery order visible (→ nouvelle) and increments the MOAT stats — gated on course-created", async () => {
    const { orderId, customerId } = await seedOrderWithDelivery(
      t,
      seed.tenantA.tenantId,
      "delivery",
    );
    // Before the course exists, the order is invisible + uncounted (2.5 left it so).
    const before = await readOrderAndStats(
      t,
      seed.tenantA.tenantId,
      orderId,
      customerId,
    );
    expect(before.order?.status).toBe("en attente de paiement");
    expect(before.stats).toBeNull();

    fetchSpy = mockUberCreate({
      status: 200,
      body: { id: "del_uber_ok", status: "pending" },
    });

    await t.action(
      internal.lib.delivery.course.createCourseOnPaymentConfirmed,
      { tenantId: seed.tenantA.tenantId, orderId },
    );

    // Course created ⇒ the order is now transmitted to KB Orders (nouvelle, paidAt,
    // pricing frozen) and the customer stats are incremented exactly once.
    const after = await readOrderAndStats(
      t,
      seed.tenantA.tenantId,
      orderId,
      customerId,
    );
    expect(after.order?.status).toBe("nouvelle");
    expect(after.order?.paidAt).toBeTypeOf("number");
    expect(after.order?.pricingSnapshot?.total).toBe(1585);
    expect(after.stats?.totalOrders).toBe(1);
    expect(after.stats?.ltv).toBe(15.85);
  });

  it("#108 idempotence: re-running a created course confirms the order + counts the stats exactly once", async () => {
    const { orderId, customerId } = await seedOrderWithDelivery(
      t,
      seed.tenantA.tenantId,
      "delivery",
    );
    // First run creates the course + confirms the order.
    fetchSpy = mockUberCreate({
      status: 200,
      body: { id: "del_uber_idem", status: "pending" },
    });
    await t.action(
      internal.lib.delivery.course.createCourseOnPaymentConfirmed,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    // A re-trigger sees the row already has an uberDeliveryId → no-op (no second
    // Uber call, no second confirm, no double stats).
    fetchSpy.mockRestore();
    fetchSpy = vi.spyOn(global, "fetch");
    const second = await t.action(
      internal.lib.delivery.course.createCourseOnPaymentConfirmed,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(second.courseCreated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const after = await readOrderAndStats(
      t,
      seed.tenantA.tenantId,
      orderId,
      customerId,
    );
    expect(after.order?.status).toBe("nouvelle");
    expect(after.stats?.totalOrders).toBe(1); // counted once
  });

  it("click_collect ⇒ NO Uber call, no uberDeliveryId, no Course created (no-op)", async () => {
    const { orderId } = await seedOrderWithDelivery(
      t,
      seed.tenantA.tenantId,
      "click_collect",
    );
    fetchSpy = vi.spyOn(global, "fetch");

    const out = await t.action(
      internal.lib.delivery.course.createCourseOnPaymentConfirmed,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(out.courseCreated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = await readDelivery(t, seed.tenantA.tenantId, orderId);
    expect(row?.uberDeliveryId).toBeUndefined();
    expect(row?.status).toBe("pending"); // unchanged
  });

  it("a course Uber refuses (Cas A) flags the delivery refused_post_payment AND never makes the order visible / counted (#108)", async () => {
    const { orderId, customerId } = await seedOrderWithDelivery(
      t,
      seed.tenantA.tenantId,
      "delivery",
    );
    fetchSpy = mockUberCreate({
      status: 422,
      body: { code: "address_undeliverable" },
    });

    const out = await t.action(
      internal.lib.delivery.course.createCourseOnPaymentConfirmed,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(out.courseCreated).toBe(false);

    const row = await readDelivery(t, seed.tenantA.tenantId, orderId);
    expect(row?.incidentType).toBe("refused_post_payment");
    expect(row?.uberDeliveryId).toBeUndefined();

    // #108: the order was NEVER confirmed — it stays gated, the resto never sees it,
    // and the MOAT stats stay untouched (the aborted-order refund runs separately).
    const after = await readOrderAndStats(
      t,
      seed.tenantA.tenantId,
      orderId,
      customerId,
    );
    expect(after.order?.status).toBe("en attente de paiement");
    expect(after.order?.paidAt).toBeUndefined();
    expect(after.stats).toBeNull();
  });
});
