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
import { type ReachabilityInput, channelReachability } from "./reachability";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/customer/, so normalise every relative key to be relative to the
// convex root (../../) so convex-test's findModulesRoot has ONE common prefix.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/customer/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.1-D — Reachability by channel (push / email / SMS) + push enrollment, TDD red.
 *
 * `channelReachability` is a PURE rule (no Convex ctx). `setPushEnrollment` is
 * SELF-scoped (`customerMutation`, also callable by Notifications 2.7 through the
 * same self contract): it writes `walletSerialNumber` / `webPushSubscriptionId` +
 * a per-channel status, and a status can be UPDATED (web-push expiry, opt-out).
 * The per-tenant `reachabilityCounts` aggregate exposes ONLY counts to a
 * `kb_manager` (the MOAT: never a raw `customer`), reconstructed from
 * `customerOrdersPerTenant` (which carries `tenantId`). 2.1 NEVER writes that link.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Seed an anonymous customer; return user + customer ids. */
async function seedCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<{ userId: Id<"users">; customerId: Id<"customers"> }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      role: "customer",
      isAnonymous: true,
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      createdAt: Date.now(),
    });
    return { userId, customerId };
  });
}

/** Link a customer to a tenant (the 2.3 writer — fixture only). */
async function linkOrders(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  tenantId: Id<"tenants">,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("customerOrdersPerTenant", {
      customerId,
      tenantId,
      totalOrders: 1,
      lastOrderAt: Date.now(),
      ltv: 20,
    });
  });
}

// ---------------------------------------------------------------------------
// channelReachability — pure rule (PRD 90 §3 / customer-data CONTEXT).
// ---------------------------------------------------------------------------

describe("2.1-D channelReachability — pure per-channel reachability rule", () => {
  it("email reachable iff a non-empty email is present", () => {
    expect(channelReachability({ email: "a@b.fr" }).email).toBe(true);
    expect(channelReachability({ email: "" }).email).toBe(false);
    expect(channelReachability({}).email).toBe(false);
  });

  it("SMS reachable iff a non-empty phone is present", () => {
    expect(channelReachability({ phone: "+33600000000" }).sms).toBe(true);
    expect(channelReachability({ phone: "" }).sms).toBe(false);
    expect(channelReachability({}).sms).toBe(false);
  });

  it("push reachable iff ANY push channel is enrolled (wallet OR web-push OR a2hs)", () => {
    expect(
      channelReachability({ pushEnrollment: { walletStatus: "enrolled" } })
        .push,
    ).toBe(true);
    expect(
      channelReachability({ pushEnrollment: { webPushStatus: "enrolled" } })
        .push,
    ).toBe(true);
    expect(
      channelReachability({ pushEnrollment: { a2hsStatus: "enrolled" } }).push,
    ).toBe(true);
  });

  it("push NOT reachable when channels are not_enrolled / revoked / absent", () => {
    expect(channelReachability({}).push).toBe(false);
    expect(
      channelReachability({ pushEnrollment: { walletStatus: "revoked" } }).push,
    ).toBe(false);
    expect(
      channelReachability({
        pushEnrollment: {
          walletStatus: "not_enrolled",
          webPushStatus: "revoked",
        },
      }).push,
    ).toBe(false);
  });

  it("an anonymised customer (fields nullified) is reachable on no channel", () => {
    const empty: ReachabilityInput = {};
    expect(channelReachability(empty)).toEqual({
      push: false,
      email: false,
      sms: false,
    });
  });
});

// ---------------------------------------------------------------------------
// setPushEnrollment — self-scoped write (also callable by Notifications 2.7).
// ---------------------------------------------------------------------------

describe("2.1-D setPushEnrollment — self-scoped, writes ids + per-channel status", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("writes walletSerialNumber + walletStatus on the OWN fiche", async () => {
    const { userId } = await seedCustomer(t);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.reachability.setPushEnrollment, {
        tenantId: seed.tenantA.tenantId,
        walletSerialNumber: "SERIAL-123",
        walletStatus: "enrolled",
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(fiche?.pushEnrollment?.walletSerialNumber).toBe("SERIAL-123");
    expect(fiche?.pushEnrollment?.walletStatus).toBe("enrolled");
  });

  it("writes webPushSubscriptionId + webPushStatus", async () => {
    const { userId } = await seedCustomer(t);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.reachability.setPushEnrollment, {
        tenantId: seed.tenantA.tenantId,
        webPushSubscriptionId: "sub_abc",
        webPushStatus: "enrolled",
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(fiche?.pushEnrollment?.webPushSubscriptionId).toBe("sub_abc");
    expect(fiche?.pushEnrollment?.webPushStatus).toBe("enrolled");
  });

  it("a status can be UPDATED (web-push expiry / opt-out) without losing the others (US #16)", async () => {
    const { userId } = await seedCustomer(t);
    const asUser = t.withIdentity({ subject: userId });
    await asUser.mutation(api.lib.customer.reachability.setPushEnrollment, {
      tenantId: seed.tenantA.tenantId,
      walletSerialNumber: "SERIAL-123",
      walletStatus: "enrolled",
      webPushSubscriptionId: "sub_abc",
      webPushStatus: "enrolled",
    });
    // web-push expires → status flips to revoked; wallet must be preserved.
    await asUser.mutation(api.lib.customer.reachability.setPushEnrollment, {
      tenantId: seed.tenantA.tenantId,
      webPushStatus: "revoked",
    });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(fiche?.pushEnrollment?.webPushStatus).toBe("revoked");
    // Untouched fields survive a partial update.
    expect(fiche?.pushEnrollment?.walletStatus).toBe("enrolled");
    expect(fiche?.pushEnrollment?.walletSerialNumber).toBe("SERIAL-123");
    expect(fiche?.pushEnrollment?.webPushSubscriptionId).toBe("sub_abc");
  });

  it("provisions the fiche on the fly if the customer has none yet", async () => {
    const { userId } = await seedCustomer(t);
    // delete the auto-seeded fiche to simulate "no fiche yet"
    await t.run(async (ctx) => {
      const f = await ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (f) await ctx.db.delete(f._id);
    });
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.reachability.setPushEnrollment, {
        tenantId: seed.tenantA.tenantId,
        a2hsStatus: "enrolled",
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(fiche?.pushEnrollment?.a2hsStatus).toBe("enrolled");
  });

  it("self-scope: enrollment by Bob never touches Alice's fiche", async () => {
    const alice = await seedCustomer(t);
    const bob = await seedCustomer(t);
    await t
      .withIdentity({ subject: bob.userId })
      .mutation(api.lib.customer.reachability.setPushEnrollment, {
        tenantId: seed.tenantA.tenantId,
        walletStatus: "enrolled",
      });
    const aliceFiche = await t.run((ctx) => ctx.db.get(alice.customerId));
    expect(aliceFiche?.pushEnrollment).toBeUndefined();
  });

  it("does NOT write customerOrdersPerTenant stats (read-only on the link, reserved 2.3)", async () => {
    const { userId, customerId } = await seedCustomer(t);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.reachability.setPushEnrollment, {
        tenantId: seed.tenantA.tenantId,
        walletStatus: "enrolled",
      });
    // No link row was created by the enrollment (2.1 never writes the link).
    const links = await t.run((ctx) =>
      ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect(),
    );
    expect(links).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Auth gate on setPushEnrollment.
// ---------------------------------------------------------------------------

describe("2.1-D setPushEnrollment — auth gate", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.reachability.setPushEnrollment, {
        tenantId: seed.tenantA.tenantId,
        walletStatus: "enrolled",
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — enrollment is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.reachability.setPushEnrollment, {
          tenantId: seed.tenantA.tenantId,
          walletStatus: "enrolled",
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

// ---------------------------------------------------------------------------
// reachabilityCounts — per-tenant aggregate, counts only (MOAT).
// ---------------------------------------------------------------------------

describe("2.1-D reachabilityCounts — per-tenant channel counts, no raw customer (MOAT)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("counts reachable-by-channel for a tenant's customers", async () => {
    // c1: email + phone + wallet push. c2: email only. c3: nothing reachable.
    const c1 = await seedCustomer(t);
    const c2 = await seedCustomer(t);
    const c3 = await seedCustomer(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(c1.customerId, {
        email: "a@b.fr",
        phone: "+33600000000",
        pushEnrollment: { walletStatus: "enrolled" },
      });
      await ctx.db.patch(c2.customerId, { email: "c@d.fr" });
    });
    await linkOrders(t, c1.customerId, seed.tenantA.tenantId);
    await linkOrders(t, c2.customerId, seed.tenantA.tenantId);
    await linkOrders(t, c3.customerId, seed.tenantA.tenantId);

    const counts = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.reachability.reachabilityCounts, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(counts).toEqual({ push: 1, email: 2, sms: 1, total: 3 });
  });

  it("a customer reachable at tenant A is NOT counted at tenant B (isolation)", async () => {
    const c = await seedCustomer(t);
    await t.run((ctx) =>
      ctx.db.patch(c.customerId, { email: "a@b.fr", phone: "+33600000000" }),
    );
    await linkOrders(t, c.customerId, seed.tenantA.tenantId);

    const bCounts = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.customer.reachability.reachabilityCounts, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bCounts).toEqual({ push: 0, email: 0, sms: 0, total: 0 });
  });

  it("returns plain counts, never a raw customer object (MOAT guard)", async () => {
    const c = await seedCustomer(t);
    await t.run((ctx) =>
      ctx.db.patch(c.customerId, { email: "a@b.fr", phone: "+33600000000" }),
    );
    await linkOrders(t, c.customerId, seed.tenantA.tenantId);
    const counts: unknown = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.reachability.reachabilityCounts, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(Object.keys(counts as object).sort()).toEqual([
      "email",
      "push",
      "sms",
      "total",
    ]);
    for (const v of Object.values(counts as Record<string, unknown>)) {
      expect(typeof v).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz — replay every exported fn with unauthorized actors.
// ---------------------------------------------------------------------------

describe("2.1-D cross-tenant fuzz — reachability surface rejects unauthorized actors", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const c = await seedCustomer(t);
    await t.run((ctx) => ctx.db.patch(c.customerId, { email: "a@b.fr" }));
    await linkOrders(t, c.customerId, seed.tenantA.tenantId);
  });

  it("reachabilityCounts rejects every unauthorized actor on tenant A", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.reachability.reachabilityCounts],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
  });

  it("setPushEnrollment rejects the global root (kb_admin) and anonymous", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.reachability.setPushEnrollment],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { walletStatus: "enrolled" },
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });

  it("a manager of tenant B cannot read tenant A's reachability counts", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .query(api.lib.customer.reachability.reachabilityCounts, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});
