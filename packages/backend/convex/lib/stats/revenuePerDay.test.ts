/**
 * F-STATS-DASHBOARD [4/8] (#257) — `revenuePerDay` query : revenu agrégé jour
 * par jour sur la fenêtre N (7/30/90) pour le LineChart de la page Stats
 * `/t/[tenantId]/stats`.
 *
 * Surface : `api.lib.stats.revenuePerDay.revenuePerDay({ tenantId, rangeDays })`
 * — `tenantId` est absorbé par le wrapper `tenantQuery({ allow:
 * ["kb_manager", "staff"] })` (sanctionné, ADR 0010/0011). Lit les commandes
 * via le seam `listTenantOrders` (`lib/tenancy/ordersStore`).
 *
 * Contrat de retour : Array<{ date: string /* ISO YYYY-MM-DD *​/, revenue:
 * number }> — UNE entrée par jour de la fenêtre, jours sans commande payée =
 * `revenue: 0` (continuité temporelle pour le LineChart Recharts). Trié par
 * date croissante.
 *
 * Tests obligatoires (issue body) :
 *  - cas vide → N entrées toutes à 0 (continuité) ;
 *  - cas peuplé → revenu agrégé correctement par jour UTC ;
 *  - jours sans commande remplis à 0 ;
 *  - exclut commandes hors fenêtre ;
 *  - exclut commandes en attente de paiement (pas de paidAt) ;
 *  - isolation tenant A ↔ B ;
 *  - rejette rangeDays hors {7, 30, 90} ;
 *  - **cross-tenant fuzz** : aucun acteur non autorisé ne traverse le wrapper
 *    (MOAT, cf. pattern existant dans `rangeAggregates.test.ts`).
 */
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

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/stats/${path.slice(2)}` : path,
    loader,
  ]),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    return ctx.db.insert("customers", { userId, email, createdAt: Date.now() });
  });
}

async function seedPaidOrder(
  t: ReturnType<typeof convexTest>,
  args: {
    tenantId: Id<"tenants">;
    customerId: Id<"customers">;
    totalCents: number;
    paidAt: number;
  },
): Promise<Id<"orders">> {
  return t.run(async (ctx) =>
    ctx.db.insert("orders", {
      tenantId: args.tenantId,
      customerId: args.customerId,
      status: "livrée",
      mode: "delivery",
      source: "direct",
      pricingSnapshot: {
        subtotal: args.totalCents,
        deliveryFee: 0,
        total: args.totalCents,
      },
      createdAt: args.paidAt,
      paidAt: args.paidAt,
    }),
  );
}

async function seedPendingOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
): Promise<Id<"orders">> {
  return t.run(async (ctx) =>
    ctx.db.insert("orders", {
      tenantId,
      customerId,
      status: "en attente de paiement",
      mode: "delivery",
      source: "direct",
      createdAt: Date.now(),
    }),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDayUtc(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("F-STATS-DASHBOARD (#257) — revenuePerDay aggregation", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater@x.fr");
  });

  it("empty: returns rangeDays entries all at revenue=0 (temporal continuity)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    expect(out).toHaveLength(7);
    for (const entry of out) {
      expect(entry.revenue).toBe(0);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns exactly rangeDays entries for each window value (7, 30, 90)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    for (const rangeDays of [7, 30, 90] as const) {
      const out = await asManager.query(
        api.lib.stats.revenuePerDay.revenuePerDay,
        { tenantId: seed.tenantA.tenantId, rangeDays },
      );
      expect(out).toHaveLength(rangeDays);
    }
  });

  it("entries are sorted by date ascending (oldest first)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i].date > out[i - 1].date).toBe(true);
    }
  });

  it("aggregates paid orders into the correct UTC day", async () => {
    const now = Date.now();
    // Two orders on the same day → revenue sums on that day.
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1500,
      paidAt: now - 1 * DAY_MS,
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 2500,
      paidAt: now - 1 * DAY_MS + 60_000,
    });
    // One order on another day.
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 3000,
      paidAt: now - 3 * DAY_MS,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    const totalRevenue = out.reduce((acc, e) => acc + e.revenue, 0);
    expect(totalRevenue).toBe(1500 + 2500 + 3000);

    const dayMinus1 = isoDayUtc(now - 1 * DAY_MS);
    const entryMinus1 = out.find((e) => e.date === dayMinus1);
    expect(entryMinus1).toBeDefined();
    expect(entryMinus1?.revenue).toBe(4000);

    const dayMinus3 = isoDayUtc(now - 3 * DAY_MS);
    const entryMinus3 = out.find((e) => e.date === dayMinus3);
    expect(entryMinus3).toBeDefined();
    expect(entryMinus3?.revenue).toBe(3000);
  });

  it("fills days without paid orders at revenue=0 (gap continuity for LineChart)", async () => {
    const now = Date.now();
    // Only ONE order in the window (3 days ago).
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 5000,
      paidAt: now - 3 * DAY_MS,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    expect(out).toHaveLength(7);
    const zeroEntries = out.filter((e) => e.revenue === 0);
    // 6 days at 0, 1 day at 5000.
    expect(zeroEntries).toHaveLength(6);
    const nonZero = out.filter((e) => e.revenue > 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0].revenue).toBe(5000);
  });

  it("excludes orders OUTSIDE the range (a 30-day-old order is not in rangeDays=7)", async () => {
    const now = Date.now();
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 9999,
      paidAt: now - 30 * DAY_MS,
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: now - 1 * DAY_MS,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    const total = out.reduce((acc, e) => acc + e.revenue, 0);
    expect(total).toBe(1000);
  });

  it("excludes pending (en attente de paiement) orders (no paidAt → not counted)", async () => {
    const now = Date.now();
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: now - 1 * DAY_MS,
    });
    await seedPendingOrder(t, seed.tenantA.tenantId, customerA);

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantA.tenantId, rangeDays: 30 },
    );
    const total = out.reduce((acc, e) => acc + e.revenue, 0);
    expect(total).toBe(1000);
  });

  it("isolation: tenant A's series never includes tenant B's orders", async () => {
    const customerB = await seedCustomer(t, "b@x.fr");
    await seedPaidOrder(t, {
      tenantId: seed.tenantB.tenantId,
      customerId: customerB,
      totalCents: 5000,
      paidAt: Date.now() - 1 * DAY_MS,
    });

    const asAManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const outA = await asAManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantA.tenantId, rangeDays: 30 },
    );
    const totalA = outA.reduce((acc, e) => acc + e.revenue, 0);
    expect(totalA).toBe(0);

    const asBManager = t.withIdentity({ subject: seed.tenantB.managerId });
    const outB = await asBManager.query(
      api.lib.stats.revenuePerDay.revenuePerDay,
      { tenantId: seed.tenantB.tenantId, rangeDays: 30 },
    );
    const totalB = outB.reduce((acc, e) => acc + e.revenue, 0);
    expect(totalB).toBe(5000);
  });

  it("staff can read the series (operational role) — same view as the manager", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 4200,
      paidAt: Date.now() - 1 * DAY_MS,
    });

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const out = await asStaff.query(api.lib.stats.revenuePerDay.revenuePerDay, {
      tenantId: seed.tenantA.tenantId,
      rangeDays: 30,
    });
    const total = out.reduce((acc, e) => acc + e.revenue, 0);
    expect(total).toBe(4200);
  });

  it("rejects unsupported rangeDays values (V1 enforces {7, 30, 90})", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.query(api.lib.stats.revenuePerDay.revenuePerDay, {
        tenantId: seed.tenantA.tenantId,
        rangeDays: 14,
      }),
    ).rejects.toThrow();
  });
});

describe("F-STATS-DASHBOARD (#257) — cross-tenant fuzz (MOAT, ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerA = await seedCustomer(t, "fuzz@x.fr");
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1234,
      paidAt: Date.now() - 1 * DAY_MS,
    });
  });

  it("rejects every unauthorized actor calling revenuePerDay on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.stats.revenuePerDay.revenuePerDay],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { rangeDays: 30 },
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });
});
