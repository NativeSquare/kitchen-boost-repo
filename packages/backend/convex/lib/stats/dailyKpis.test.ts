/**
 * F-STATS-DASHBOARD (#252) — `dailyKpis` query : 4 KPI agrégés du JOUR pour
 * un tenant (CA total, nb commandes, panier moyen, commandes en cours).
 *
 * Surface : `api.lib.stats.dailyKpis.dailyKpis({ tenantId })` — `tenantId` est
 * absorbé par le wrapper `tenantQuery({ allow: ["kb_manager", "staff"] })`
 * (sanctionné, ADR 0010/0011). Les commandes en cours sont lues via le seam
 * `listTenantLiveOrders` (`lib/tenancy/ordersStore` — seul site `ctx.db`
 * autorisé pour la table `orders` cf. ADR 0010 / lint `no-untenanted-query`).
 *
 * Définition « du jour » : agrège toutes les commandes `paidAt >= start-of-day
 * (UTC)`. On compte les commandes PAYÉES (`paidAt` set) — une commande encore
 * `en attente de paiement` ne contribue NI au CA NI au compteur de commandes
 * (la résiliation ferait diverger les chiffres du caissier).
 *
 * « Commandes en cours » = `listTenantLiveOrders` (toutes les commandes non
 * terminales hors `en attente de paiement`) — le pulse opérationnel kitchen.
 *
 * Tests obligatoires (issue body) :
 *  - cas vide → tous les chiffres à 0 ;
 *  - cas peuplé → CA/nb/panier moyen calculés correctement ;
 *  - `commandesEnCours` reflète `listTenantLiveOrders` ;
 *  - **cross-tenant fuzz** : aucun acteur non autorisé ne traverse le wrapper
 *    (pattern existant `customerKpis.test.ts` n'est pas disponible — on suit
 *    `orders.test.ts` qui est l'exemple canonique le plus proche).
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

/** Seed a global `customers` row (FK for the order). */
async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    return ctx.db.insert("customers", { userId, email, createdAt: Date.now() });
  });
}

/**
 * Place an order on `tenantId` and confirm it as paid with the given
 * `totalCents` and a `paidAt` instant. Bypasses the 2.5 Stripe frontier
 * (irrelevant here — we test the aggregator, not the payment path) by writing
 * the row + the workflow status directly via `ctx.db` IN THE TEST harness (the
 * `lib/tenancy/*Store` exemption applies only to production code; tests are
 * exempt from `no-untenanted-query` by config).
 */
async function seedPaidOrder(
  t: ReturnType<typeof convexTest>,
  args: {
    tenantId: Id<"tenants">;
    customerId: Id<"customers">;
    totalCents: number;
    paidAt: number;
    status?:
      | "nouvelle"
      | "en préparation"
      | "prête"
      | "remise"
      | "livrée"
      | "collectée"
      | "refusée";
  },
): Promise<Id<"orders">> {
  return t.run(async (ctx) =>
    ctx.db.insert("orders", {
      tenantId: args.tenantId,
      customerId: args.customerId,
      status: args.status ?? "nouvelle",
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

/** Seed an order STILL in `en attente de paiement` (not counted in the KPIs). */
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

/** Today, anchored at noon UTC (well inside the day window the query looks at). */
function todayNoonUtc(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12,
    0,
    0,
  );
}

/** Yesterday, anchored at noon UTC (well BEFORE today's window — never counted). */
function yesterdayNoonUtc(): number {
  return todayNoonUtc() - 24 * 60 * 60 * 1000;
}

describe("F-STATS-DASHBOARD (#252) — dailyKpis aggregation", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater@x.fr");
  });

  it("empty: every KPI is 0 when the tenant has no order today", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const kpis = await asManager.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(kpis).toEqual({
      caTotal: 0,
      nbCommandes: 0,
      panierMoyen: 0,
      commandesEnCours: 0,
    });
  });

  it("aggregates today's paid orders: CA = sum(total), nb = count, panierMoyen = CA/nb (floor cents)", async () => {
    const noon = todayNoonUtc();
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1500,
      paidAt: noon,
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 2500,
      paidAt: noon + 60_000,
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 3000,
      paidAt: noon + 120_000,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const kpis = await asManager.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(kpis.caTotal).toBe(7000);
    expect(kpis.nbCommandes).toBe(3);
    // 7000/3 = 2333.33… ⇒ floor at the cent ⇒ 2333.
    expect(kpis.panierMoyen).toBe(Math.floor(7000 / 3));
  });

  it("excludes yesterday's orders from today's KPIs", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 9999,
      paidAt: yesterdayNoonUtc(),
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: todayNoonUtc(),
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const kpis = await asManager.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(kpis.caTotal).toBe(1000);
    expect(kpis.nbCommandes).toBe(1);
    expect(kpis.panierMoyen).toBe(1000);
  });

  it("excludes pending (en attente de paiement) orders from CA/nb (no paidAt)", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: todayNoonUtc(),
    });
    await seedPendingOrder(t, seed.tenantA.tenantId, customerA);

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const kpis = await asManager.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(kpis.caTotal).toBe(1000);
    expect(kpis.nbCommandes).toBe(1);
  });

  it("commandesEnCours: counts orders in the LIVE kitchen queue (not pending, not terminal)", async () => {
    const noon = todayNoonUtc();
    // 2 live (nouvelle / en préparation) — count.
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: noon,
      status: "nouvelle",
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: noon,
      status: "en préparation",
    });
    // Terminal → never in `commandesEnCours`.
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: noon,
      status: "livrée",
    });
    // Pending (en attente de paiement) → invisible to the kitchen, NOT live.
    await seedPendingOrder(t, seed.tenantA.tenantId, customerA);

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const kpis = await asManager.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(kpis.commandesEnCours).toBe(2);
  });

  it("isolation: tenant A's KPIs never include tenant B's orders", async () => {
    const customerB = await seedCustomer(t, "b@x.fr");
    await seedPaidOrder(t, {
      tenantId: seed.tenantB.tenantId,
      customerId: customerB,
      totalCents: 5000,
      paidAt: todayNoonUtc(),
    });

    const asAManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const kpisA = await asAManager.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(kpisA.caTotal).toBe(0);
    expect(kpisA.nbCommandes).toBe(0);

    const asBManager = t.withIdentity({ subject: seed.tenantB.managerId });
    const kpisB = await asBManager.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(kpisB.caTotal).toBe(5000);
    expect(kpisB.nbCommandes).toBe(1);
  });

  it("staff can read the KPIs (operational role) — same view as the manager", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 4200,
      paidAt: todayNoonUtc(),
    });

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const kpis = await asStaff.query(api.lib.stats.dailyKpis.dailyKpis, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(kpis.caTotal).toBe(4200);
    expect(kpis.nbCommandes).toBe(1);
  });
});

describe("F-STATS-DASHBOARD (#252) — cross-tenant fuzz (MOAT, ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerA = await seedCustomer(t, "fuzz@x.fr");
    // Seed some data on tenant A so the read path has something to (not) leak.
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1234,
      paidAt: todayNoonUtc(),
    });
  });

  it("rejects every unauthorized actor calling dailyKpis on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.stats.dailyKpis.dailyKpis],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });
});
