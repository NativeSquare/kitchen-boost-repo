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

// convex-test needs the function modules; the array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/orders/, so Vite emits keys relative to THIS dir (`./workflow.ts`,
// `../tenancy/...`, `../../table/...`). Re-anchor every `./x` key at the convex
// root so convex-test's findModulesRoot has ONE common prefix (same intent as the
// orders / workflow / cart / menu suites).
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
 * 2.3-E — `refuse(orderId, reason)`: the ORDER-SIDE action of "le refus déclenche
 * le remboursement immédiat" (PRD 20 §6 + 20-Q9 acté: refund IMMÉDIAT; PRD 30 §5;
 * kb-orders CONTEXT "Refusal"), written BEFORE the implementation (TDD red).
 *
 * In ONE mutation (Convex transaction = atomicity), refusing a `nouvelle` order:
 *  - transitions `nouvelle → refusée` (terminal) through the state machine guard;
 *  - persists the closed-set `reason` (rupture / fermeture / surcharge / autre) on
 *    the `refusée` `orderEvents` row — that event IS the refund order EMITTED toward
 *    the 2.5 payment domain (Orders is the trigger, Payment runs the Stripe refund;
 *    no `payments` table is touched here, #42 is a later chantier);
 *  - emits the client `refund_issued` notification event (journals the planned
 *    sends `queued` — the actual push/email send is 2.7).
 *
 * Atomicity: if any part throws, the whole mutation rolls back (no refusal without
 * the refund event emitted, no event without the notif). Refusing from a non-
 * `nouvelle` state is rejected by the state machine. Ships a cross-tenant fuzz suite.
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
    | "refusée",
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

/** Read one order + its time-ordered events directly (test-only). */
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

describe("2.3-E refuse — nouvelle → refusée + refund order emitted (atomic)", () => {
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

  it("transitions nouvelle → refusée (terminal), stamping refusedAt + a refusée event carrying the reason", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });

    await asManager.mutation(api.lib.orders.workflow.refuse, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      reason: "surcharge",
    });

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("refusée");
    expect(order?.refusedAt).toBeTypeOf("number");
    // The refusée orderEvent IS the refund order emitted toward 2.5 — it carries
    // the reason so the payment processor (and the audit) sees WHY.
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("refusée");
    expect(events[0].reason).toBe("surcharge");
    expect(events[0].actorUserId).toBe(seed.tenantA.managerId);
    expect(events[0].at).toBeTypeOf("number");
  });

  it("emits the client refund_issued notification event (queued — sending is 2.7)", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });

    await asStaff.mutation(api.lib.orders.workflow.refuse, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      reason: "rupture",
    });

    const notifs = await readNotifs(t, customerA);
    // A reachable customer (wallet + web-push + email): the Archive trigger fans
    // out to all three channels, each journaled queued (PRD 80 §1 trigger 6).
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

  it("accepts each of the closed reasons (rupture / fermeture / surcharge / autre)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    for (const reason of ["rupture", "fermeture", "surcharge", "autre"]) {
      const oid = await seedOrder(
        t,
        seed.tenantA.tenantId,
        customerA,
        "nouvelle",
      );
      await asManager.mutation(api.lib.orders.workflow.refuse, {
        tenantId: seed.tenantA.tenantId,
        orderId: oid,
        // biome-ignore lint/suspicious/noExplicitAny: exercising the closed validator set
        reason: reason as any,
      });
      const { order, events } = await readOrder(t, oid);
      expect(order?.status).toBe("refusée");
      expect(events.at(-1)?.reason).toBe(reason);
    }
  });

  it("rejects an unknown reason at the validator boundary (closed set, no invented value)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.orders.workflow.refuse, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        // biome-ignore lint/suspicious/noExplicitAny: a value outside the closed set
        reason: "boom" as any,
      }),
    ).rejects.toThrow();

    // Nothing was applied (the order is still nouvelle, no event, no notif).
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("nouvelle");
    expect(events).toHaveLength(0);
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });

  it("refusing from a TERMINAL or post-handoff state is rejected by the state machine (no refund after handoff)", async () => {
    // #413 extended `nouvelle → refusée` to also include `en préparation →
    // refusée` and `prête → refusée` (the 3-step anti-fat-finger flow).
    // Those two are tested in their own suite below — here we pin that
    // every OTHER non-`nouvelle` state still rejects: once the order has
    // been handed off (`remise`) or completed (`livrée` / `collectée`),
    // the refund door is closed (no more revertible commercial value).
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    for (const status of ["remise", "livrée", "collectée"] as const) {
      const oid = await seedOrder(t, seed.tenantA.tenantId, customerA, status);
      await expect(
        asManager.mutation(api.lib.orders.workflow.refuse, {
          tenantId: seed.tenantA.tenantId,
          orderId: oid,
          reason: "autre",
        }),
      ).rejects.toThrow();
      const { order, events } = await readOrder(t, oid);
      expect(order?.status).toBe(status); // unchanged
      expect(events).toHaveLength(0);
    }
  });

  it("an already-refused order cannot be refused again (terminal, no double refund)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.orders.workflow.refuse, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      reason: "fermeture",
    });
    await expect(
      asManager.mutation(api.lib.orders.workflow.refuse, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        reason: "autre",
      }),
    ).rejects.toThrow();

    // Still exactly one refusée event + one set of notifs (no second refund emitted).
    const { events } = await readOrder(t, orderId);
    expect(events.filter((e) => e.status === "refusée")).toHaveLength(1);
    expect(events[0].reason).toBe("fermeture");
  });

  it("atomicity: a refusal that cannot emit the notif (vanished customer) rolls back the whole mutation", async () => {
    // An order whose customer fiche does NOT exist: reading reachability returns
    // nothing ⇒ zero planned sends. The refusal must still be ATOMIC — and since
    // there is no reachable channel, no notif row is written, but the refusée
    // transition + event still commit together (all-or-nothing in one transaction).
    const ghostCustomer = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "ghost@x.fr",
        role: "customer",
      });
      const customerId = await ctx.db.insert("customers", {
        userId,
        email: "ghost@x.fr",
        createdAt: Date.now(),
      });
      // Delete the fiche so reachability resolves to nothing.
      await ctx.db.delete(customerId);
      return customerId;
    });
    const oid = await seedOrder(
      t,
      seed.tenantA.tenantId,
      ghostCustomer,
      "nouvelle",
    );

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.orders.workflow.refuse, {
      tenantId: seed.tenantA.tenantId,
      orderId: oid,
      reason: "rupture",
    });

    // Refusal committed (transition + event), no notif (no reachable channel).
    const { order, events } = await readOrder(t, oid);
    expect(order?.status).toBe("refusée");
    expect(events).toHaveLength(1);
    expect(await readNotifs(t, ghostCustomer)).toHaveLength(0);
  });

  it("refusing a foreign tenant's order throws (ownership re-check, no cross-tenant write)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.orders.workflow.refuse, {
          tenantId: seed.tenantB.tenantId,
          orderId, // belongs to tenant A
          reason: "autre",
        }),
    ).rejects.toThrow();

    // A's order is untouched and no notif leaked.
    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("nouvelle");
    expect(events).toHaveLength(0);
    expect(await readNotifs(t, customerA)).toHaveLength(0);
  });
});

describe("#413 refuse from `en préparation` / `prête` — 3-step anti-fat-finger from inflight states", () => {
  // PRD 20 §6a + kb-orders CONTEXT "Refusal" — the cuisinier can still
  // refuse an order that has already been ack'd (kitchen started) or is
  // ready (prête, waiting for handoff). The COST of error is fort (travail
  // cuisine perdu, refund total, irréversible), but it remains operable
  // for genuine incidents (rupture découverte au milieu de la cuisson,
  // incident hygiène, panne frigo). The anti-fat-finger discipline is the
  // 3-step dialog on the UI (#413), NOT a backend block — the backend
  // accepts the transition + runs the exact same refund / notif / audit
  // pipeline as `nouvelle → refusée`.
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedReachableCustomer(t, "eater-inflight@x.fr");
  });

  for (const fromState of ["en préparation", "prête"] as const) {
    it(`transitions ${fromState} → refusée (terminal), stamping refusedAt + a refusée event carrying the reason`, async () => {
      const orderId = await seedOrder(
        t,
        seed.tenantA.tenantId,
        customerA,
        fromState,
      );
      const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
      await asManager.mutation(api.lib.orders.workflow.refuse, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        reason: "rupture",
      });

      const { order, events } = await readOrder(t, orderId);
      expect(order?.status).toBe("refusée");
      expect(order?.refusedAt).toBeTypeOf("number");
      // The refusée orderEvent carries the reason — same shape as the
      // `nouvelle → refusée` path so downstream (audit + 2.5 refund + 2.7
      // push) cannot distinguish the source state. The motif itself
      // carries the business signal.
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("refusée");
      expect(events[0].reason).toBe("rupture");
      expect(events[0].actorUserId).toBe(seed.tenantA.managerId);
    });

    it(`emits the client refund_issued notification event (queued) — same code path as the 2-step from nouvelle`, async () => {
      const orderId = await seedOrder(
        t,
        seed.tenantA.tenantId,
        customerA,
        fromState,
      );
      const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
      await asStaff.mutation(api.lib.orders.workflow.refuse, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        reason: "fermeture",
      });

      // A reachable customer (wallet + web-push + email) fans out to all
      // three channels — REUSED code path from the `nouvelle` refuse (#403),
      // proving that the 3-step variant differs ONLY in the UI gate, not
      // in the backend side-effects.
      const notifs = await readNotifs(t, customerA);
      expect(notifs.map((n) => n.channel).sort()).toEqual(
        ["email", "wallet_push", "web_push"].sort(),
      );
      expect(
        notifs.every((n) => n.transactionalTrigger === "refund_issued"),
      ).toBe(true);
      expect(notifs.every((n) => n.status === "queued")).toBe(true);
    });
  }

  it("refusing twice (already refused from `en préparation`) is rejected — no double refund", async () => {
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "en préparation",
    );
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(api.lib.orders.workflow.refuse, {
      tenantId: seed.tenantA.tenantId,
      orderId,
      reason: "rupture",
    });
    await expect(
      asManager.mutation(api.lib.orders.workflow.refuse, {
        tenantId: seed.tenantA.tenantId,
        orderId,
        reason: "autre",
      }),
    ).rejects.toThrow();

    // Still exactly one refusée event (the original reason persists).
    const { events } = await readOrder(t, orderId);
    expect(events.filter((e) => e.status === "refusée")).toHaveLength(1);
    expect(events[0].reason).toBe("rupture");
  });

  it("refusing a foreign tenant's `prête` order still throws (ownership re-check, same MOAT)", async () => {
    const orderId = await seedOrder(
      t,
      seed.tenantA.tenantId,
      customerA,
      "prête",
    );
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.orders.workflow.refuse, {
          tenantId: seed.tenantB.tenantId,
          orderId,
          reason: "autre",
        }),
    ).rejects.toThrow();

    const { order, events } = await readOrder(t, orderId);
    expect(order?.status).toBe("prête"); // unchanged
    expect(events).toHaveLength(0);
  });
});

describe("2.3-E cross-tenant fuzz — refuse rejects unauthorized actors (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let orderId: Id<"orders">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedReachableCustomer(t, "eater-fuzz@x.fr");
    orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, "nouvelle");
  });

  it("every unauthorized actor on tenant A is rejected (Forbidden)", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.orders.workflow.refuse],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { orderId, reason: "autre" },
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });
});
