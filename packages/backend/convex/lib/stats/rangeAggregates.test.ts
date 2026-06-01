/**
 * F-STATS-DASHBOARD (#253) — `rangeAggregates` query : 2 chiffres bruts
 * agrégés sur la fenêtre de N jours (panier moyen + total commandes) pour la
 * page Stats `/t/[tenantId]/stats`.
 *
 * Surface : `api.lib.stats.rangeAggregates.rangeAggregates({ tenantId,
 * rangeDays })` — `tenantId` est absorbé par le wrapper `tenantQuery({ allow:
 * ["kb_manager", "staff"] })` (sanctionné, ADR 0010/0011). Les commandes
 * sont lues via le seam `listTenantOrders` (`lib/tenancy/ordersStore` — seul
 * site `ctx.db` autorisé pour la table `orders` cf. ADR 0010 / lint
 * `no-untenanted-query`).
 *
 * Définition « sur la fenêtre » : agrège toutes les commandes `paidAt >= now
 * - rangeDays * 24h`. Même règle que `dailyKpis` : on compte les commandes
 * PAYÉES (`paidAt` set) — une commande encore `en attente de paiement` ne
 * contribue NI au CA NI au compteur (PRD 10 §10/§11).
 *
 * Range autorisée : `rangeDays ∈ {7, 30, 90}` (les 3 options du RangePicker
 * front, ADR / PRD 70 §4.10). Toute autre valeur → throw (refuse les
 * fenêtres custom V1).
 *
 * Tests obligatoires (issue body) :
 *  - cas vide → 0 partout ;
 *  - cas peuplé → panierMoyen + totalCommandes calculés correctement ;
 *  - fenêtre exclut les commandes hors-range ;
 *  - **cross-tenant fuzz** : aucun acteur non autorisé ne traverse le
 *    wrapper (MOAT, cf. `dailyKpis.test.ts`).
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

describe("F-STATS-DASHBOARD (#253) — rangeAggregates aggregation", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater@x.fr");
  });

  it("empty: panierMoyen + totalCommandes are 0 when the tenant has no paid order in range", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 30 },
    );
    expect(out).toEqual({ panierMoyen: 0, totalCommandes: 0 });
  });

  it("aggregates paid orders within the range: panierMoyen = CA/nb (floor cents), totalCommandes = count", async () => {
    const now = Date.now();
    // 3 orders within the last 7 days.
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
      paidAt: now - 2 * DAY_MS,
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 3000,
      paidAt: now - 3 * DAY_MS,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out = await asManager.query(
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    expect(out.totalCommandes).toBe(3);
    // 7000/3 = 2333.33… → floor → 2333.
    expect(out.panierMoyen).toBe(Math.floor(7000 / 3));
  });

  it("excludes orders OUTSIDE the range (rangeDays=7 ignores a 30-day-old order)", async () => {
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
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    expect(out.totalCommandes).toBe(1);
    expect(out.panierMoyen).toBe(1000);
  });

  it("rangeDays=30 captures orders within the last 30 days that the 7-day window excluded", async () => {
    const now = Date.now();
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 2000,
      paidAt: now - 20 * DAY_MS,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const out30 = await asManager.query(
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 30 },
    );
    expect(out30.totalCommandes).toBe(1);
    expect(out30.panierMoyen).toBe(2000);
    const out7 = await asManager.query(
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 7 },
    );
    expect(out7.totalCommandes).toBe(0);
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
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 30 },
    );
    expect(out.totalCommandes).toBe(1);
    expect(out.panierMoyen).toBe(1000);
  });

  it("isolation: tenant A's aggregates never include tenant B's orders", async () => {
    const customerB = await seedCustomer(t, "b@x.fr");
    await seedPaidOrder(t, {
      tenantId: seed.tenantB.tenantId,
      customerId: customerB,
      totalCents: 5000,
      paidAt: Date.now() - 1 * DAY_MS,
    });

    const asAManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const outA = await asAManager.query(
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 30 },
    );
    expect(outA.totalCommandes).toBe(0);

    const asBManager = t.withIdentity({ subject: seed.tenantB.managerId });
    const outB = await asBManager.query(
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantB.tenantId, rangeDays: 30 },
    );
    expect(outB.totalCommandes).toBe(1);
    expect(outB.panierMoyen).toBe(5000);
  });

  it("staff can read the aggregates (operational role) — same view as the manager", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 4200,
      paidAt: Date.now() - 1 * DAY_MS,
    });

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const out = await asStaff.query(
      api.lib.stats.rangeAggregates.rangeAggregates,
      { tenantId: seed.tenantA.tenantId, rangeDays: 30 },
    );
    expect(out.totalCommandes).toBe(1);
    expect(out.panierMoyen).toBe(4200);
  });

  it("rejects unsupported rangeDays values (V1 enforces {7, 30, 90})", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.query(api.lib.stats.rangeAggregates.rangeAggregates, {
        tenantId: seed.tenantA.tenantId,
        rangeDays: 14,
      }),
    ).rejects.toThrow();
  });
});

describe("F-STATS-DASHBOARD (#253) — cross-tenant fuzz (MOAT, ADR 0010)", () => {
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

  it("rejects every unauthorized actor calling rangeAggregates on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.stats.rangeAggregates.rangeAggregates],
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
