import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/customer/, so normalise every relative key to be relative to the
// convex root (../../) so convex-test's findModulesRoot has ONE common prefix
// (same shape as the identity / kpi suites).
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
 * 2.1-F — Effacement RGPD par anonymisation IRRÉVERSIBLE (PRD 90 §6,
 * customer-data CONTEXT "Effacement RGPD = anonymisation irréversible",
 * ADR 0008/0012). TDD red.
 *
 * `anonymizeCustomer(customerId)` (root via `kbAdminMutation`) nullifies — with no
 * backup copy — every personal field of a `customers` fiche (email / phone /
 * firstName / address / lat / lng) AND the whole `pushEnrollment` object (wallet
 * serial = cross-device identity bridge + web-push id + per-channel statuses), and
 * stamps `anonymizedAt`. It PRESERVES `customerOrdersPerTenant` (totalOrders /
 * lastOrderAt / ltv intact → accounting 10 ans + KPI resto) and does NOT hard-delete
 * the fiche (no hard delete V1). The action is audited (kbAdminMutation auto-log).
 *
 * Reads: a fiche stays readable by the caller ITSELF via `customerQuery`
 * (`getCurrentCustomer`, US #21) and by ROOT via `kbAdminQuery`
 * (`getCustomerForSupport`, support/RGPD US #22) — NEVER by a `kb_manager` (the
 * MOAT). Identity flows ONLY through `getCurrentActor` (in the wrappers, ADR 0011);
 * the GLOBAL `customers` table is reached ONLY through the sanctioned tenancy seam,
 * never raw `ctx.db` in this business module (ADR 0010 / `no-untenanted-query`).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const FULL_PII = {
  email: "sophie@example.fr",
  phone: "+33611112222",
  firstName: "Sophie",
  address: "1 rue secrète, Paris",
  lat: 48.8566,
  lng: 2.3522,
  cgvAcceptedAt: 1_700_000_000_000,
  cgvVersionHash: "a".repeat(64),
  marketingOptOutDate: 1_700_000_100_000,
  lastCheckoutAt: 1_700_000_200_000,
  pushEnrollment: {
    walletSerialNumber: "WALLET-SERIAL-XYZ",
    webPushSubscriptionId: "web-push-sub-123",
    walletStatus: "enrolled" as const,
    webPushStatus: "enrolled" as const,
    a2hsStatus: "enrolled" as const,
  },
};

/** Seed an anonymous customer fiche carrying full PII; return user + fiche ids. */
async function seedCustomerWithPII(
  t: ReturnType<typeof convexTest>,
): Promise<{ userId: Id<"users">; customerId: Id<"customers"> }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      role: "customer",
      isAnonymous: true,
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      createdAt: 1_699_000_000_000,
      ...FULL_PII,
    });
    return { userId, customerId };
  });
}

/** Link a customer to a tenant with per-tenant stats (chantier 2.3's writer). */
async function linkOrders(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  tenantId: Id<"tenants">,
  stats: { totalOrders: number; lastOrderAt: number; ltv: number },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("customerOrdersPerTenant", {
      customerId,
      tenantId,
      ...stats,
    });
  });
}

/** Read a fiche directly (test-only, bypassing the wrappers). */
async function readFiche(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
): Promise<Doc<"customers"> | null> {
  return t.run((ctx) => ctx.db.get(customerId));
}

/** Read every auditLog row (test-only direct read). */
async function readAuditLog(
  t: ReturnType<typeof convexTest>,
): Promise<Doc<"auditLog">[]> {
  return t.run((ctx) => ctx.db.query("auditLog").collect());
}

// ---------------------------------------------------------------------------
// anonymizeCustomer — irreversible PII + push-id nullification, orders preserved.
// ---------------------------------------------------------------------------

describe("2.1-F anonymizeCustomer — irreversible PII nullification", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("nullifies every PII field + the whole pushEnrollment object, stamps anonymizedAt", async () => {
    const { customerId } = await seedCustomerWithPII(t);
    const before = Date.now();

    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });

    const fiche = await readFiche(t, customerId);
    expect(fiche).not.toBeNull();
    // PII captation — all gone (field removed, reads back as undefined).
    expect(fiche?.email).toBeUndefined();
    expect(fiche?.phone).toBeUndefined();
    expect(fiche?.firstName).toBeUndefined();
    expect(fiche?.address).toBeUndefined();
    expect(fiche?.lat).toBeUndefined();
    expect(fiche?.lng).toBeUndefined();
    // Push enrollment identity + reachability — cleared in one geste.
    expect(fiche?.pushEnrollment).toBeUndefined();
    // Irreversibility marker.
    expect(typeof fiche?.anonymizedAt).toBe("number");
    expect(fiche?.anonymizedAt).toBeGreaterThanOrEqual(before);
  });

  it("leaves no trace of any erased PII anywhere on the fiche (no backup copy)", async () => {
    const { customerId } = await seedCustomerWithPII(t);
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });

    const fiche = await readFiche(t, customerId);
    const serialised = JSON.stringify(fiche);
    for (const pii of [
      FULL_PII.email,
      FULL_PII.phone,
      FULL_PII.firstName,
      FULL_PII.address,
      String(FULL_PII.lat),
      String(FULL_PII.lng),
      FULL_PII.pushEnrollment.walletSerialNumber,
      FULL_PII.pushEnrollment.webPushSubscriptionId,
    ]) {
      expect(serialised).not.toContain(pii);
    }
  });

  it("PRESERVES the fiche row (no hard delete) + non-personal legal fields", async () => {
    const { userId, customerId } = await seedCustomerWithPII(t);
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });

    const fiche = await readFiche(t, customerId);
    // The row still exists (ghost customer kept — no hard delete V1).
    expect(fiche).not.toBeNull();
    expect(fiche?._id).toBe(customerId);
    expect(fiche?.userId).toBe(userId);
    expect(fiche?.createdAt).toBe(1_699_000_000_000);
    // CNIL consent proof + marketing/audit timestamps are NOT personal data → kept.
    expect(fiche?.cgvAcceptedAt).toBe(FULL_PII.cgvAcceptedAt);
    expect(fiche?.cgvVersionHash).toBe(FULL_PII.cgvVersionHash);
    expect(fiche?.marketingOptOutDate).toBe(FULL_PII.marketingOptOutDate);
    expect(fiche?.lastCheckoutAt).toBe(FULL_PII.lastCheckoutAt);
  });

  it("PRESERVES customerOrdersPerTenant historical stats (accounting 10 ans + KPI)", async () => {
    const { customerId } = await seedCustomerWithPII(t);
    await linkOrders(t, customerId, seed.tenantA.tenantId, {
      totalOrders: 7,
      lastOrderAt: 1_700_000_300_000,
      ltv: 210,
    });
    await linkOrders(t, customerId, seed.tenantB.tenantId, {
      totalOrders: 3,
      lastOrderAt: 1_700_000_400_000,
      ltv: 90,
    });

    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });

    const links = await t.run((ctx) =>
      ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect(),
    );
    // Both links survive untouched, still pointing at the ghost customer.
    expect(links).toHaveLength(2);
    const a = links.find((l) => l.tenantId === seed.tenantA.tenantId);
    const b = links.find((l) => l.tenantId === seed.tenantB.tenantId);
    expect(a).toMatchObject({
      totalOrders: 7,
      lastOrderAt: 1_700_000_300_000,
      ltv: 210,
    });
    expect(b).toMatchObject({
      totalOrders: 3,
      lastOrderAt: 1_700_000_400_000,
      ltv: 90,
    });
  });

  it("is idempotent — re-anonymising an already-anonymous fiche is a safe no-op", async () => {
    const { customerId } = await seedCustomerWithPII(t);
    const as = t.withIdentity({ subject: seed.adminId });
    await as.mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });
    // Second call must not throw and must keep the fiche anonymous.
    await as.mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });
    const fiche = await readFiche(t, customerId);
    expect(fiche?.email).toBeUndefined();
    expect(typeof fiche?.anonymizedAt).toBe("number");
  });

  it("audits the erasure via logAudit (kbAdminMutation auto-log)", async () => {
    const { customerId } = await seedCustomerWithPII(t);
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });

    const rows = await readAuditLog(t);
    const row = rows.find((r) => r.action === "customer.rgpd.anonymize");
    expect(row).toBeDefined();
    expect(row?.actorUserId).toBe(seed.adminId);
    expect(row?.actorRole).toBe("kb_admin");
    expect(typeof row?.timestamp).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// anonymizeCustomer — root-only gate.
// ---------------------------------------------------------------------------

describe("2.1-F anonymizeCustomer — root-only gate", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    ({ customerId } = await seedCustomerWithPII(t));
  });

  it("throws Unauthenticated for an anonymous caller (and erases nothing)", async () => {
    await expect(
      t.mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId }),
    ).rejects.toThrow(/unauthenticated/i);
    expect((await readFiche(t, customerId))?.email).toBe(FULL_PII.email);
  });

  it("throws Forbidden for a plain customer (not root)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId }),
    ).rejects.toThrow(/forbidden/i);
    expect((await readFiche(t, customerId))?.email).toBe(FULL_PII.email);
  });

  it("throws Forbidden for a tenant manager (resto role, not root) — never via kb_manager", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId }),
    ).rejects.toThrow(/forbidden/i);
    expect((await readFiche(t, customerId))?.email).toBe(FULL_PII.email);
  });
});

// ---------------------------------------------------------------------------
// getCustomerForSupport — root read of any fiche (US #22), never via kb_manager.
// ---------------------------------------------------------------------------

describe("2.1-F getCustomerForSupport — root support/RGPD read (US #22)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    ({ customerId } = await seedCustomerWithPII(t));
  });

  it("root reads any fiche by id (full fiche, support/RGPD)", async () => {
    const fiche = await t
      .withIdentity({ subject: seed.adminId })
      .query(api.lib.customer.rgpd.getCustomerForSupport, { customerId });
    expect(fiche?._id).toBe(customerId);
    expect(fiche?.email).toBe(FULL_PII.email);
  });

  it("returns the anonymised fiche after erasure (still readable by root)", async () => {
    const as = t.withIdentity({ subject: seed.adminId });
    await as.mutation(api.lib.customer.rgpd.anonymizeCustomer, { customerId });
    const fiche = await as.query(api.lib.customer.rgpd.getCustomerForSupport, {
      customerId,
    });
    expect(fiche?._id).toBe(customerId);
    expect(fiche?.email).toBeUndefined();
    expect(typeof fiche?.anonymizedAt).toBe("number");
  });

  it("throws Forbidden for a kb_manager — the resto NEVER reads a raw customer (MOAT)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .query(api.lib.customer.rgpd.getCustomerForSupport, { customerId }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("throws Forbidden for a plain customer (not root) and Unauthenticated when anonymous", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .query(api.lib.customer.rgpd.getCustomerForSupport, { customerId }),
    ).rejects.toThrow(/forbidden/i);
    await expect(
      t.query(api.lib.customer.rgpd.getCustomerForSupport, { customerId }),
    ).rejects.toThrow(/unauthenticated/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz — replay both surfaces with unauthorized actors (ADR 0010).
// ---------------------------------------------------------------------------

describe("2.1-F cross-tenant fuzz — RGPD surfaces reject every unauthorized actor", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    ({ customerId } = await seedCustomerWithPII(t));
  });

  it("anonymizeCustomer rejects every non-root actor (manager, staff, detached, customer, anonymous)", async () => {
    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.rgpd.anonymizeCustomer],
      isQuery: () => false,
      tenantId: undefined, // root mutation, no tenantId arg
      actors,
      extraArgs: { customerId },
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
    // None of the rejected calls erased the PII.
    expect((await readFiche(t, customerId))?.email).toBe(FULL_PII.email);
  });

  it("getCustomerForSupport rejects every non-root actor (no raw customer leaks)", async () => {
    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.rgpd.getCustomerForSupport],
      isQuery: () => true,
      tenantId: undefined, // root query, no tenantId arg
      actors,
      extraArgs: { customerId },
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
  });
});
