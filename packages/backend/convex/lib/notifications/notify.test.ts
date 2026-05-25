import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * 2.7-B — the SEMANTIC event API `notifyOrderEvent(orderId, eventType)`, written
 * BEFORE the module (TDD red). Callers (Orders / Delivery, KB Admin) pass a
 * BUSINESS event + an order id; they NEVER pass a channel — the engine decides
 * the category + channels (PRD 80 architecture: routing hardcoded V1).
 *
 * Isolation (ADR 0010): the function goes through `tenantMutation` keyed on
 * `ctx.tenantId`; it reaches `orders` + `customers` + `notificationEvents` ONLY
 * through the sanctioned `lib/tenancy` seam — never raw `ctx.db` in the business
 * module — and the per-trigger reachability is READ from 2.1's
 * `pushEnrollment` (ADR 0012), never duplicated here. Ships the cross-tenant fuzz
 * suite below replaying the function under unauthorized actors.
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
// Normalise every glob key to the `../../`-from-this-file form convex-test expects
// (the test lives in convex/lib/notifications/): a same-dir `./X` → this module,
// a sibling-lib `../<dir>/X` → `../../lib/<dir>/X`, and `../../X` is already root.
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

/** Place a (delivery) order for a tenant's customer; returns its id. */
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

describe("2.7-B notifyOrderEvent — semantic event API, channel chosen by engine", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderA: Id<"orders">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedReachableCustomer(t, "eater-a@x.fr");
    orderA = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerA,
    );
  });

  it("journals an Archive trigger as wallet_push + web_push + email, no channel passed in", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const planned = await asManager.mutation(
      api.lib.notifications.notify.notifyOrderEvent,
      {
        tenantId: seed.tenantA.tenantId,
        orderId: orderA,
        eventType: "order_paid",
      },
    );
    expect(planned.map((p: { channel: string }) => p.channel)).toEqual([
      "wallet_push",
      "web_push",
      "email",
    ]);

    // It wrote a notificationEvents row per sent channel, tenant + customer scoped.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect(),
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === "transactional")).toBe(true);
    expect(rows.every((r) => r.transactionalTrigger === "order_paid")).toBe(
      true,
    );
    expect(rows.every((r) => r.transactionalCategory === "archive")).toBe(true);
    expect(rows.every((r) => r.customerId === customerA)).toBe(true);
  });

  it("journals a Temps-réel trigger as wallet_push + web_push (no email)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const planned = await asManager.mutation(
      api.lib.notifications.notify.notifyOrderEvent,
      {
        tenantId: seed.tenantA.tenantId,
        orderId: orderA,
        eventType: "order_delivered",
      },
    );
    expect(planned.map((p: { channel: string }) => p.channel)).toEqual([
      "wallet_push",
      "web_push",
    ]);
  });

  it("journals an Info statut trigger as a single silent Wallet update", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const planned = await asManager.mutation(
      api.lib.notifications.notify.notifyOrderEvent,
      {
        tenantId: seed.tenantA.tenantId,
        orderId: orderA,
        eventType: "order_received_kitchen",
      },
    );
    expect(planned.map((p: { channel: string }) => p.channel)).toEqual([
      "wallet_silent",
    ]);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_customer", (q) => q.eq("customerId", customerA))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].transactionalCategory).toBe("info_statut");
    expect(rows[0].channel).toBe("wallet_silent");
  });

  it("marks the SMS extreme-fallback send as queued+not-sent (no provider V1)", async () => {
    // A customer with neither wallet nor web-push, but a phone (SMS fallback path).
    const noPushCustomer = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "nopush@x.fr",
        role: "customer",
      });
      return ctx.db.insert("customers", {
        userId,
        email: "nopush@x.fr",
        phone: "+33611111111",
        createdAt: Date.now(),
      });
    });
    const order2 = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      noPushCustomer,
    );
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const planned = await asManager.mutation(
      api.lib.notifications.notify.notifyOrderEvent,
      {
        tenantId: seed.tenantA.tenantId,
        orderId: order2,
        eventType: "order_paid",
      },
    );
    const sms = planned.find((p: { channel: string }) => p.channel === "sms");
    expect(sms).toBeDefined();
    // The journal row for SMS is queued (planned) but not sent (no provider V1).
    const rows = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_customer", (q) => q.eq("customerId", noPushCustomer))
        .collect(),
    );
    const smsRow = rows.find((r) => r.channel === "sms");
    expect(smsRow?.status).toBe("queued");
    expect(smsRow?.sentAt).toBeUndefined();
  });

  it("cannot notify on an order belonging to another tenant (ownership re-check)", async () => {
    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    // orderA belongs to tenant A; manager A passing tenant B is forbidden by the
    // wrapper, and even resolving the order under B throws NOT_FOUND.
    await expect(
      asManagerA.mutation(api.lib.notifications.notify.notifyOrderEvent, {
        tenantId: seed.tenantB.tenantId,
        orderId: orderA,
        eventType: "order_paid",
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});

describe("2.7-B notifyOrderEvent — cross-tenant fuzz (ADR 0010)", () => {
  it("throws for every unauthorized actor replaying the function", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const customerA = await seedReachableCustomer(t, "eater-a@x.fr");
    const orderA = await placeOrder(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      customerA,
    );

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.notify.notifyOrderEvent],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      extraArgs: { orderId: orderA, eventType: "order_paid" },
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
