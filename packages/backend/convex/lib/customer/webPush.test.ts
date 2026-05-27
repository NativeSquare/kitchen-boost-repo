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
import {
  deactivateWebPushSubscription,
  listActiveWebPushSubscriptions,
  registerWebPushSubscription,
} from "../tenancy/webPushSubscriptionsStore";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/customer/, so normalise every relative key to be relative to the
// convex root (../../) so convex-test's findModulesRoot has ONE common prefix
// (same shape as the consent / identity suites).
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
 * 2.1-G — `webPushSubscriptions` storage capability, written BEFORE the
 * implementation (TDD red).
 *
 * Surface under test:
 *  - The TENANT-SCOPED `lib/tenancy/webPushSubscriptionsStore` seam:
 *    `registerWebPushSubscription` (idempotent upsert by `endpoint`),
 *    `listActiveWebPushSubscriptions(customerId, tenantId)`,
 *    `deactivateWebPushSubscription` (soft flip to `inactive`).
 *  - The self-scoped `register` mutation (`api.lib.customer.webPush.register`):
 *    stores the subscription AND sets `pushEnrollment.webPushStatus="enrolled"`
 *    on the OWN fiche via `patchCustomerPushEnrollment` (reachability stays the
 *    source of truth in 2.1, ADR 0012).
 *
 * Isolation (ADR 0010): the table carries `tenantId`, so the seam is reached only
 * through `lib/tenancy`; the `register` mutation is fuzzed cross-tenant. MOAT: the
 * customer is referenced BY ID only (ADR 0012).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A FIXTURE web-push subscription (RFC 8291). `p256dh`/`auth` are CLIENT public
 * keys = runtime data — never a server secret. */
const FIXTURE_SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/FIXTURE-endpoint-1",
  p256dh: "FIXTURE-p256dh-public-key",
  auth: "FIXTURE-auth-secret",
};

/** Seed an anonymous customer (the shape the Anonymous provider produces). */
async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

/** Provision a fiche for `userId` on `tenantId` and return its customers id. */
async function provision(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<Id<"customers">> {
  return t
    .withIdentity({ subject: userId })
    .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
      tenantId,
    });
}

// ---------------------------------------------------------------------------
// Seam: registerWebPushSubscription — idempotent upsert by endpoint.
// ---------------------------------------------------------------------------

describe("2.1-G registerWebPushSubscription — idempotent upsert by endpoint", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const userId = await seedAnonymousCustomer(t);
    customerId = await provision(t, userId, seed.tenantA.tenantId);
  });

  it("inserts a fresh ACTIVE row (endpoint + client keys persisted)", async () => {
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerId).toBe(customerId);
    expect(rows[0]?.tenantId).toBe(seed.tenantA.tenantId);
    expect(rows[0]?.endpoint).toBe(FIXTURE_SUB.endpoint);
    expect(rows[0]?.p256dh).toBe(FIXTURE_SUB.p256dh);
    expect(rows[0]?.auth).toBe(FIXTURE_SUB.auth);
    expect(rows[0]?.status).toBe("active");
    expect(typeof rows[0]?.createdAt).toBe("number");
    expect(typeof rows[0]?.updatedAt).toBe("number");
  });

  it("re-register of the SAME endpoint refreshes keys + stays active — NO new row", async () => {
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    // The push service rotated the client keys for the same endpoint.
    await t.run((ctx) =>
      registerWebPushSubscription(ctx, customerId, seed.tenantA.tenantId, {
        endpoint: FIXTURE_SUB.endpoint,
        p256dh: "ROTATED-p256dh",
        auth: "ROTATED-auth",
      }),
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe("ROTATED-p256dh");
    expect(rows[0]?.auth).toBe("ROTATED-auth");
    expect(rows[0]?.status).toBe("active");
  });

  it("re-register RE-ACTIVATES a previously deactivated endpoint (no duplicate)", async () => {
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    await t.run((ctx) =>
      deactivateWebPushSubscription(ctx, FIXTURE_SUB.endpoint),
    );
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("active");
  });

  it("distinct endpoints of the same (customer, tenant) are distinct rows", async () => {
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    await t.run((ctx) =>
      registerWebPushSubscription(ctx, customerId, seed.tenantA.tenantId, {
        endpoint: "https://updates.push.services.mozilla.com/wpush/FIXTURE-2",
        p256dh: "other-p256dh",
        auth: "other-auth",
      }),
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Seam: listActiveWebPushSubscriptions / deactivateWebPushSubscription.
// ---------------------------------------------------------------------------

describe("2.1-G listActiveWebPushSubscriptions — active rows of the (customer, tenant)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const userId = await seedAnonymousCustomer(t);
    customerId = await provision(t, userId, seed.tenantA.tenantId);
  });

  it("returns endpoint + client keys of the active subscriptions (the send-layer read)", async () => {
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    const active = await t.run((ctx) =>
      listActiveWebPushSubscriptions(ctx, customerId, seed.tenantA.tenantId),
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.endpoint).toBe(FIXTURE_SUB.endpoint);
    expect(active[0]?.p256dh).toBe(FIXTURE_SUB.p256dh);
    expect(active[0]?.auth).toBe(FIXTURE_SUB.auth);
  });

  it("EXCLUDES deactivated subscriptions", async () => {
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    await t.run((ctx) =>
      deactivateWebPushSubscription(ctx, FIXTURE_SUB.endpoint),
    );
    const active = await t.run((ctx) =>
      listActiveWebPushSubscriptions(ctx, customerId, seed.tenantA.tenantId),
    );
    expect(active).toEqual([]);
  });

  it("scopes to the (customer, tenant) couple — another tenant's row is invisible", async () => {
    // Same customer, but a subscription stored under tenant B (per-origin channel).
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantB.tenantId,
        FIXTURE_SUB,
      ),
    );
    const onA = await t.run((ctx) =>
      listActiveWebPushSubscriptions(ctx, customerId, seed.tenantA.tenantId),
    );
    expect(onA).toEqual([]);
    const onB = await t.run((ctx) =>
      listActiveWebPushSubscriptions(ctx, customerId, seed.tenantB.tenantId),
    );
    expect(onB).toHaveLength(1);
  });
});

describe("2.1-G deactivateWebPushSubscription — soft flip (no hard delete)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const userId = await seedAnonymousCustomer(t);
    customerId = await provision(t, userId, seed.tenantA.tenantId);
  });

  it("flips status to inactive but keeps the row (auditable history)", async () => {
    await t.run((ctx) =>
      registerWebPushSubscription(
        ctx,
        customerId,
        seed.tenantA.tenantId,
        FIXTURE_SUB,
      ),
    );
    await t.run((ctx) =>
      deactivateWebPushSubscription(ctx, FIXTURE_SUB.endpoint),
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("inactive");
  });

  it("is a no-op for an unknown endpoint (idempotent)", async () => {
    await t.run((ctx) =>
      deactivateWebPushSubscription(ctx, "https://unknown.example/endpoint"),
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// register mutation — stores the subscription AND flips webPushStatus=enrolled.
// ---------------------------------------------------------------------------

describe("2.1-G register — self mutation upserts subscription + sets webPushStatus=enrolled", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("stores the subscription for the OWN fiche under the wrapper tenant", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.webPush.register, {
        tenantId: seed.tenantA.tenantId,
        endpoint: FIXTURE_SUB.endpoint,
        p256dh: FIXTURE_SUB.p256dh,
        auth: FIXTURE_SUB.auth,
      });
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerId).toBe(customerId);
    expect(rows[0]?.tenantId).toBe(seed.tenantA.tenantId);
    expect(rows[0]?.endpoint).toBe(FIXTURE_SUB.endpoint);
    expect(rows[0]?.status).toBe("active");
  });

  it("sets pushEnrollment.webPushStatus = enrolled on the fiche (reachability source of truth, ADR 0012)", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.webPush.register, {
        tenantId: seed.tenantA.tenantId,
        endpoint: FIXTURE_SUB.endpoint,
        p256dh: FIXTURE_SUB.p256dh,
        auth: FIXTURE_SUB.auth,
      });
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.webPushStatus).toBe("enrolled");
  });

  it("provisions the fiche on the fly if the customer has none yet", async () => {
    const userId = await seedAnonymousCustomer(t);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.webPush.register, {
        tenantId: seed.tenantA.tenantId,
        endpoint: FIXTURE_SUB.endpoint,
        p256dh: FIXTURE_SUB.p256dh,
        auth: FIXTURE_SUB.auth,
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(fiche?.pushEnrollment?.webPushStatus).toBe("enrolled");
    expect(fiche?.userId).toBe(userId);
  });

  it("is idempotent: re-register of the same endpoint keeps a single row", async () => {
    const userId = await seedAnonymousCustomer(t);
    await provision(t, userId, seed.tenantA.tenantId);
    const args = {
      tenantId: seed.tenantA.tenantId,
      endpoint: FIXTURE_SUB.endpoint,
      p256dh: FIXTURE_SUB.p256dh,
      auth: FIXTURE_SUB.auth,
    };
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.webPush.register, args);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.webPush.register, {
        ...args,
        p256dh: "ROTATED",
      });
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe("ROTATED");
  });
});

// ---------------------------------------------------------------------------
// Auth gate + cross-tenant fuzz on the register surface (ADR 0010).
// ---------------------------------------------------------------------------

describe("2.1-G auth gate + cross-tenant fuzz — register rejects unauthorized actors", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.webPush.register, {
        tenantId: seed.tenantA.tenantId,
        endpoint: FIXTURE_SUB.endpoint,
        p256dh: FIXTURE_SUB.p256dh,
        auth: FIXTURE_SUB.auth,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — web-push register is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.webPush.register, {
          tenantId: seed.tenantA.tenantId,
          endpoint: FIXTURE_SUB.endpoint,
          p256dh: FIXTURE_SUB.p256dh,
          auth: FIXTURE_SUB.auth,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("self-scope: Bob's register never touches Alice's subscriptions/fiche", async () => {
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);
    const aliceFiche = await provision(t, alice, seed.tenantA.tenantId);
    // Bob registers a web-push subscription for the SAME endpoint string.
    await t
      .withIdentity({ subject: bob })
      .mutation(api.lib.customer.webPush.register, {
        tenantId: seed.tenantA.tenantId,
        endpoint: FIXTURE_SUB.endpoint,
        p256dh: FIXTURE_SUB.p256dh,
        auth: FIXTURE_SUB.auth,
      });
    // Alice's fiche stays unenrolled, and the only subscription belongs to Bob.
    const aliceDoc = await t.run((ctx) => ctx.db.get(aliceFiche));
    expect(aliceDoc?.pushEnrollment?.webPushStatus).toBeUndefined();
    const rows = await t.run((ctx) =>
      ctx.db.query("webPushSubscriptions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerId).not.toBe(aliceFiche);
  });

  it("the global root (kb_admin) + anonymous are rejected by register (cross-tenant fuzz)", async () => {
    // A tenant "manager" in the seed has GLOBAL role `customer` (resto roles live
    // on userTenants), so `customerMutation` admits them as a customer — their
    // isolation is SELF-SCOPE (above), not a wrapper refusal. The actors a
    // customer surface actually REFUSES are the global root + the anonymous caller
    // (same shape as the consent suite, ADR 0010 / 0011).
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.webPush.register],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {
        endpoint: FIXTURE_SUB.endpoint,
        p256dh: FIXTURE_SUB.p256dh,
        auth: FIXTURE_SUB.auth,
      },
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});
