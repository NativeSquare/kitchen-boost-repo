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
import { type CustomerOrderStats, computeSegment } from "./segments";

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
 * 2.1-D — Segments (Actif / Inactif / VIP), read-only on `customerOrdersPerTenant`
 * (written by 2.3, never here). TDD red.
 *
 * Thresholds are FROZEN V1 (PRD 90 §3 / customer-data CONTEXT "Segment") — NOT
 * invented here:
 *  - Actif   : ≥1 cmd dans les 30 derniers jours
 *  - Inactif : 0 cmd dans les 90 derniers jours
 *  - VIP     : ≥5 cmds total OU LTV cumulé ≥ 150€ (peu importe récence)
 *
 * `computeSegment` is a PURE rule (no Convex ctx). The per-tenant aggregate query
 * exposes ONLY counts to a `kb_manager` (the MOAT: never a raw `customer`), and is
 * reconstructed from `customerOrdersPerTenant` (which carries `tenantId`).
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

// ---------------------------------------------------------------------------
// computeSegment — pure frozen-threshold rule (PRD 90 §3). No Convex pipeline.
// ---------------------------------------------------------------------------

describe("2.1-D computeSegment — frozen V1 thresholds (PRD 90 §3)", () => {
  const now = 1_000_000 * DAY; // a fixed "now" so the day-math is exact.

  const stats = (
    totalOrders: number,
    daysAgo: number,
    ltv: number,
  ): CustomerOrderStats => ({
    totalOrders,
    lastOrderAt: now - daysAgo * DAY,
    ltv,
  });

  it("Actif: ≥1 cmd in the last 30 days", () => {
    expect(computeSegment(stats(1, 0, 10), now)).toBe("actif");
    expect(computeSegment(stats(2, 29, 40), now)).toBe("actif");
    expect(computeSegment(stats(1, 30, 10), now)).toBe("actif"); // boundary: exactly 30 days still counts
  });

  it("Inactif: 0 cmd in the last 90 days (last order strictly older than 90d)", () => {
    expect(computeSegment(stats(2, 91, 40), now)).toBe("inactif");
    expect(computeSegment(stats(1, 200, 20), now)).toBe("inactif");
  });

  it("the 30–90 day window is neither Actif nor Inactif (between)", () => {
    // 60 days ago: not within 30d (not Actif) and not beyond 90d (not Inactif),
    // and below the VIP thresholds → the explicit "between" bucket.
    expect(computeSegment(stats(2, 60, 40), now)).toBe("entre");
  });

  it("VIP by order count: ≥5 cmds total regardless of recency", () => {
    expect(computeSegment(stats(5, 200, 20), now)).toBe("vip");
    expect(computeSegment(stats(9, 365, 10), now)).toBe("vip");
  });

  it("VIP by LTV: cumulative LTV ≥ 150€ regardless of recency", () => {
    expect(computeSegment(stats(1, 365, 150), now)).toBe("vip");
    expect(computeSegment(stats(2, 365, 300), now)).toBe("vip");
  });

  it("VIP takes precedence over Actif (a VIP who also ordered recently is VIP)", () => {
    expect(computeSegment(stats(6, 1, 200), now)).toBe("vip");
  });

  it("just below the VIP thresholds is NOT VIP", () => {
    // 4 orders (< 5) and 149€ (< 150) and last order 200d ago → inactif, not VIP.
    expect(computeSegment(stats(4, 200, 149), now)).toBe("inactif");
  });
});

// ---------------------------------------------------------------------------
// Per-tenant aggregate query — counts only (MOAT), reconstructed from the link.
// ---------------------------------------------------------------------------

describe("2.1-D segmentCounts — per-tenant aggregate, counts only (MOAT)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("classifies a tenant's customers into Actif / Inactif / VIP counts", async () => {
    const now = Date.now();
    const actif = await seedCustomer(t);
    const inactif = await seedCustomer(t);
    const vip = await seedCustomer(t);
    await linkOrders(t, actif.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: now - 5 * DAY,
      ltv: 20,
    });
    await linkOrders(t, inactif.customerId, seed.tenantA.tenantId, {
      totalOrders: 2,
      lastOrderAt: now - 120 * DAY,
      ltv: 40,
    });
    await linkOrders(t, vip.customerId, seed.tenantA.tenantId, {
      totalOrders: 6,
      lastOrderAt: now - 200 * DAY,
      ltv: 300,
    });

    const counts = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.segments.segmentCounts, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(counts).toEqual({ actif: 1, inactif: 1, vip: 1, total: 3 });
  });

  it("a customer who ordered at tenant A is NOT counted at tenant B (isolation)", async () => {
    const now = Date.now();
    const c = await seedCustomer(t);
    await linkOrders(t, c.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: now - 1 * DAY,
      ltv: 20,
    });

    const bCounts = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .query(api.lib.customer.segments.segmentCounts, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(bCounts).toEqual({ actif: 0, inactif: 0, vip: 0, total: 0 });
  });

  it("returns plain counts, never a raw customer object (MOAT guard)", async () => {
    const now = Date.now();
    const c = await seedCustomer(t);
    await linkOrders(t, c.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: now - 1 * DAY,
      ltv: 20,
    });
    const counts: unknown = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.customer.segments.segmentCounts, {
        tenantId: seed.tenantA.tenantId,
      });
    // The shape is exactly {actif, inactif, vip, total}: numbers only, no nested
    // object that could carry email / phone / userId of a customer to the resto.
    expect(Object.keys(counts as object).sort()).toEqual([
      "actif",
      "inactif",
      "total",
      "vip",
    ]);
    for (const v of Object.values(counts as Record<string, unknown>)) {
      expect(typeof v).toBe("number");
    }
  });

  it("a kb_admin (root) can read the counts for any tenant", async () => {
    const counts = await t
      .withIdentity({ subject: seed.adminId })
      .query(api.lib.customer.segments.segmentCounts, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(counts).toEqual({ actif: 0, inactif: 0, vip: 0, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz — replay the aggregate with unauthorized actors (ADR 0010).
// ---------------------------------------------------------------------------

describe("2.1-D cross-tenant fuzz — segmentCounts rejects unauthorized actors", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const c = await seedCustomer(t);
    await linkOrders(t, c.customerId, seed.tenantA.tenantId, {
      totalOrders: 1,
      lastOrderAt: Date.now(),
      ltv: 20,
    });
  });

  it("every unauthorized actor is refused reading tenant A's counts", async () => {
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "A-staff", subject: seed.tenantA.staffId }, // staff not in allow-list
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.segments.segmentCounts],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
  });

  it("a manager of tenant B cannot read tenant A's counts", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .query(api.lib.customer.segments.segmentCounts, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});
