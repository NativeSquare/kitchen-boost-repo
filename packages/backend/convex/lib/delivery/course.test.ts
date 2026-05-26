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
 * 2.6-C — `createCourseOnPaymentConfirmed(tenantId, orderId)`, written BEFORE the
 * implementation (TDD red). Triggered by the `payment_intent.succeeded` confirmed
 * SIGNAL (provided by 2.5 — 2.6 does NOT wire the Stripe webhook): 2.5 seeds a
 * `pending` `deliveries` row, this action turns a `delivery`-mode row into a real
 * Uber Course (`uberDeliveryId` + status + ETA + courier), persisted via the
 * tenancy seam. Mode `click_collect` ⇒ NO Uber call, fee 0, no Course created.
 * All Uber HTTP is MOCKED.
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

/** Seed a confirmed order + its (2.5-seeded) pending delivery row directly. */
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
      status: "nouvelle",
      mode: mode === "click_collect" ? "pickup" : "delivery",
      source: "direct",
      address: mode === "delivery" ? "12 rue de Paris, 91000 Évry" : undefined,
      createdAt: now,
      paidAt: now,
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

  it("a course Uber refuses (Cas A) flags the delivery refused_post_payment", async () => {
    const { orderId } = await seedOrderWithDelivery(
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
  });
});
