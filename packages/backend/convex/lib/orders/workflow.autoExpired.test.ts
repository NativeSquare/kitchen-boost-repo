import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; the array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/orders/, so Vite emits keys relative to THIS dir; re-anchor every
// `./x` key at the convex root so convex-test's findModulesRoot has ONE common
// prefix (same intent as the workflow / refuse / transitions suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    // Vite emits keys relative to THIS file's dir (`convex/lib/orders/`); re-
    // anchor every shorter prefix at the convex root so convex-test's
    // findModulesRoot has ONE common prefix (same pattern as the refund suite).
    let key = path;
    if (key.startsWith("./")) key = `../../lib/orders/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

/**
 * #404 — Auto-expired timeout 5 min (PRD 20 §6b + ADR 0016 + kb-orders CONTEXT
 * "Cmd manquée"). Written BEFORE the implementation (TDD red).
 *
 * À la création d'une cmd (`nouvelle`), le backend poste un
 * `scheduler.runAfter(5min, expireIfNotAcknowledged)`. Au tick :
 *   - si la cmd est toujours `nouvelle` → transition vers l'état terminal
 *     **`auto_expired`** (distinct de `refusée`, ADR 0016 signaux orthogonaux),
 *     refund Stripe automatique (réutilise `refundOnRefusal` de #403/PR #430),
 *     notification client `refund_issued` queued (template neutre côté 2.7).
 *   - si la cmd a déjà transitionné (acceptée / refusée / ...) → no-op total :
 *     pas de transition, pas de refund double, pas de push. C'est LE bug subtil
 *     critique de cette story — l'idempotence du scheduler.
 *
 * NOTE — pour ces tests, on appelle directement la mutation interne
 * `expireIfNotAcknowledged` (l'idempotence est testée AU TICK, pas en attendant
 * 5 vraies minutes). L'arming du scheduler à `paymentSucceeded → nouvelle` est
 * testé séparément côté `confirmTenantOrderPayment` (E2E + integration via
 * convex-test scheduler).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

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

/** Seed an order already in `status` on `tenantId` for `customerId`, one line. */
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
    | "refusée"
    | "auto_expired",
): Promise<Id<"orders">> {
  return t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status,
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

/** Read one order with its time-ordered events directly (test-only). */
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

/** Read the notification journal rows for one customer (test-only). */
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

describe("#404 expireIfNotAcknowledged — tick → auto_expired + refund + push", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedReachableCustomer(t, "eater-a@x.fr");
    orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, "nouvelle");
  });

  it("transitions nouvelle → auto_expired (terminal), stamping autoExpiredAt + an auto_expired event", async () => {
    const result = await t.mutation(
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(result.expired).toBe(true);

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("auto_expired");
    expect(order?.autoExpiredAt).toBeTypeOf("number");
    // The auto_expired event is system-side — no actorUserId (the tick runs without
    // a human; the scheduler is the trigger, NOT the cuisinier).
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("auto_expired");
    expect(events[0].actorUserId).toBeUndefined();
    expect(events[0].at).toBeTypeOf("number");
  });

  it("emits the client refund_issued notification (queued — template neutre côté 2.7)", async () => {
    await t.mutation(internal.lib.orders.workflow.expireIfNotAcknowledged, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    const notifs = await readNotifs(t, customerA);
    // A reachable customer (wallet + web-push + email): the Archive trigger fans
    // out to all three channels, each journaled `queued` (PRD 80 §1 trigger 6 =
    // refund_issued). The actual template differentiation (motif vs neutre) is
    // the 2.7 sender's concern — here we only emit the trigger.
    expect(notifs.map((n) => n.channel).sort()).toEqual(
      ["email", "wallet_push", "web_push"].sort(),
    );
    expect(
      notifs.every((n) => n.transactionalTrigger === "refund_issued"),
    ).toBe(true);
    expect(notifs.every((n) => n.transactionalCategory === "archive")).toBe(
      true,
    );
    expect(notifs.every((n) => n.status === "queued")).toBe(true);
    expect(notifs.every((n) => n.tenantId === seed.tenantA.tenantId)).toBe(
      true,
    );
  });

  it("schedules the Stripe refund action (réutilise refundOnRefusal de #403)", async () => {
    // The expire mutation defers the actual Stripe network call to the existing
    // 2.5 refund action `refundOnRefusal` via `ctx.scheduler.runAfter(0, …)`. We
    // observe that the scheduled job is registered (no need to drain it; the
    // mocked Stripe HTTP layer + the refund flow are already covered by the
    // 2.5-C refund suite).
    const before = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    await t.mutation(internal.lib.orders.workflow.expireIfNotAcknowledged, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    const after = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    // Exactly one new scheduled job (the refund action). The job name pin
    // asserts we did NOT invent a new Stripe path — we reuse #403's refund.
    expect(after.length).toBe(before.length + 1);
    const newJobs = after.filter(
      (job) => !before.some((b) => b._id === job._id),
    );
    expect(newJobs).toHaveLength(1);
    expect(JSON.stringify(newJobs[0])).toContain("refundOnRefusal");
  });
});

describe("#404 expireIfNotAcknowledged — IDEMPOTENCE (le bug subtil)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedReachableCustomer(t, "eater-idem@x.fr");
  });

  // The whole reason ADR 0016 chose a separate `auto_expired` state + a single
  // scheduler tick: the tick may fire AFTER the order has already transitioned
  // (acceptée par le cuisinier, refusée humain, ou même déjà auto_expired). Le
  // tick doit no-op dans ces cas — pas de double refund, pas de double push,
  // pas de transition illégale.

  it("no-op si la cmd a été acceptée entre-temps (en préparation)", async () => {
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "en préparation",
    );

    const result = await t.mutation(
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(result.expired).toBe(false);

    // Order untouched: still en préparation, no auto_expired event, no notif.
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("en préparation");
    expect(order?.autoExpiredAt).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });

  it("no-op si la cmd est déjà prête (workflow avancé)", async () => {
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "prête",
    );
    const result = await t.mutation(
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(result.expired).toBe(false);
    const { order } = await readOrder(t, orderId);
    expect(order?.status).toBe("prête");
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });

  it("no-op si la cmd est déjà refusée humaine (#403) — pas de double refund", async () => {
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "refusée",
    );
    const result = await t.mutation(
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(result.expired).toBe(false);
    const { order } = await readOrder(t, orderId);
    expect(order?.status).toBe("refusée");
    // Crucial: no second refund queued — the human refus already emitted one
    // refund_issued, the tick must NOT emit a second.
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });

  it("no-op si la cmd est déjà auto_expired (re-tick — pas de double refund)", async () => {
    // Scheduler may also be retried (Convex at-least-once on retry budget): the
    // tick must be safe to re-execute. Already-auto_expired ⇒ clean no-op.
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "auto_expired",
    );
    const result = await t.mutation(
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(result.expired).toBe(false);
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("auto_expired");
    // No second auto_expired event was appended.
    expect(events).toHaveLength(0);
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });

  it("no-op si la cmd est déjà livrée (workflow terminal happy path)", async () => {
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "livrée",
    );
    const result = await t.mutation(
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: seed.tenantA.tenantId, orderId },
    );
    expect(result.expired).toBe(false);
    const { order } = await readOrder(t, orderId);
    expect(order?.status).toBe("livrée");
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });

  it("no-op sur un orderId d'un autre tenant (ownership re-check, no cross-tenant write)", async () => {
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "nouvelle",
    );
    // Tenant B's tick fired on tenant A's order — the seam re-checks ownership,
    // so this is a clean no-op (NOT_FOUND swallowed → no-op semantics for a
    // system-scheduled tick: the order is unreachable from this tenant).
    const result = await t.mutation(
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: seed.tenantB.tenantId, orderId },
    );
    expect(result.expired).toBe(false);

    // A's order is untouched — still nouvelle, no events, no notif leaked.
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("nouvelle");
    expect(events).toHaveLength(0);
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });
});

describe("#404 expireIfNotAcknowledged — scheduler armed at confirmPaymentSucceeded (E2E)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let pickupOrderId: Id<"orders">;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedReachableCustomer(t, "eater-sched@x.fr");

    // Seed a PICKUP pending order (the click & collect path confirms immediately
    // at payment, without the delivery course gate — the simpler arming case).
    pickupOrderId = await t.run(async (ctx) => {
      const orderId = await ctx.db.insert("orders", {
        tenantId: seed.tenantA.tenantId,
        customerId: customerA,
        status: "en attente de paiement",
        mode: "pickup",
        source: "direct",
        createdAt: Date.now(),
      });
      await ctx.db.insert("orderItems", {
        tenantId: seed.tenantA.tenantId,
        orderId,
        itemName: "Bao",
        unitPrice: 990,
        quantity: 1,
        modifiers: [],
        allergens: [],
      });
      // Seed a payments row + tenant stripeAccountId so the downstream refund
      // path has something to resolve (the refund test suite mocks the Stripe
      // call; here we ONLY assert the scheduler is armed at the right moment).
      await ctx.db.insert("payments", {
        tenantId: seed.tenantA.tenantId,
        orderId,
        paymentIntentId: "pi_pickup_404",
        status: "processing",
        applicationFeeAmountHt: 200,
        amountTotal: 990,
        pricingSnapshot: { subtotal: 990, deliveryFee: 0, total: 990 },
        failedAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return orderId;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scheduler.runAfter(5min, expireIfNotAcknowledged) is posted when a pickup order is confirmed (→ nouvelle)", async () => {
    // Drive a payment_intent.succeeded directly through the dispatched mutation
    // (the webhook entry point is upstream — its signature/parse are 2.5-A; here
    // we only need the confirmation to fire so the order becomes nouvelle).
    await t.mutation(internal.lib.stripe.payment.confirmPaymentSucceeded, {
      eventId: "evt_pickup_404",
      paymentIntentId: "pi_pickup_404",
    });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const expireJob = scheduled.find((j) =>
      JSON.stringify(j).includes("expireIfNotAcknowledged"),
    );
    expect(expireJob).toBeDefined();
    // 5 minutes after now (within a small tolerance — scheduledTime is absolute).
    const fiveMin = 5 * 60 * 1000;
    expect(
      expireJob !== undefined &&
        Math.abs(expireJob.scheduledTime - (Date.now() + fiveMin)) < 2_000,
    ).toBe(true);
  });
});
