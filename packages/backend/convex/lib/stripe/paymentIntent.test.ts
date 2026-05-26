import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    path.startsWith("./") ? `../../lib/stripe/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.5-B — `createPaymentIntent`: the DIRECT-CHARGE PaymentIntent creation action,
 * written BEFORE the implementation (TDD red). The Stripe wire call is mocked
 * (`global.fetch`) so we assert the request SHAPE without a network call:
 *  - it targets the resto's connected account via the `Stripe-Account: acct_resto`
 *    header (direct charge — the resto is merchant of record);
 *  - it carries the IMMUTABLE `application_fee_amount=240` (KB commission, Q30-Q1);
 *  - it enables Apple/Google Pay via `automatic_payment_methods`;
 *  - it does NOT pass `on_behalf_of` (that is a destination-charge param — never
 *    used at KB, payment CONTEXT);
 *  - the charged amount = the total RECEIVED from pricing (#20), not recomputed;
 *  - a Stripe idempotency key is sent (no double-charge on retry).
 * It then persists a `payments` row keyed on the order + the paymentIntentId.
 *
 * The action is CUSTOMER-scoped (scope self): the client can only pay for its OWN
 * order. The cross-tenant fuzz asserts every unauthorized actor is rejected before
 * any Stripe call.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PRICING = { subtotal: 1290, deliveryFee: 295, total: 1585 };

/** A `customers` fiche owned by a given auth user (self-scope linkage). */
async function seedCustomerForUser(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) =>
    ctx.db.insert("customers", { userId, email, createdAt: Date.now() }),
  );
}

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
      allergens: ["gluten"],
    });
    return orderId;
  });
}

/** Mark tenant A's Stripe account ready (a direct charge needs a connected acct). */
async function stampReadyAccount(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  acct: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(tenantId, {
      stripeAccountId: acct,
      stripeStatus: "ready",
    });
  });
}

describe("2.5-B createPaymentIntent — direct charge on the resto account", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let eaterUser: Id<"users">;
  let customerId: Id<"customers">;
  let orderId: Id<"orders">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    eaterUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "eater@x.fr", role: "customer" }),
    );
    customerId = await seedCustomerForUser(t, eaterUser, "eater@x.fr");
    orderId = await seedPendingOrder(t, seed.tenantA.tenantId, customerId);
    await stampReadyAccount(t, seed.tenantA.tenantId, "acct_resto_A");

    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "pi_created_123",
          client_secret: "pi_created_123_secret_xyz",
          status: "requires_payment_method",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("creates a direct charge with Stripe-Account header + fee 240 + automatic_payment_methods, no on_behalf_of", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(
      api.lib.stripe.paymentIntent.createPaymentIntent,
      {
        tenantId: seed.tenantA.tenantId,
        orderId,
        pricingSnapshot: PRICING,
      },
    );
    expect(res.clientSecret).toBe("pi_created_123_secret_xyz");
    expect(res.paymentIntentId).toBe("pi_created_123");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/payment_intents");

    const headers = new Headers(init.headers);
    // Direct charge: the request runs in the resto's connected-account context.
    expect(headers.get("Stripe-Account")).toBe("acct_resto_A");
    // A Stripe idempotency key guards against a double-charge on retry.
    expect(headers.get("Idempotency-Key")).toBeTruthy();

    const body = String(init.body);
    const params = new URLSearchParams(body);
    // Immutable KB commission (Q30-Q1) — exactly 240 cts TTC.
    expect(params.get("application_fee_amount")).toBe("240");
    // The charged amount = the total received from pricing (#20), not recomputed.
    expect(params.get("amount")).toBe(String(PRICING.total));
    expect(params.get("currency")).toBe("eur");
    // Apple Pay / Google Pay via Payment Element.
    expect(params.get("automatic_payment_methods[enabled]")).toBe("true");
    // NEVER on_behalf_of (destination-charge param — not used at KB).
    expect(body).not.toContain("on_behalf_of");
  });

  it("persists a payments row (by order + by paymentIntentId, commission stored HT)", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    await asEater.action(api.lib.stripe.paymentIntent.createPaymentIntent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      pricingSnapshot: PRICING,
    });

    const payment = await t.run(async (ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_payment_intent", (q) =>
          q.eq("paymentIntentId", "pi_created_123"),
        )
        .unique(),
    );
    expect(payment).not.toBeNull();
    expect(payment?.tenantId).toBe(seed.tenantA.tenantId);
    expect(payment?.orderId).toBe(orderId);
    expect(payment?.status).toBe("requires_payment_method");
    // Commission stored HT (200 cts) for CGI-compliant reporting (Q30-Q7).
    expect(payment?.applicationFeeAmountHt).toBe(200);
    expect(payment?.amountTotal).toBe(PRICING.total);
  });

  it("refuses to charge a tenant whose Stripe account is not ready", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, { stripeStatus: "pending" });
    });
    const asEater = t.withIdentity({ subject: eaterUser });
    await expect(
      asEater.action(api.lib.stripe.paymentIntent.createPaymentIntent, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to pay for an order owned by another customer (scope self)", async () => {
    const otherUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "other@x.fr", role: "customer" }),
    );
    const asOther = t.withIdentity({ subject: otherUser });
    await expect(
      asOther.action(api.lib.stripe.paymentIntent.createPaymentIntent, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("2.5-B createPaymentIntent — cross-tenant fuzz (ADR 0010)", () => {
  // The action itself dispatches its access gate to a CUSTOMER-scoped query
  // (`assertOwnPendingOrder`) before any Stripe call — it is that exported query
  // the fuzz harness replays (the harness drives queries/mutations, not actions).
  // The action-level rejections (a manager, another customer) are asserted above
  // via direct `.action()` calls.
  it("the order-ownership guard query throws for every unauthorized actor", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await t.run(async (ctx) =>
      ctx.db.insert("customers", {
        userId: seed.customerId,
        email: "eater@x.fr",
        createdAt: Date.now(),
      }),
    );
    const orderId = await seedPendingOrder(
      t,
      seed.tenantA.tenantId,
      customerId,
    );

    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.stripe.paymentIntent.assertOwnPendingOrder],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      extraArgs: { orderId },
      actors,
    });
    expect(leaks).toEqual([]);
  });
});
