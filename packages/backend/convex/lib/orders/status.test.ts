import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { acceptsOrders, isPauseActive } from "./status";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/orders/, so Vite keys same-dir matches as "./x"; normalise every key
// to be relative to the convex root (../../). Same shape as orders.test.ts.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/orders/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.3-F — operational status `acceptsOrderNow` (service hours 2.2 + transient
 * pause) gates the checkout (PRD 10 §4/§7/edge "resto fermé / pause", PRD 20 §7,
 * client-ordering CONTEXT, ADR 0010), written BEFORE the implementation (TDD red).
 *
 * `acceptsOrderNow` COMBINES the merged 2.2-E open/closed decision
 * (`isWithinServiceHours`, REUSED — not reimplemented here) AND the transient
 * `operationalPause` (the 2.3-A field on `tenants`): a resto accepts an order now
 * iff it is WITHIN a service window AND not currently paused. The combination is a
 * PURE function (open + pause + clock → boolean), so the time-sensitive cases
 * (pause not-yet-expired vs expired) are tested deterministically on INJECTED
 * timestamps, never the real wall-clock. The Convex surface only wires the
 * tenant's persisted windows + pause + `Date.now()` into that pure function.
 *
 * Auto-reprise: the pause expiry is DERIVED from `until` (no cron) — once
 * `until <= now`, the resto accepts orders again with no manual `clearPause`.
 */

const HOUR = 60 * 60 * 1000;

describe("2.3-F isPauseActive — pure (pause + clock → boolean), auto-expiry from `until`", () => {
  it("is INACTIVE when there is no pause", () => {
    expect(isPauseActive(null, 1_000)).toBe(false);
  });

  it("is ACTIVE while `until` is still in the future", () => {
    expect(isPauseActive({ until: 2_000 }, 1_000)).toBe(true);
  });

  it("is INACTIVE once `until` has passed (auto-reprise, no manual clear)", () => {
    expect(isPauseActive({ until: 1_000 }, 2_000)).toBe(false);
  });

  it("treats `until` as EXCLUSIVE — at exactly `until` the pause is over", () => {
    expect(isPauseActive({ until: 1_000 }, 1_000)).toBe(false);
  });
});

describe("2.3-F acceptsOrders — pure combine of service hours + pause", () => {
  const now = 10_000;

  it("ACCEPTS when open AND not paused", () => {
    expect(acceptsOrders({ isOpen: true, pause: null, nowMs: now })).toBe(true);
  });

  it("REFUSES when closed (out of service hours), even without a pause", () => {
    expect(acceptsOrders({ isOpen: false, pause: null, nowMs: now })).toBe(
      false,
    );
  });

  it("REFUSES when open but currently paused", () => {
    expect(
      acceptsOrders({ isOpen: true, pause: { until: now + HOUR }, nowMs: now }),
    ).toBe(false);
  });

  it("ACCEPTS when open and the pause has already expired (auto-reprise)", () => {
    expect(
      acceptsOrders({ isOpen: true, pause: { until: now - 1 }, nowMs: now }),
    ).toBe(true);
  });

  it("REFUSES when both closed AND paused", () => {
    expect(
      acceptsOrders({
        isOpen: false,
        pause: { until: now + HOUR },
        nowMs: now,
      }),
    ).toBe(false);
  });
});

// --- Convex surface: acceptsOrderNow (PUBLIC) + the checkout gate ------------

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** An all-week, always-open schedule so the hours half of the gate is OPEN. */
const ALWAYS_OPEN = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  startMinute: 0,
  endMinute: 1439,
}));

/** Seed an anonymous customer (the shape the Anonymous provider produces). */
async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

/** Seed one available item on a tenant via the 2.2 CRUD (no hand-poked rows). */
async function seedItem(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  managerId: Id<"users">,
): Promise<Id<"menuItems">> {
  const as = t.withIdentity({ subject: managerId });
  const categoryId = (await as.mutation(api.lib.menu.categories.create, {
    tenantId,
    name: "Plats",
  })) as Id<"menuCategories">;
  return (await as.mutation(api.lib.menu.items.create, {
    tenantId,
    categoryId,
    name: "Frites",
    description: "",
    basePrice: 390,
    allergens: [],
  })) as Id<"menuItems">;
}

describe("2.3-F acceptsOrderNow — PUBLIC gate read (publicTenantQuery)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("is accessible WITHOUT authentication and returns a boolean", async () => {
    const accepts = await t.query(api.lib.orders.status.acceptsOrderNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(typeof accepts).toBe("boolean");
  });

  it("REFUSES when the tenant has no service hours configured (closed)", async () => {
    const accepts = await t.query(api.lib.orders.status.acceptsOrderNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(accepts).toBe(false);
  });

  it("ACCEPTS when open (all-week hours) and not paused", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: ALWAYS_OPEN,
      });
    const accepts = await t.query(api.lib.orders.status.acceptsOrderNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(accepts).toBe(true);
  });

  it("REFUSES when open but currently paused", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await asMgr.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: ALWAYS_OPEN,
    });
    await asMgr.mutation(api.lib.orders.orders.setOperationalPause, {
      tenantId: seed.tenantA.tenantId,
      until: Date.now() + HOUR,
    });
    const accepts = await t.query(api.lib.orders.status.acceptsOrderNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(accepts).toBe(false);
  });

  it("ACCEPTS again once the pause has expired, with NO manual clear (auto-reprise)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await asMgr.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: ALWAYS_OPEN,
    });
    // A pause whose ETA is already in the PAST — derived expiry, no cron.
    await asMgr.mutation(api.lib.orders.orders.setOperationalPause, {
      tenantId: seed.tenantA.tenantId,
      until: Date.now() - 1,
    });
    const accepts = await t.query(api.lib.orders.status.acceptsOrderNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(accepts).toBe(true);
  });

  it("throws for an unknown tenantId (public wrapper)", async () => {
    const danglingId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost",
        name: "Ghost",
        siret: "ghost",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      t.query(api.lib.orders.status.acceptsOrderNow, { tenantId: danglingId }),
    ).rejects.toThrow(/forbidden|not found/i);
  });
});

describe("2.3-F checkout gate — createOrderFromCart refuses when !acceptsOrderNow", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemId: Id<"menuItems">;
  let eater: Id<"users">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    itemId = await seedItem(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    eater = await seedAnonymousCustomer(t);
  });

  const order = (tenantId: Id<"tenants">) => ({
    tenantId,
    mode: "pickup" as const,
    items: [{ itemId, quantity: 1, modifierSelections: [] }],
  });

  it("REFUSES checkout when the resto is closed (no service hours)", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(
        api.lib.cart.cart.createOrderFromCart,
        order(seed.tenantA.tenantId),
      ),
    ).rejects.toThrow(/fermé|closed|pause|accept/i);
  });

  it("REFUSES checkout when the resto is open but paused", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await asMgr.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: ALWAYS_OPEN,
    });
    await asMgr.mutation(api.lib.orders.orders.setOperationalPause, {
      tenantId: seed.tenantA.tenantId,
      until: Date.now() + HOUR,
    });
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(
        api.lib.cart.cart.createOrderFromCart,
        order(seed.tenantA.tenantId),
      ),
    ).rejects.toThrow(/fermé|closed|pause|accept/i);
  });

  it("ALLOWS checkout when open and not paused", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: ALWAYS_OPEN,
      });
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(
      api.lib.cart.cart.createOrderFromCart,
      order(seed.tenantA.tenantId),
    );
    expect(orderId).toBeTypeOf("string");
  });

  it("ALLOWS checkout once a pause has auto-expired (open + expired pause)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await asMgr.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: ALWAYS_OPEN,
    });
    await asMgr.mutation(api.lib.orders.orders.setOperationalPause, {
      tenantId: seed.tenantA.tenantId,
      until: Date.now() - 1,
    });
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(
      api.lib.cart.cart.createOrderFromCart,
      order(seed.tenantA.tenantId),
    );
    expect(orderId).toBeTypeOf("string");
  });
});

describe("2.3-F cross-tenant — A's hours/pause never gate B (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemA: Id<"menuItems">;
  let itemB: Id<"menuItems">;
  let eater: Id<"users">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    itemA = await seedItem(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    itemB = await seedItem(t, seed.tenantB.tenantId, seed.tenantB.managerId);
    eater = await seedAnonymousCustomer(t);
  });

  it("acceptsOrderNow(A) reflects A's status only, never B's (open A, closed B)", async () => {
    // A is open all week; B has no hours (closed). They must not bleed.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: ALWAYS_OPEN,
      });
    expect(
      await t.query(api.lib.orders.status.acceptsOrderNow, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).toBe(true);
    expect(
      await t.query(api.lib.orders.status.acceptsOrderNow, {
        tenantId: seed.tenantB.tenantId,
      }),
    ).toBe(false);
  });

  it("pausing A does NOT gate B (B stays acceptable while A is paused)", async () => {
    // Both open all week.
    for (const ten of [seed.tenantA, seed.tenantB]) {
      await t
        .withIdentity({ subject: ten.managerId })
        .mutation(api.lib.menu.serviceHours.set, {
          tenantId: ten.tenantId,
          windows: ALWAYS_OPEN,
        });
    }
    // Pause ONLY A.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.orders.orders.setOperationalPause, {
        tenantId: seed.tenantA.tenantId,
        until: Date.now() + HOUR,
      });
    // A refused, B still accepted.
    expect(
      await t.query(api.lib.orders.status.acceptsOrderNow, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).toBe(false);
    expect(
      await t.query(api.lib.orders.status.acceptsOrderNow, {
        tenantId: seed.tenantB.tenantId,
      }),
    ).toBe(true);
    // And a B checkout still goes through while A is paused.
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(api.lib.cart.cart.createOrderFromCart, {
      tenantId: seed.tenantB.tenantId,
      mode: "pickup",
      items: [{ itemId: itemB, quantity: 1, modifierSelections: [] }],
    });
    expect(orderId).toBeTypeOf("string");
    // A's checkout is refused at the same instant (sanity: itemA referenced).
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [{ itemId: itemA, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow(/fermé|closed|pause|accept/i);
  });
});

describe("2.3-F cross-tenant fuzz — the checkout gate never lets an unauthorized actor in", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemId: Id<"menuItems">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    itemId = await seedItem(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    // Open A so the gate would otherwise PASS — the only refusal left is the actor.
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: ALWAYS_OPEN,
      });
  });

  // The gate is wired INTO createOrderFromCart (a customerMutation, self-scope). A
  // PRO root + an anonymous caller must still be refused by the checkout surface
  // even though A is OPEN — the gate is additive, it never relaxes the actor guard.
  it("the global root (kb_admin) + an anonymous caller are rejected even when A is open", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.cart.cart.createOrderFromCart],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {
        mode: "pickup",
        items: [{ itemId, quantity: 1, modifierSelections: [] }],
      },
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});
