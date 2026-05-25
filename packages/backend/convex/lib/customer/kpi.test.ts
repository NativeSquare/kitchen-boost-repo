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
// (same shape as the segments / reachability suites).
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
 * 2.1-E — `aggregateCustomerKPIs` (PRD 90 §3 / Q90-Q2, customer-data CONTEXT
 * "KPI clients (vue resto V1)"). TDD red.
 *
 * The SINGLE resto-facing surface on the MOAT. It returns ONLY aggregates for the
 * calling tenant (kb_manager via `tenantQuery({ allow: ["kb_manager"] })`):
 *  - segment counts (Actif / Inactif / VIP — frozen V1 thresholds, PRD 90 §3)
 *  - reachability per channel (push / email / SMS)
 *  - macro KPI: total clients, new this month, return rate (% ≥2 orders)
 *
 * It NEVER returns a raw `customer` object, a coordinate, a name or an individual
 * id, and there is NO export / bulk surface in the module. Reconstructed from
 * `customerOrdersPerTenant` (which carries `tenantId`), so it is tenant-scoped
 * through the wrapper. 2.1 NEVER writes the link (reserved 2.3).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const DAY = 24 * 60 * 60 * 1000;

/** Seed an anonymous customer fiche; return both the user + customer ids. */
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

/** Link a customer to a tenant with the given per-tenant stats (2.3's writer). */
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

/** Read every auditLog row (test-only direct read, bypassing the wrappers). */
async function readAuditLog(
  t: ReturnType<typeof convexTest>,
): Promise<Doc<"auditLog">[]> {
  return t.run((ctx) => ctx.db.query("auditLog").collect());
}

// ---------------------------------------------------------------------------
// aggregateCustomerKPIs — the resto KPI surface, aggregates only (the MOAT).
// ---------------------------------------------------------------------------

describe("2.1-E aggregateCustomerKPIs — per-tenant aggregates only (MOAT)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns segment counts, reachability counts and macro KPI for the tenant", async () => {
    const now = Date.now();
    // actif: 1 order 5d ago, email+phone. vip: 6 orders, wallet push. inactif:
    // 2 orders 120d ago, email only.
    const actif = await seedCustomer(t);
    const vip = await seedCustomer(t);
    const inactif = await seedCustomer(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(actif.customerId, {
        email: "a@b.fr",
        phone: "+33600000001",
      });
      await ctx.db.patch(vip.customerId, {
        email: "v@b.fr",
        pushEnrollment: { walletStatus: "enrolled" },
      });
      await ctx.db.patch(inactif.customerId, { email: "i@b.fr" });
    });
    await linkOrders(t, actif.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: now - 5 * DAY,
      ltv: 20,
    });
    await linkOrders(t, vip.customerId, seed.tenantA.tenantId, {
      totalOrders: 6,
      lastOrderAt: now - 200 * DAY,
      ltv: 300,
    });
    await linkOrders(t, inactif.customerId, seed.tenantA.tenantId, {
      totalOrders: 2,
      lastOrderAt: now - 120 * DAY,
      ltv: 40,
    });

    const kpi = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.kpi.aggregateCustomerKPIs, {
        tenantId: seed.tenantA.tenantId,
      });

    expect(kpi.segments).toEqual({ actif: 1, inactif: 1, vip: 1 });
    // email: 3 (all have one). phone: 1 (actif). push: 1 (vip wallet).
    expect(kpi.reachability).toEqual({ push: 1, email: 3, sms: 1 });
    expect(kpi.total).toBe(3);
    // return rate = clients with ≥2 orders / total = (vip + inactif) / 3.
    expect(kpi.returnRate).toBeCloseTo(2 / 3, 5);
  });

  it("counts new clients this month from the link creation time (tenant-scoped)", async () => {
    // Two links created now (this month) at tenant A.
    const c1 = await seedCustomer(t);
    const c2 = await seedCustomer(t);
    await linkOrders(t, c1.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: Date.now(),
      ltv: 10,
    });
    await linkOrders(t, c2.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: Date.now(),
      ltv: 10,
    });

    const kpi = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.kpi.aggregateCustomerKPIs, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(kpi.total).toBe(2);
    expect(kpi.newThisMonth).toBe(2);
  });

  it("returnRate is 0 when the tenant has no customers (no division by zero)", async () => {
    const kpi = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.kpi.aggregateCustomerKPIs, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(kpi).toEqual({
      segments: { actif: 0, inactif: 0, vip: 0 },
      reachability: { push: 0, email: 0, sms: 0 },
      total: 0,
      newThisMonth: 0,
      returnRate: 0,
    });
  });

  it("a customer who ordered at tenant A is NOT in tenant B's KPI (isolation)", async () => {
    const c = await seedCustomer(t);
    await t.run((ctx) =>
      ctx.db.patch(c.customerId, { email: "a@b.fr", phone: "+33600000000" }),
    );
    await linkOrders(t, c.customerId, seed.tenantA.tenantId, {
      totalOrders: 3,
      lastOrderAt: Date.now(),
      ltv: 90,
    });

    const bKpi = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.customer.kpi.aggregateCustomerKPIs, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bKpi.total).toBe(0);
    expect(bKpi.segments).toEqual({ actif: 0, inactif: 0, vip: 0 });
    expect(bKpi.reachability).toEqual({ push: 0, email: 0, sms: 0 });
    expect(bKpi.newThisMonth).toBe(0);
    expect(bKpi.returnRate).toBe(0);
  });

  it("a kb_admin (root) can read the KPI for any tenant", async () => {
    const kpi = await t
      .withIdentity({ subject: seed.adminId })
      .query(api.lib.customer.kpi.aggregateCustomerKPIs, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(kpi.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MOAT guard — the surface returns ONLY aggregates, NO raw customer to a manager.
// ---------------------------------------------------------------------------

describe("2.1-E MOAT guard — aggregates only, no raw customer reaches kb_manager", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("the KPI payload is numbers-only, carries no PII field anywhere", async () => {
    const c = await seedCustomer(t);
    await t.run((ctx) =>
      ctx.db.patch(c.customerId, {
        email: "secret@b.fr",
        phone: "+33611112222",
        firstName: "Sophie",
        address: "1 rue secrète",
        lat: 48.85,
        lng: 2.35,
        pushEnrollment: { walletStatus: "enrolled" },
      }),
    );
    await linkOrders(t, c.customerId, seed.tenantA.tenantId, {
      totalOrders: 7,
      lastOrderAt: Date.now(),
      ltv: 210,
    });

    const kpi: unknown = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.kpi.aggregateCustomerKPIs, {
        tenantId: seed.tenantA.tenantId,
      });

    // Top-level shape is exactly the aggregate contract — no `customer`,
    // `customers`, `email`, `phone`, … key anywhere.
    expect(Object.keys(kpi as object).sort()).toEqual([
      "newThisMonth",
      "reachability",
      "returnRate",
      "segments",
      "total",
    ]);

    // Deep-scan the WHOLE payload: every leaf is a number; no string carrying the
    // seeded PII can have leaked through (the MOAT — never a raw customer / coord
    // / id reaches the resto).
    const leaves: unknown[] = [];
    const walk = (value: unknown): void => {
      if (value !== null && typeof value === "object") {
        for (const v of Object.values(value as Record<string, unknown>)) {
          walk(v);
        }
      } else {
        leaves.push(value);
      }
    };
    walk(kpi);
    for (const leaf of leaves) {
      expect(typeof leaf).toBe("number");
    }
    const serialised = JSON.stringify(kpi);
    for (const pii of [
      "secret@b.fr",
      "+33611112222",
      "Sophie",
      "1 rue secrète",
      String(c.customerId),
    ]) {
      expect(serialised).not.toContain(pii);
    }
  });

  it("the kpi module exposes NO export / bulk / list surface (anti-extraction)", async () => {
    // Machine-enforced: scan the public contract of the customer module. None of
    // its function-like exports may hint at an export / CSV / bulk / nominative
    // list surface (PRD 90 §4, customer-data CONTEXT "Anti-extraction"). The MOAT
    // forbids the code from even *exposing* such a button.
    const customerApi = (api.lib.customer ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const forbidden = /export|csv|excel|bulk|download|listCustomers|dump/i;
    for (const [moduleName, fns] of Object.entries(customerApi)) {
      for (const fnName of Object.keys(fns)) {
        expect(
          forbidden.test(fnName),
          `forbidden extraction-shaped export: api.lib.customer.${moduleName}.${fnName}`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Consultation audit — a companion mutation logs the consult via logAudit.
// (A Convex query cannot write; the resto UI calls this when opening the view.)
// ---------------------------------------------------------------------------

describe("2.1-E logKpiConsultation — audits the consult via foundation logAudit", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("writes ONE auditLog row scoped to the tenant + manager (RGPD trace)", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.customer.kpi.logKpiConsultation, {
        tenantId: seed.tenantA.tenantId,
      });

    const rows = await readAuditLog(t);
    const row = rows.find((r) => r.action === "customer.kpi.consult");
    expect(row).toBeDefined();
    expect(row?.actorUserId).toBe(seed.tenantA.managerId);
    expect(row?.actorRole).toBe("kb_manager");
    expect(row?.tenantId).toBe(seed.tenantA.tenantId);
    expect(typeof row?.timestamp).toBe("number");
  });

  it("does NOT log when the consult is refused (cross-tenant manager)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.customer.kpi.logKpiConsultation, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);

    const rows = await readAuditLog(t);
    expect(
      rows.find((r) => r.action === "customer.kpi.consult"),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz — replay the surface with unauthorized actors (ADR 0010).
// ---------------------------------------------------------------------------

describe("2.1-E cross-tenant fuzz — KPI surface rejects unauthorized actors", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const c = await seedCustomer(t);
    await t.run((ctx) => ctx.db.patch(c.customerId, { email: "a@b.fr" }));
    await linkOrders(t, c.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: Date.now(),
      ltv: 20,
    });
  });

  it("aggregateCustomerKPIs rejects every unauthorized actor on tenant A", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not in allow-list
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.kpi.aggregateCustomerKPIs],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
  });

  it("logKpiConsultation rejects every unauthorized actor on tenant A", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.kpi.logKpiConsultation],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
  });

  it("a manager of tenant B cannot read tenant A's KPI", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .query(api.lib.customer.kpi.aggregateCustomerKPIs, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});
