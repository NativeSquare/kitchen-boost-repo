import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "./lib/tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives at
// the convex root, so the same-dir keys are already "./x" — no key normalisation
// is needed (unlike the suites nested under convex/lib/**).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

/**
 * 2.1-A — Customer Data schema (the MOAT), written BEFORE the implementation
 * (TDD red). This slice ONLY lays the tables + indexes and proves they are
 * reachable solely through the sanctioned tenancy wrappers (never raw
 * `ctx.db.query("customers")` in business code). No business logic (consent,
 * segments, KPI, RGPD) — those are later slices.
 *
 * Three tables (PRD 90 / customer-data CONTEXT / ADR 0008 / ADR 0010 / ADR 0012):
 *  - `customers` — GLOBAL, NO `tenantId` (the documented isolation exemption,
 *    ADR 0010 — globality IS the MOAT). FK `userId → users`. No unique
 *    constraint on email/phone (cross-device duplicates assumed, ADR 0008).
 *    Push enrollment (ADR 0012: serial Wallet, web-push id, per-channel status)
 *    lives here so `anonymizeCustomer` (slice F) nullifies it in one geste.
 *  - `cgvVersions` — timestamped CGV archive for the CNIL (hash SHA-256).
 *  - `customerOrdersPerTenant` — the N-N link carrying `tenantId`; WRITTEN by
 *    chantier 2.3 (Orders), here only the schema + indexes. Because it carries
 *    `tenantId`, anything that reads it ships cross-tenant fuzz coverage.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.1-A schema — customers (GLOBAL), cgvVersions, customerOrdersPerTenant", () => {
  it("round-trips a customer row with all V1 fields incl. push enrollment", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "eater@x.fr",
        role: "customer",
        isAnonymous: true,
      });

      const customerId = await ctx.db.insert("customers", {
        userId,
        email: "sophie@example.fr",
        phone: "0612345678",
        firstName: "Sophie",
        address: "10 rue de Paris, 91000 Évry",
        lat: 48.6296,
        lng: 2.4408,
        cgvAcceptedAt: Date.now(),
        cgvVersionHash: "a".repeat(64),
        marketingOptOutDate: undefined,
        lastCheckoutAt: Date.now(),
        anonymizedAt: undefined,
        pushEnrollment: {
          walletSerialNumber: "wallet-serial-123",
          webPushSubscriptionId: "webpush-sub-456",
          walletStatus: "enrolled",
          webPushStatus: "enrolled",
          a2hsStatus: "not_enrolled",
        },
        createdAt: Date.now(),
      });

      const customer = await ctx.db.get(customerId);
      expect(customer?.firstName).toBe("Sophie");
      expect(customer?.userId).toBe(userId);
      expect(customer?.pushEnrollment?.walletSerialNumber).toBe(
        "wallet-serial-123",
      );
      // GLOBAL table: the row carries NO tenantId field (the MOAT, ADR 0010).
      expect("tenantId" in (customer ?? {})).toBe(false);
    });
  });

  it("accepts a MINIMAL customer (only userId + createdAt — everything else optional)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { role: "customer" });
      const customerId = await ctx.db.insert("customers", {
        userId,
        createdAt: Date.now(),
      });
      expect((await ctx.db.get(customerId))?.userId).toBe(userId);
    });
  });

  it("allows DUPLICATE email/phone across customers (no unique constraint, ADR 0008)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const u1 = await ctx.db.insert("users", { role: "customer" });
      const u2 = await ctx.db.insert("users", { role: "customer" });
      // Same person on two devices, no Wallet pass → two customer rows sharing
      // email/phone. Must NOT conflict — duplicates are assumed in V1.
      const c1 = await ctx.db.insert("customers", {
        userId: u1,
        email: "dup@example.fr",
        phone: "0700000000",
        createdAt: Date.now(),
      });
      const c2 = await ctx.db.insert("customers", {
        userId: u2,
        email: "dup@example.fr",
        phone: "0700000000",
        createdAt: Date.now(),
      });
      expect(c1).not.toBe(c2);
      expect((await ctx.db.get(c1))?.email).toBe("dup@example.fr");
      expect((await ctx.db.get(c2))?.email).toBe("dup@example.fr");
    });
  });

  it("exposes the customers by_user index", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { role: "customer" });
      const customerId = await ctx.db.insert("customers", {
        userId,
        createdAt: Date.now(),
      });
      const byUser = await ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(byUser?._id).toBe(customerId);
    });
  });

  it("round-trips a cgvVersions row and exposes by_hash + by_activatedAt", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const hash = "b".repeat(64);
      const id = await ctx.db.insert("cgvVersions", {
        wording: "En cliquant sur Payer, tu acceptes les CGV…",
        hash,
        activatedAt: 1000,
        endedAt: undefined,
      });
      expect((await ctx.db.get(id))?.hash).toBe(hash);

      const byHash = await ctx.db
        .query("cgvVersions")
        .withIndex("by_hash", (q) => q.eq("hash", hash))
        .unique();
      expect(byHash?._id).toBe(id);

      const byActivatedAt = await ctx.db
        .query("cgvVersions")
        .withIndex("by_activatedAt", (q) => q.eq("activatedAt", 1000))
        .collect();
      expect(byActivatedAt.length).toBe(1);
    });
  });

  it("round-trips customerOrdersPerTenant and exposes by_customer, by_tenant, by_tenant_customer", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { role: "customer" });
      const customerId = await ctx.db.insert("customers", {
        userId,
        createdAt: Date.now(),
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const linkId = await ctx.db.insert("customerOrdersPerTenant", {
        customerId,
        tenantId,
        totalOrders: 3,
        lastOrderAt: 2000,
        ltv: 84.5,
      });
      expect((await ctx.db.get(linkId))?.totalOrders).toBe(3);

      const byCustomer = await ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect();
      expect(byCustomer.length).toBe(1);

      const byTenant = await ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
      expect(byTenant.length).toBe(1);

      const byTenantCustomer = await ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_tenant_customer", (q) =>
          q.eq("tenantId", tenantId).eq("customerId", customerId),
        )
        .unique();
      expect(byTenantCustomer?._id).toBe(linkId);
    });
  });
});

/**
 * Wrapper-proof — the access contract (acceptance criterion): a `customers` row
 * is insertable + readable ONLY through a sanctioned wrapper. The probes live in
 * `lib/tenancy/_probes.ts` (the exempt sanctioned `ctx.db` path), built with
 * `kbAdminMutation/Query` (root) and `customerMutation/Query` (self) — there is
 * NO raw `ctx.db.query("customers")` in business code.
 */
describe("2.1-A customers reachable ONLY via sanctioned wrappers", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("root (kb_admin) inserts then reads a customer back via the wrapper", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const customerId = await asAdmin.mutation(
      api.lib.tenancy._probes.adminCreateCustomerProbe,
      { userId: seed.customerId, firstName: "Khan" },
    );
    const got = await asAdmin.query(
      api.lib.tenancy._probes.adminGetCustomerProbe,
      { customerId },
    );
    expect(got?.firstName).toBe("Khan");
    expect(got?.userId).toBe(seed.customerId);
  });

  it("a non-root caller cannot reach the root customer probes (kb_admin gate)", async () => {
    // Seed a real fiche (valid customers id) via the root path, then try to read
    // it as a plain customer: the kb_admin gate must refuse BEFORE any read.
    const customerId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.adminCreateCustomerProbe, {
        userId: seed.customerId,
      });
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .query(api.lib.tenancy._probes.adminGetCustomerProbe, { customerId }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("a customer reads its OWN fiche (self-scope) via the customer wrapper", async () => {
    // Seed a fiche for the customer (root path), then read it as self.
    const customerId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.adminCreateCustomerProbe, {
        userId: seed.customerId,
        firstName: "Sophie",
      });
    const mine = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.tenancy._probes.customerGetSelfFicheProbe, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(mine?._id).toBe(customerId);
    expect(mine?.firstName).toBe("Sophie");
  });
});

/**
 * Cross-tenant fuzz — `customerOrdersPerTenant` carries `tenantId`, so the probe
 * that reads it via `tenantQuery` MUST reject every actor without access to the
 * tenant under attack (ADR 0010). `customers` itself is GLOBAL and is NOT fuzzed
 * on tenant (it has no tenantId — by design the MOAT); its guard is the role gate
 * (root/self) asserted above.
 */
describe("2.1-A cross-tenant fuzz — customerOrdersPerTenant (carries tenantId)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("the per-tenant link reader rejects actors without access to the tenant", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.tenancy._probes.tenantCustomerStatsProbe],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(pairs).toBe(4);
    expect(leaks).toEqual([]);
  });

  it("a kb_manager of tenant A CAN read its own tenant's customer stats", async () => {
    const stats = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.tenancy._probes.tenantCustomerStatsProbe, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(Array.isArray(stats)).toBe(true);
  });
});
