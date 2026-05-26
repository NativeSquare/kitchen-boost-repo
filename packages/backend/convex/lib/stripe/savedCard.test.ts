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
 * 2.5-D — saved card reusable cross-resto (clone PaymentMethod). Written BEFORE the
 * implementation (TDD red). POC #6 validated the cross-account clone:
 * `stripe.paymentMethods.create({ customer, payment_method }, { stripeAccount: acct })`.
 *
 * Two backend entries, BOTH customer-scoped (scope self — the client only ever
 * operates on its OWN fiche / its OWN order):
 *  - `saveCard` — create-or-reuse the PLATFORM-level Stripe `Customer` (cus_…, KB
 *    account, NOT tenant), attach the front-collected `PaymentMethod` to it, and
 *    store `stripeCustomerId` + `savedPaymentMethodId` on the caller's OWN global
 *    `customers` fiche (the MOAT, no tenantId — payment CONTEXT "Customer au niveau
 *    du compte plateforme KB").
 *  - `payWithSavedCard` — at checkout on resto X: CLONE the platform PM to resto
 *    X's connected account (`Stripe-Account: acct_resto`), then a direct-charge
 *    PaymentIntent confirmed with the cloned card + the IMMUTABLE
 *    `application_fee_amount=240` (Q30-Q1). The original platform PM stays INTACT
 *    (re-clonable to resto Y next time). Persists the `payments` row.
 *
 * The Stripe wire calls are mocked (`global.fetch`); we assert the request SHAPE.
 * The mandatory cross-tenant fuzz (ADR 0010) asserts the order-ownership guard
 * throws for every unauthorized actor — a customer only clones/charges for its own
 * order.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PRICING = { subtotal: 1290, deliveryFee: 295, total: 1585 };

/** A `customers` fiche owned by a given auth user (self-scope linkage). */
async function seedCustomerForUser(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<Id<"customers">> {
  return t.run(async (ctx) =>
    ctx.db.insert("customers", {
      userId,
      email,
      createdAt: Date.now(),
      ...extra,
    }),
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

/** Mark a tenant's Stripe account ready (a direct charge needs a connected acct). */
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

/** Read the caller's own fiche back (assert platform Customer / saved PM state). */
async function readFiche(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
) {
  return t.run(async (ctx) => ctx.db.get(customerId));
}

// ---------------------------------------------------------------------------
// saveCard — platform Customer create/reuse + attach + store on OWN fiche
// ---------------------------------------------------------------------------

describe("2.5-D saveCard — platform Stripe Customer + attach saved PaymentMethod", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let eaterUser: Id<"users">;
  let customerId: Id<"customers">;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    eaterUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "eater@x.fr", role: "customer" }),
    );
    customerId = await seedCustomerForUser(t, eaterUser, "eater@x.fr");
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("creates a platform Customer, attaches the PM, stores both on the OWN fiche", async () => {
    // 1. POST /customers → cus_kb. 2. POST /payment_methods/pm/attach → ok.
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "cus_kb_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pm_saved_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(api.lib.stripe.savedCard.saveCard, {
      tenantId: seed.tenantA.tenantId,
      paymentMethodId: "pm_saved_1",
    });
    expect(res.stripeCustomerId).toBe("cus_kb_123");

    // Platform Customer created at the KB account level (NO Stripe-Account header).
    const [customersUrl, customersInit] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(customersUrl).toContain("/customers");
    expect(new Headers(customersInit.headers).get("Stripe-Account")).toBeNull();

    // PM attached to that platform Customer.
    const [attachUrl, attachInit] = fetchSpy.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(attachUrl).toContain("/payment_methods/pm_saved_1/attach");
    expect(new URLSearchParams(String(attachInit.body)).get("customer")).toBe(
      "cus_kb_123",
    );
    expect(new Headers(attachInit.headers).get("Stripe-Account")).toBeNull();

    const fiche = await readFiche(t, customerId);
    expect(fiche?.stripeCustomerId).toBe("cus_kb_123");
    expect(fiche?.savedPaymentMethodId).toBe("pm_saved_1");
  });

  it("reuses the existing platform Customer when the fiche already has one", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(customerId, { stripeCustomerId: "cus_existing" });
    });
    // Only the attach call should fire (no /customers create).
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "pm_saved_2" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(api.lib.stripe.savedCard.saveCard, {
      tenantId: seed.tenantA.tenantId,
      paymentMethodId: "pm_saved_2",
    });
    expect(res.stripeCustomerId).toBe("cus_existing");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [attachUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(attachUrl).toContain("/payment_methods/pm_saved_2/attach");

    const fiche = await readFiche(t, customerId);
    expect(fiche?.stripeCustomerId).toBe("cus_existing");
    expect(fiche?.savedPaymentMethodId).toBe("pm_saved_2");
  });

  it("provisions a fiche for a customer who has none yet, then saves the card", async () => {
    const freshUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "fresh@x.fr", role: "customer" }),
    );
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "cus_fresh" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pm_fresh" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const asFresh = t.withIdentity({ subject: freshUser });
    await asFresh.action(api.lib.stripe.savedCard.saveCard, {
      tenantId: seed.tenantA.tenantId,
      paymentMethodId: "pm_fresh",
    });

    const fiche = await t.run(async (ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", freshUser))
        .unique(),
    );
    expect(fiche?.stripeCustomerId).toBe("cus_fresh");
    expect(fiche?.savedPaymentMethodId).toBe("pm_fresh");
  });

  it("refuses a PRO caller (customer scope only)", async () => {
    fetchSpy = vi.spyOn(global, "fetch");
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.action(api.lib.stripe.savedCard.saveCard, {
        tenantId: seed.tenantA.tenantId,
        paymentMethodId: "pm_x",
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// payWithSavedCard — clone the platform PM to the resto + direct charge it
// ---------------------------------------------------------------------------

describe("2.5-D payWithSavedCard — clone PaymentMethod cross-account + direct charge", () => {
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
    customerId = await seedCustomerForUser(t, eaterUser, "eater@x.fr", {
      stripeCustomerId: "cus_kb_123",
      savedPaymentMethodId: "pm_platform_orig",
    });
    orderId = await seedPendingOrder(t, seed.tenantA.tenantId, customerId);
    await stampReadyAccount(t, seed.tenantA.tenantId, "acct_resto_A");

    // 1. clone (POST /payment_methods on the connected account) → cloned pm.
    // 2. direct charge (POST /payment_intents on the connected account) → pi.
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "pm_cloned_A" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "pi_saved_card_1",
            client_secret: "pi_saved_card_1_secret",
            status: "succeeded",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("clones the platform PM to the resto account (POC #6 shape), then direct-charges the clone", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    const res = await asEater.action(
      api.lib.stripe.savedCard.payWithSavedCard,
      { tenantId: seed.tenantA.tenantId, orderId, pricingSnapshot: PRICING },
    );
    expect(res.paymentIntentId).toBe("pi_saved_card_1");

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // 1. CLONE — POST /payment_methods on the resto's connected account, passing the
    //    platform customer + the platform PM (POC #6 verbatim shape).
    const [cloneUrl, cloneInit] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(cloneUrl).toContain("/payment_methods");
    expect(cloneUrl).not.toContain("/attach");
    expect(new Headers(cloneInit.headers).get("Stripe-Account")).toBe(
      "acct_resto_A",
    );
    const cloneBody = new URLSearchParams(String(cloneInit.body));
    expect(cloneBody.get("customer")).toBe("cus_kb_123");
    expect(cloneBody.get("payment_method")).toBe("pm_platform_orig");

    // 2. DIRECT CHARGE — PaymentIntent on the resto account with the CLONED pm,
    //    immutable fee 240, no on_behalf_of, charging the pricing total verbatim.
    const [piUrl, piInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(piUrl).toContain("/payment_intents");
    const piHeaders = new Headers(piInit.headers);
    expect(piHeaders.get("Stripe-Account")).toBe("acct_resto_A");
    expect(piHeaders.get("Idempotency-Key")).toBeTruthy();
    const piBody = new URLSearchParams(String(piInit.body));
    expect(piBody.get("payment_method")).toBe("pm_cloned_A");
    expect(piBody.get("application_fee_amount")).toBe("240");
    expect(piBody.get("amount")).toBe(String(PRICING.total));
    expect(piBody.get("currency")).toBe("eur");
    expect(piBody.get("confirm")).toBe("true");
    expect(String(piInit.body)).not.toContain("on_behalf_of");
  });

  it("leaves the original platform PaymentMethod intact (no detach/delete call)", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    await asEater.action(api.lib.stripe.savedCard.payWithSavedCard, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      pricingSnapshot: PRICING,
    });
    // Only clone + charge — no DELETE / detach of the platform PM.
    for (const call of fetchSpy.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect((init.method ?? "GET").toUpperCase()).not.toBe("DELETE");
      expect(String((call as [string])[0])).not.toContain("detach");
    }
    // The fiche still carries the same untouched platform PM.
    const fiche = await readFiche(t, customerId);
    expect(fiche?.savedPaymentMethodId).toBe("pm_platform_orig");
  });

  it("persists a payments row keyed by order + paymentIntentId, commission stored HT", async () => {
    const asEater = t.withIdentity({ subject: eaterUser });
    await asEater.action(api.lib.stripe.savedCard.payWithSavedCard, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      pricingSnapshot: PRICING,
    });
    const payment = await t.run(async (ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_payment_intent", (q) =>
          q.eq("paymentIntentId", "pi_saved_card_1"),
        )
        .unique(),
    );
    expect(payment).not.toBeNull();
    expect(payment?.tenantId).toBe(seed.tenantA.tenantId);
    expect(payment?.orderId).toBe(orderId);
    expect(payment?.status).toBe("succeeded");
    expect(payment?.applicationFeeAmountHt).toBe(200);
    expect(payment?.amountTotal).toBe(PRICING.total);
  });

  it("refuses when the caller has no saved card", async () => {
    const noCardUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "nocard@x.fr", role: "customer" }),
    );
    const noCardCustomer = await seedCustomerForUser(
      t,
      noCardUser,
      "nocard@x.fr",
    );
    const noCardOrder = await seedPendingOrder(
      t,
      seed.tenantA.tenantId,
      noCardCustomer,
    );
    const asNoCard = t.withIdentity({ subject: noCardUser });
    await expect(
      asNoCard.action(api.lib.stripe.savedCard.payWithSavedCard, {
        tenantId: seed.tenantA.tenantId,
        orderId: noCardOrder,
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to pay for an order owned by another customer (scope self — no clone)", async () => {
    const otherUser = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "other@x.fr", role: "customer" }),
    );
    await seedCustomerForUser(t, otherUser, "other@x.fr", {
      stripeCustomerId: "cus_other",
      savedPaymentMethodId: "pm_other",
    });
    const asOther = t.withIdentity({ subject: otherUser });
    await expect(
      asOther.action(api.lib.stripe.savedCard.payWithSavedCard, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to charge a tenant whose Stripe account is not ready", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, { stripeStatus: "pending" });
    });
    const asEater = t.withIdentity({ subject: eaterUser });
    await expect(
      asEater.action(api.lib.stripe.savedCard.payWithSavedCard, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        pricingSnapshot: PRICING,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz (ADR 0010) — the ownership guard throws for every attacker
// ---------------------------------------------------------------------------

describe("2.5-D payWithSavedCard — cross-tenant fuzz (ADR 0010)", () => {
  it("the saved-card ownership guard query throws for every unauthorized actor", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await t.run(async (ctx) =>
      ctx.db.insert("customers", {
        userId: seed.customerId,
        email: "eater@x.fr",
        stripeCustomerId: "cus_kb_123",
        savedPaymentMethodId: "pm_platform_orig",
        createdAt: Date.now(),
      }),
    );
    const orderId = await seedPendingOrder(
      t,
      seed.tenantA.tenantId,
      customerId,
    );
    await stampReadyAccount(t, seed.tenantA.tenantId, "acct_resto_A");

    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.stripe.savedCard.assertOwnSavedCardOrder],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      extraArgs: { orderId },
      actors,
    });
    expect(leaks).toEqual([]);
  });
});
