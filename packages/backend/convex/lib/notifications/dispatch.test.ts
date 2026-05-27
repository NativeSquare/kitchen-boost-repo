import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { WALLET_PASS_TYPE_IDENTIFIER } from "../wallet/index";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * 2.7-F — the Wallet DISPATCHER (slice C, restricted to the Wallet channel),
 * written BEFORE the module (TDD red).
 *
 * The engine (#44) journals one `notificationEvents` row per effective channel as
 * `queued`; this slice is the GLUE that materialises the WALLET channels by calling
 * the existing transport `triggerUpdate` (#71, `internalAction(customerId, silent)`)
 * and reflecting the result back onto the journal row:
 *  - `wallet_push`   → `triggerUpdate(silent=false)` (lock-screen push).
 *  - `wallet_silent` → `triggerUpdate(silent=true)` (silent card update).
 *  - success           → `sent` (+`sentAt`).
 *  - transport error   → `failed`.
 *  - no active device / dead token (US 27) → `inactive_endpoint` (consistent with
 *    `reachabilityFeedback` #65, the existing 410/inactive feedback seam to 2.1).
 *  - `web_push` / `email` / `sms` are OUT OF SCOPE: their transports are later
 *    slices — the dispatcher NEVER touches them, their rows stay `queued`.
 *
 * Wiring (PRD 80 architecture): `notifyOrderEvent` is a `tenantMutation`; it cannot
 * call an `internalAction` directly, so it SCHEDULES the dispatch
 * (`ctx.scheduler.runAfter(0, …)`). The action calls `triggerUpdate` then patches
 * the journal row's status through a sanctioned `lib/tenancy` seam (never raw
 * `ctx.db`). All APNs HTTP is MOCKED at the `fetch` boundary (the Node route lives
 * in #71); the real APNs send is HITL (device e2e, off CI).
 *
 * Isolation (ADR 0010): the dispatch is keyed on a `tenantId` it received from the
 * mutation that resolved it; the journal row is read/patched through the
 * tenant-scoped seam (a foreign `eventId` → NOT_FOUND, no cross-tenant write); the
 * fuzz suite replays the public entrypoint (`notifyOrderEvent`) under unauthorized
 * actors. MOAT (ADR 0012): the customer is referenced strictly BY ID; `triggerUpdate`
 * is internal (system-side) and returns only an aggregate count.
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
const PUSH_URL = "https://admin.kitchen-boost.fr/api/wallet/push";

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
 * Seed a customer Wallet-enrolled (serial + pass + N active device tokens) so the
 * Wallet channels have an effective transport target.
 */
async function seedWalletCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
  serialNumber: string,
  pushTokens: string[],
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    const customerId = await ctx.db.insert("customers", {
      userId,
      email,
      phone: "+33600000000",
      pushEnrollment: {
        walletSerialNumber: serialNumber,
        walletStatus: "enrolled",
        webPushStatus: "enrolled",
      },
      createdAt: Date.now(),
    });
    await ctx.db.insert("walletPasses", {
      serialNumber,
      passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
      customerId,
      status: "installed",
      installedAt: Date.now(),
      createdAt: Date.now(),
    });
    for (const pushToken of pushTokens) {
      await ctx.db.insert("walletDeviceRegistrations", {
        serialNumber,
        passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
        deviceLibraryIdentifier: `dev-${pushToken}`,
        pushToken,
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

/** All journal rows for a tenant's customer. */
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

describe("2.7-F Wallet dispatcher — fires triggerUpdate per Wallet channel", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });

  it("wallet_push send → triggerUpdate(silent=false), row → sent", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-1", [
      "tok-a",
    ]);
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Temps-réel trigger → wallet_push + web_push.
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    // Exactly one Wallet fetch (the web_push row is NOT dispatched here).
    expect(calls.length).toBe(1);
    const payload = JSON.parse(String(calls[0].init.body)) as {
      silent: boolean;
    };
    expect(payload.silent).toBe(false); // wallet_push = lock-screen

    const rows = await eventsFor(t, customerId);
    const walletRow = rows.find((r) => r.channel === "wallet_push");
    expect(walletRow?.status).toBe("sent");
    expect(typeof walletRow?.sentAt).toBe("number");
  });

  it("wallet_silent send → triggerUpdate(silent=true), row → sent", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-2", [
      "tok-a",
    ]);
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Info statut trigger → wallet_silent only.
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_received_kitchen",
    });
    await drainScheduled(t);

    expect(calls.length).toBe(1);
    const payload = JSON.parse(String(calls[0].init.body)) as {
      silent: boolean;
    };
    expect(payload.silent).toBe(true); // wallet_silent = silent card update

    const rows = await eventsFor(t, customerId);
    const walletRow = rows.find((r) => r.channel === "wallet_silent");
    expect(walletRow?.status).toBe("sent");
    expect(typeof walletRow?.sentAt).toBe("number");
  });

  it("leaves email rows queued — the Wallet dispatcher never sends email", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Wallet-enrolled with a device, but NO web-push subscription rows. (The fiche's
    // webPushStatus is `enrolled`, so the engine still routes a web_push send; with
    // no active subscription the web-push dispatcher #54 marks it inactive_endpoint.)
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-3", [
      "tok-a",
    ]);
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Archive trigger → wallet_push + web_push + email.
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_paid",
    });
    await drainScheduled(t);

    // Only the wallet_push channel hit the transport (one fetch); web_push had no
    // active subscription so the web-push dispatcher made no fetch.
    expect(calls.length).toBe(1);

    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "wallet_push")?.status).toBe("sent");
    // web_push is now owned by the #54 dispatcher (no active subscription here →
    // inactive_endpoint); email's transport is still a later slice (stays queued).
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe(
      "inactive_endpoint",
    );
    expect(rows.find((r) => r.channel === "email")?.status).toBe("queued");
  });

  it("no active device → row → inactive_endpoint, no double-send", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Wallet-enrolled (serial) but ZERO active device tokens.
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-4", []);
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    expect(calls.length).toBe(0); // nothing to push (US 27)
    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "wallet_push")?.status).toBe(
      "inactive_endpoint",
    );
  });

  it("all device tokens dead (410) → row → inactive_endpoint", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-5", [
      "tok-dead",
    ]);
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    // The Node route reports the only token as Unregistered / BadDeviceToken.
    stubFetch({ body: { inactiveTokens: ["tok-dead"] } });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "wallet_push")?.status).toBe(
      "inactive_endpoint",
    );
  });

  it("transport throws → row → failed (never sent, never queued)", async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-6", [
      "tok-a",
    ]);
    const orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
    stubFetch({ throws: true }); // the Node route is unreachable

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "order_delivered",
    });
    await drainScheduled(t);

    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "wallet_push")?.status).toBe(
      "failed",
    );
  });
});

describe("2.7-F Wallet dispatcher — MOAT + internal-only (ADR 0012)", () => {
  it("the dispatch action is internal-only (not re-exported by the barrel)", async () => {
    const barrel = (await import("./index")) as Record<string, unknown>;
    expect(barrel.dispatchWalletSends).toBeUndefined();
  });

  it("the dispatch action returns an aggregate count — never a raw customer", async () => {
    vi.useFakeTimers();
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-moat", [
      "tok-a",
    ]);
    const eventId = await t.run((ctx) =>
      ctx.db.insert("notificationEvents", {
        tenantId: seed.tenantA.tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "order_delivered",
        transactionalCategory: "temps_reel",
        channel: "wallet_push",
        status: "queued",
        createdAt: Date.now(),
      }),
    );
    stubFetch({ body: { inactiveTokens: [] } });

    const res = (await t.action(
      internal.lib.notifications.dispatch.dispatchWalletSends,
      { tenantId: seed.tenantA.tenantId, eventIds: [eventId] },
    )) as Record<string, unknown>;
    expect(res).not.toHaveProperty("customer");
    expect(res).not.toHaveProperty("email");
    expect(res).not.toHaveProperty("phone");
    expect(typeof res.dispatched).toBe("number");

    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });
});

describe("2.7-F Wallet dispatcher — cross-tenant fuzz (ADR 0010)", () => {
  it("throws for every unauthorized actor replaying the entrypoint", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-fuzz", [
      "tok-a",
    ]);
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

  it("a dispatch patch on a foreign tenant's event row throws NOT_FOUND", async () => {
    vi.useFakeTimers();
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedWalletCustomer(t, "a@x.fr", "kb-disp-xt", [
      "tok-a",
    ]);
    // The event belongs to tenant A.
    const eventId = await t.run((ctx) =>
      ctx.db.insert("notificationEvents", {
        tenantId: seed.tenantA.tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "order_delivered",
        transactionalCategory: "temps_reel",
        channel: "wallet_push",
        status: "queued",
        createdAt: Date.now(),
      }),
    );
    stubFetch({ body: { inactiveTokens: [] } });

    // Dispatching it UNDER tenant B must not be able to touch tenant A's row.
    await expect(
      t.action(internal.lib.notifications.dispatch.dispatchWalletSends, {
        tenantId: seed.tenantB.tenantId,
        eventIds: [eventId],
      }),
    ).rejects.toThrow(/NOT_FOUND/);

    // Tenant A's row is left untouched (still queued — no cross-tenant write).
    const row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row?.status).toBe("queued");

    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });
});
