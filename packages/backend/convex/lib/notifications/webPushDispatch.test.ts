import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { verifyInternalRequest } from "../wallet/internalAuth";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * 2.7-C (#54) — the WEB-PUSH DISPATCHER branch (the second effective channel after
 * Wallet #126), written BEFORE the module (TDD red).
 *
 * The engine (#44) journals one `notificationEvents` row per effective channel as
 * `queued`; #126 materialised the Wallet channels. This slice is the GLUE that
 * materialises the `web_push` channel: it reads the customer's ACTIVE web-push
 * subscriptions (#128 read seam `listActiveWebPushSubscriptions`, tenant-scoped),
 * HMAC-signs a `fetch` to the Next.js Node route (`apps/web/app/api/push/send`,
 * where the `web-push` VAPID encryption runs — the V8 Convex runtime can't do ECDH
 * AES-GCM, STACK §5.5 / POC #2), and reflects the result back onto the journal row:
 *  - pushed to ≥ 1 live endpoint              → `sent` (+`sentAt`).
 *  - the route reported every endpoint gone (410) → `inactive_endpoint`, and each
 *    gone endpoint is soft-deactivated via the #128 seam `deactivateWebPushSubscription`.
 *  - no active subscription                   → `inactive_endpoint` (nothing to send).
 *  - the transport THREW (route unreachable / rejected) → `failed`.
 *  - `wallet_*` / `email` / `sms` are OUT OF SCOPE — never touched here.
 *
 * Wiring (PRD 80): `notifyOrderEvent` is a `tenantMutation`; it cannot call an
 * `internalAction` directly, so it SCHEDULES the dispatch (`runAfter(0, …)`). The
 * route's web-push send + the VAPID keys are HITL (off CI) — all HTTP is MOCKED at
 * the `fetch` boundary, exactly like the Wallet dispatcher.
 *
 * Isolation (ADR 0010): the dispatch is keyed on a `tenantId` it received from the
 * mutation that resolved it; the journal row + the subscriptions are read/patched
 * through the tenant-scoped seams (a foreign `eventId`/`tenantId` cannot touch
 * another tenant's rows); the fuzz suite replays the public entrypoint under
 * unauthorized actors. MOAT (ADR 0012): the customer is referenced strictly BY ID;
 * the dispatch returns only an aggregate count.
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (path.startsWith("./")) {
      key = `../../lib/notifications/${path.slice(2)}`;
    } else if (path.startsWith("../") && !path.startsWith("../../")) {
      key = `../../lib/${path.slice(3)}`;
    }
    return [key, loader];
  }),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const SECRET = "kb-internal-shared-secret";
const PUSH_URL = "https://buns.kitchen-boost.com/api/push/send";

/** A fetch stub that records calls and answers a fixed body / status. */
function stubFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throws?: boolean;
}): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (response.throws) throw new Error("network down");
      return new Response(JSON.stringify(response.body ?? {}), {
        status: response.status ?? (response.ok === false ? 502 : 200),
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { calls };
}

/** Drain the `runAfter(0, …)` dispatch chain robustly under fake timers. */
async function drainScheduled(t: ReturnType<typeof convexTest>): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await vi.runAllTimersAsync();
    await t.finishInProgressScheduledFunctions();
  }
}

/**
 * Seed a customer web-push-enrolled (per-channel status + N active subscriptions in
 * the #128 table for the given tenant) so the web_push channel has a transport target.
 */
async function seedWebPushCustomer(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  email: string,
  endpoints: string[],
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    const customerId = await ctx.db.insert("customers", {
      userId,
      email,
      phone: "+33600000000",
      pushEnrollment: {
        webPushStatus: "enrolled",
      },
      createdAt: Date.now(),
    });
    for (const endpoint of endpoints) {
      await ctx.db.insert("webPushSubscriptions", {
        customerId,
        tenantId,
        endpoint,
        p256dh: `p256dh-${endpoint}`,
        auth: `auth-${endpoint}`,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return customerId;
  });
}

async function placeOrder(
  t: ReturnType<typeof convexTest>,
  managerId: Id<"users">,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
): Promise<Id<"orders">> {
  const asManager = t.withIdentity({ subject: managerId });
  return asManager.mutation(api.lib.orders.orders.placeOrder, {
    tenantId,
    customerId,
    mode: "delivery",
    items: [
      {
        itemName: "Smash",
        unitPrice: 1290,
        quantity: 1,
        modifiers: [],
        allergens: [],
      },
    ],
  });
}

/** All journal rows for a customer. */
async function eventsFor(
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

/** All web-push subscription rows of a customer (to assert the soft-deactivate). */
async function subsFor(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
) {
  return t.run((ctx) =>
    ctx.db
      .query("webPushSubscriptions")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .collect(),
  );
}

describe("2.7-C web-push dispatcher — fires the Node route per active subscription", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.WEB_PUSH_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WEB_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WEB_PUSH_INTERNAL_HMAC_SECRET;
    delete process.env.WEB_PUSH_ROUTE_URL;
  });

  it("web_push send → HMAC-signed fetch to the route, row → sent", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-a"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    const { calls } = stubFetch({ body: { goneEndpoints: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Temps-réel trigger → wallet_push (no wallet enrolment) + web_push.
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    // Exactly one web-push fetch, to the configured route.
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(PUSH_URL);

    // The request carries the subscription + a valid internal-channel HMAC.
    const headers = calls[0].init.headers as Record<string, string>;
    const body = String(calls[0].init.body);
    const valid = await verifyInternalRequest({
      secret: SECRET,
      body,
      timestamp: headers["x-kb-timestamp"],
      signature: headers["x-kb-signature"],
    });
    expect(valid).toBe(true);
    const payload = JSON.parse(body) as {
      subscriptions: { endpoint: string; p256dh: string; auth: string }[];
    };
    expect(payload.subscriptions.map((s) => s.endpoint)).toEqual([
      "https://push.example/ep-a",
    ]);

    const rows = await eventsFor(t, customerId);
    const webRow = rows.find((r) => r.channel === "web_push");
    expect(webRow?.status).toBe("sent");
    expect(typeof webRow?.sentAt).toBe("number");
  });

  it("sends every active subscription of the (customer, tenant) couple in one fetch", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-1", "https://push.example/ep-2"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    const { calls } = stubFetch({ body: { goneEndpoints: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    expect(calls.length).toBe(1);
    const payload = JSON.parse(String(calls[0].init.body)) as {
      subscriptions: { endpoint: string }[];
    };
    expect(payload.subscriptions.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/ep-1",
      "https://push.example/ep-2",
    ]);
    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe("sent");
  });

  it("leaves wallet / email rows untouched — never dispatched here", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-a"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    stubFetch({ body: { goneEndpoints: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Archive trigger → wallet_push (skipped, not enrolled) + web_push + email.
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_paid",
    });
    await drainScheduled(t);

    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe("sent");
    // Email is a later slice — untouched.
    expect(rows.find((r) => r.channel === "email")?.status).toBe("queued");
  });

  it("no active subscription → row → inactive_endpoint, no fetch", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Enrolled per the fiche, but ZERO active subscriptions in the table.
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      [],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    const { calls } = stubFetch({ body: { goneEndpoints: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    expect(calls.length).toBe(0);
    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe(
      "inactive_endpoint",
    );
  });

  it("410 Gone on every endpoint → row → inactive_endpoint + subscriptions soft-deactivated", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-dead"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    // The route reports the only endpoint as 410 Gone.
    stubFetch({ body: { goneEndpoints: ["https://push.example/ep-dead"] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe(
      "inactive_endpoint",
    );
    // The dead endpoint was soft-flipped to inactive via the #128 seam.
    const subs = await subsFor(t, customerId);
    expect(subs[0].status).toBe("inactive");
  });

  it("partial 410 (one of two gone) → row → sent, only the gone endpoint deactivated", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-live", "https://push.example/ep-gone"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    stubFetch({ body: { goneEndpoints: ["https://push.example/ep-gone"] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    // At least one live endpoint received it ⇒ sent.
    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe("sent");
    // Only the gone endpoint is flipped inactive; the live one stays active.
    const subs = await subsFor(t, customerId);
    const live = subs.find(
      (s) => s.endpoint === "https://push.example/ep-live",
    );
    const gone = subs.find(
      (s) => s.endpoint === "https://push.example/ep-gone",
    );
    expect(live?.status).toBe("active");
    expect(gone?.status).toBe("inactive");
  });

  it("transport throws → row → failed (subscriptions untouched, no retry storm)", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-a"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    stubFetch({ throws: true });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe("failed");
    // A transient transport failure is NOT a dead endpoint — never deactivated.
    const subs = await subsFor(t, customerId);
    expect(subs[0].status).toBe("active");
  });

  it("non-OK route response → row → failed (no endpoint deactivation)", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-a"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    stubFetch({ ok: false, status: 503 });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe("failed");
    const subs = await subsFor(t, customerId);
    expect(subs[0].status).toBe("active");
  });
});

describe("2.7-C web-push dispatcher — MOAT + internal-only (ADR 0012)", () => {
  it("the dispatch action is internal-only (not re-exported by the barrel)", async () => {
    const barrel = (await import("./index")) as Record<string, unknown>;
    expect(barrel.dispatchWebPushSends).toBeUndefined();
  });

  it("the dispatch action returns an aggregate count — never a raw customer", async () => {
    vi.useFakeTimers();
    process.env.WEB_PUSH_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WEB_PUSH_ROUTE_URL = PUSH_URL;
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-a"],
    );
    const eventId = await t.run((ctx) =>
      ctx.db.insert("notificationEvents", {
        tenantId: seed.tenantA.tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "order_delivered",
        transactionalCategory: "temps_reel",
        channel: "web_push",
        status: "queued",
        createdAt: Date.now(),
      }),
    );
    stubFetch({ body: { goneEndpoints: [] } });

    const res = (await t.action(
      internal.lib.notifications.dispatch.dispatchWebPushSends,
      { tenantId: seed.tenantA.tenantId, eventIds: [eventId] },
    )) as Record<string, unknown>;
    expect(res).not.toHaveProperty("customer");
    expect(res).not.toHaveProperty("email");
    expect(res).not.toHaveProperty("phone");
    expect(res).not.toHaveProperty("subscriptions");
    expect(typeof res.dispatched).toBe("number");

    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WEB_PUSH_INTERNAL_HMAC_SECRET;
    delete process.env.WEB_PUSH_ROUTE_URL;
  });
});

describe("2.7-C web-push dispatcher — cross-tenant fuzz (ADR 0010)", () => {
  it("throws for every unauthorized actor replaying the entrypoint", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-a"],
    );
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.notify.notifyOrderEvent],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      extraArgs: { orderId, eventType: "order_delivered" },
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
    expect(pairs).toBe(5);
  });

  it("a web-push dispatch on a foreign tenant's event row throws NOT_FOUND", async () => {
    vi.useFakeTimers();
    process.env.WEB_PUSH_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WEB_PUSH_ROUTE_URL = PUSH_URL;
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-a"],
    );
    // The event belongs to tenant A.
    const eventId = await t.run((ctx) =>
      ctx.db.insert("notificationEvents", {
        tenantId: seed.tenantA.tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "order_delivered",
        transactionalCategory: "temps_reel",
        channel: "web_push",
        status: "queued",
        createdAt: Date.now(),
      }),
    );
    stubFetch({ body: { goneEndpoints: [] } });

    // Dispatching it UNDER tenant B must not touch tenant A's row.
    await expect(
      t.action(internal.lib.notifications.dispatch.dispatchWebPushSends, {
        tenantId: seed.tenantB.tenantId,
        eventIds: [eventId],
      }),
    ).rejects.toThrow(/NOT_FOUND/);

    const row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row?.status).toBe("queued");

    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WEB_PUSH_INTERNAL_HMAC_SECRET;
    delete process.env.WEB_PUSH_ROUTE_URL;
  });

  it("reads ONLY the dispatching tenant's active subscriptions (tenant-scoped seam)", async () => {
    vi.useFakeTimers();
    process.env.WEB_PUSH_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WEB_PUSH_ROUTE_URL = PUSH_URL;
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    // The SAME customer is web-push enrolled on BOTH tenants (different origins).
    const customerId = await seedWebPushCustomer(
      t,
      seed.tenantA.tenantId,
      "a@x.fr",
      ["https://push.example/ep-A"],
    );
    await t.run((ctx) =>
      ctx.db.insert("webPushSubscriptions", {
        customerId,
        tenantId: seed.tenantB.tenantId,
        endpoint: "https://push.example/ep-B",
        p256dh: "p256dh-B",
        auth: "auth-B",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const eventId = await t.run((ctx) =>
      ctx.db.insert("notificationEvents", {
        tenantId: seed.tenantA.tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "order_delivered",
        transactionalCategory: "temps_reel",
        channel: "web_push",
        status: "queued",
        createdAt: Date.now(),
      }),
    );
    const { calls } = stubFetch({ body: { goneEndpoints: [] } });

    await t.action(internal.lib.notifications.dispatch.dispatchWebPushSends, {
      tenantId: seed.tenantA.tenantId,
      eventIds: [eventId],
    });

    // Only tenant A's endpoint is sent — tenant B's subscription is never read.
    expect(calls.length).toBe(1);
    const payload = JSON.parse(String(calls[0].init.body)) as {
      subscriptions: { endpoint: string }[];
    };
    expect(payload.subscriptions.map((s) => s.endpoint)).toEqual([
      "https://push.example/ep-A",
    ]);

    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WEB_PUSH_INTERNAL_HMAC_SECRET;
    delete process.env.WEB_PUSH_ROUTE_URL;
  });
});
