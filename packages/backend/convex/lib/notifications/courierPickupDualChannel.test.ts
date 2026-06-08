import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { WALLET_PASS_TYPE_IDENTIFIER } from "../wallet/index";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * 2.7-fix (#107) — REGRESSION lock for trigger #3 (`courier_pickup`, "course pickup /
 * en route", Uber `pickup_complete`). The moteur story #44 collapsed this hybrid
 * trigger into the "Wallet update silencieux uniquement" bucket alongside trigger #2,
 * DROPPING its Web Push branch. Per PRD 80 §1 trigger #3 is the "Info statut →
 * Temps-réel léger" case whose V1 channels are BOTH a silent Wallet update AND a light
 * Web Push.
 *
 * The pure routing (`categories`) + engine (`engine`) already assert the channel SET
 * for trigger #3. This file locks the FULL pipeline end-to-end — the regression #44
 * introduced was at the WIRING level (the web_push branch was lost), so the regression
 * test exercises the wiring: `notifyOrderEvent("courier_pickup")` must journal BOTH a
 * `wallet_silent` AND a `web_push` row (category `info_statut`) AND drive BOTH the
 * Wallet dispatcher (#126, `triggerUpdate(silent=true)`) AND the web-push dispatcher
 * (#54, the Node VAPID route) — neither channel may be silently dropped again.
 *
 * Both transports are MOCKED at the `fetch` boundary (the Wallet APNs route #71 and
 * the web-push Node route #54 are HITL, off CI); the two routes are distinguished by
 * their configured URL. Isolation (ADR 0010): the public entrypoint `notifyOrderEvent`
 * is a `tenantMutation`; the cross-tenant fuzz below replays it under unauthorized
 * actors with the `courier_pickup` event so the existing fuzz harness stays green for
 * the corrected trigger. MOAT (ADR 0012): the customer is referenced strictly BY ID.
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
// Same glob-key normalisation the sibling notifications tests use (this test lives in
// convex/lib/notifications/): `./X` → this lib, `../<dir>/X` → `../../lib/<dir>/X`.
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

const WALLET_SECRET = "kb-wallet-internal-secret";
const WALLET_PUSH_URL = "https://admin.kitchen-boost.com/api/wallet/push";
const WEB_PUSH_SECRET = "kb-webpush-internal-secret";
const WEB_PUSH_URL = "https://buns.kitchen-boost.com/api/push/send";

/**
 * A single `fetch` stub that serves BOTH transports (the Wallet APNs route and the
 * web-push Node route), records every call, and answers a benign success body. The
 * caller distinguishes the two routes by their URL.
 */
function stubBothTransports(): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      // Both routes report "nothing gone / inactive" so the journal lands on `sent`.
      return new Response(
        JSON.stringify({ inactiveTokens: [], goneEndpoints: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
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
 * Seed a customer enrolled on BOTH transports: a Wallet pass + an active device token
 * (so `triggerUpdate` has a target) AND an active web-push subscription for the tenant
 * (so the web-push dispatcher has an endpoint). This is the only enrolment under which
 * trigger #3's two channels can both fire — the regression case.
 */
async function seedDualEnrolledCustomer(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  email: string,
  serialNumber: string,
  pushToken: string,
  webPushEndpoint: string,
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
    await ctx.db.insert("walletDeviceRegistrations", {
      serialNumber,
      passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
      deviceLibraryIdentifier: `dev-${pushToken}`,
      pushToken,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("webPushSubscriptions", {
      customerId,
      tenantId,
      endpoint: webPushEndpoint,
      p256dh: `p256dh-${webPushEndpoint}`,
      auth: `auth-${webPushEndpoint}`,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
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

describe("2.7-fix #107 — trigger #3 courier_pickup = Wallet silent + Web Push", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  let orderId: Id<"orders">;

  beforeEach(async () => {
    vi.useFakeTimers();
    process.env.WALLET_INTERNAL_HMAC_SECRET = WALLET_SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = WALLET_PUSH_URL;
    process.env.WEB_PUSH_INTERNAL_HMAC_SECRET = WEB_PUSH_SECRET;
    process.env.WEB_PUSH_ROUTE_URL = WEB_PUSH_URL;

    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerId = await seedDualEnrolledCustomer(
      t,
      seed.tenantA.tenantId,
      "eater-a@x.fr",
      "kb-107-1",
      "tok-a",
      "https://push.example/ep-a",
    );
    orderId = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerId,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
    delete process.env.WEB_PUSH_INTERNAL_HMAC_SECRET;
    delete process.env.WEB_PUSH_ROUTE_URL;
  });

  it("plans BOTH wallet_silent AND web_push, category Info statut (not silent-only)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const planned = await asManager.mutation(
      api.lib.notifications.notify.notifyOrderEvent,
      {
        tenantId: seed.tenantA.tenantId,
        orderId,
        eventType: "courier_pickup",
      },
    );

    // The web_push branch #44 dropped is back: BOTH channels are planned, in order.
    expect(planned.map((p: { channel: string }) => p.channel)).toEqual([
      "wallet_silent",
      "web_push",
    ]);
    // Still the closed 3-category set — trigger #3 stays Info statut (no 4th category).
    expect(
      planned.every((p: { category: string }) => p.category === "info_statut"),
    ).toBe(true);
  });

  it("journals exactly a wallet_silent row and a web_push row (Info statut)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "courier_pickup",
    });

    const rows = await eventsFor(t, customerId);
    const channels = rows.map((r) => r.channel).sort();
    expect(channels).toEqual(["wallet_silent", "web_push"]);
    expect(rows.every((r) => r.transactionalTrigger === "courier_pickup")).toBe(
      true,
    );
    expect(rows.every((r) => r.transactionalCategory === "info_statut")).toBe(
      true,
    );
  });

  it("drives BOTH transports end-to-end: silent Wallet update AND a Web Push", async () => {
    const { calls } = stubBothTransports();

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.notifications.notify.notifyOrderEvent, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      eventType: "courier_pickup",
    });
    await drainScheduled(t);

    // BOTH dispatchers fired: one Wallet route call + one web-push route call.
    const walletCalls = calls.filter((c) => c.url === WALLET_PUSH_URL);
    const webPushCalls = calls.filter((c) => c.url === WEB_PUSH_URL);
    expect(walletCalls.length).toBe(1);
    expect(webPushCalls.length).toBe(1);

    // The Wallet pass was updated SILENTLY (Info statut), not a lock-screen push.
    const walletBody = JSON.parse(String(walletCalls[0].init.body)) as {
      silent: boolean;
    };
    expect(walletBody.silent).toBe(true);

    // Both journal rows reflect the successful dispatch.
    const rows = await eventsFor(t, customerId);
    expect(rows.find((r) => r.channel === "wallet_silent")?.status).toBe(
      "sent",
    );
    expect(rows.find((r) => r.channel === "web_push")?.status).toBe("sent");
  });
});

describe("2.7-fix #107 — courier_pickup cross-tenant fuzz (ADR 0010)", () => {
  it("throws for every unauthorized actor replaying the corrected trigger", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerId = await seedDualEnrolledCustomer(
      t,
      seed.tenantA.tenantId,
      "eater-a@x.fr",
      "kb-107-fuzz",
      "tok-fuzz",
      "https://push.example/ep-fuzz",
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
      extraArgs: { orderId, eventType: "courier_pickup" },
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
});
