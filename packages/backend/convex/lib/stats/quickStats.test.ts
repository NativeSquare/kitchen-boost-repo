/**
 * #410 — `quickStats` query : 4 KPI minimalistes (CA jour + nb cmds jour + CA
 * semaine + CA semaine précédente) pour la home native KB Orders (PRD 20 §9).
 *
 * Surface : `api.lib.stats.quickStats.quickStats({ tenantId })` — `tenantId`
 * est absorbé par le wrapper `tenantQuery({ allow: ["kb_manager", "staff"] })`
 * (sanctionné, ADR 0010/0011).
 *
 * Différence avec `dailyKpis` (#252) : on EXCLUT `refusée` et `auto_expired`
 * — PRD 20 §9 « c'est du CA réalisé ». Seuls les états terminaux `livrée` et
 * `collectée` comptent dans le CA + le nb cmds. `dailyKpis` réutilisé pour la
 * KB Admin (différent contrat : tout `paidAt` set, panier moyen) — donc on
 * crée bien une query dédiée plutôt que d'altérer le contrat existant.
 *
 * Définitions temporelles :
 *  - « du jour » : `paidAt >= startOfDayUtc(now)` ;
 *  - « cette semaine » : `paidAt >= startOfWeekUtcMonday(now)` (lundi 00:00 UTC) ;
 *  - « semaine précédente » : `paidAt ∈ [prevMonday, currentMonday)`.
 *
 * Le delta % est calculé CÔTÉ CLIENT (logique pure dans `decide-quick-stats`)
 * pour permettre des tests rapides sans Convex et garder ce backend trivial.
 *
 * Tests pinned :
 *  - cas vide → 0 partout ;
 *  - exclut `refusée` / `auto_expired` (CA réalisé only) ;
 *  - exclut `en attente de paiement` (pas de paidAt) ;
 *  - exclut hier (hors jour mais peut être dans la semaine) ;
 *  - exclut semaine d'avant (CA semaine n'inclut pas la S-1) ;
 *  - caPrevWeek bien calculé sur la fenêtre `[prevMonday, currentMonday)` ;
 *  - staff peut lire (même politique que `dailyKpis`) ;
 *  - **cross-tenant fuzz** (MOAT, ADR 0010).
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
 * Insert a paid order with a chosen `paidAt` and `status`. Bypasses the
 * payment frontier — same harness convention as `dailyKpis.test.ts` /
 * `rangeAggregates.test.ts`.
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
      | "refusée"
      | "auto_expired";
  },
): Promise<Id<"orders">> {
  return t.run(async (ctx) =>
    ctx.db.insert("orders", {
      tenantId: args.tenantId,
      customerId: args.customerId,
      status: args.status ?? "livrée",
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

/** Start-of-day UTC for the wall-clock instant. Mirror of the backend helper. */
function startOfDayUtc(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
}

/**
 * Start-of-week UTC (Monday 00:00 UTC) for the wall-clock instant.
 * `getUTCDay()` returns 0 (Sunday) … 6 (Saturday) — we shift to a Monday-based
 * index where Monday = 0 and Sunday = 6, matching PRD 20 §9 « lundi 00:00 ».
 */
function startOfWeekUtcMonday(nowMs: number): number {
  const sod = startOfDayUtc(nowMs);
  const d = new Date(sod);
  const dow = d.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dow + 6) % 7; // Mon = 0, Tue = 1, …, Sun = 6
  return sod - daysSinceMonday * 24 * 60 * 60 * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today at noon UTC — well inside today's day & week windows. */
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

describe("#410 — quickStats aggregation (PRD 20 §9)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater@x.fr");
  });

  it("empty: every KPI is 0 when the tenant has no order", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const stats = await asManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats).toEqual({
      caToday: 0,
      ordersToday: 0,
      caWeek: 0,
      caPrevWeek: 0,
    });
  });

  it("counts livrée + collectée in CA today / nb orders today", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1500,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 2500,
      paidAt: todayNoonUtc() + 60_000,
      status: "collectée",
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const stats = await asManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats.caToday).toBe(4000);
    expect(stats.ordersToday).toBe(2);
  });

  it("EXCLUDES refusée + auto_expired (CA réalisé only — PRD 20 §9)", async () => {
    // 1 livrée → counted
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });
    // 1 refusée → NOT counted (signal business)
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 9999,
      paidAt: todayNoonUtc(),
      status: "refusée",
    });
    // 1 auto_expired → NOT counted (signal opérationnel)
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 8888,
      paidAt: todayNoonUtc(),
      status: "auto_expired",
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const stats = await asManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats.caToday).toBe(1000);
    expect(stats.ordersToday).toBe(1);
  });

  it("EXCLUDES in-progress orders (nouvelle / en préparation / prête / remise) — not realized yet", async () => {
    // Same definition as F-STATS-DASHBOARD: CA = realized only. An order
    // mid-workflow is NOT counted (the kitchen still owes the work).
    for (const status of [
      "nouvelle",
      "en préparation",
      "prête",
      "remise",
    ] as const) {
      await seedPaidOrder(t, {
        tenantId: seed.tenantA.tenantId,
        customerId: customerA,
        totalCents: 1000,
        paidAt: todayNoonUtc(),
        status,
      });
    }
    // 1 livrée → the only one counted
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 500,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const stats = await asManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats.caToday).toBe(500);
    expect(stats.ordersToday).toBe(1);
  });

  it("excludes en attente de paiement (no paidAt)", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });
    await seedPendingOrder(t, seed.tenantA.tenantId, customerA);

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const stats = await asManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats.caToday).toBe(1000);
    expect(stats.ordersToday).toBe(1);
  });

  it("CA week includes today + earlier days of the same week (since Monday 00:00 UTC)", async () => {
    const now = Date.now();
    const startOfWeek = startOfWeekUtcMonday(now);

    // Today (livrée 1000) — in week & in day
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1000,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });
    // Yesterday-ish but still in this week if today isn't Monday;
    // we anchor a point at startOfWeek + 1h so it's always in the week.
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 3000,
      paidAt: startOfWeek + 60 * 60 * 1000,
      status: "livrée",
    });
    // Last week (prev Monday + 1h) — NOT in caWeek, IS in caPrevWeek
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 5000,
      paidAt: startOfWeek - 7 * DAY_MS + 60 * 60 * 1000,
      status: "livrée",
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const stats = await asManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats.caWeek).toBe(4000);
    expect(stats.caPrevWeek).toBe(5000);
  });

  it("caPrevWeek bounded `[prevMonday, currentMonday)` — order BEFORE prev Monday is excluded", async () => {
    const now = Date.now();
    const startOfWeek = startOfWeekUtcMonday(now);
    const startOfPrevWeek = startOfWeek - 7 * DAY_MS;

    // 1h BEFORE prevMonday → outside both windows
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 7777,
      paidAt: startOfPrevWeek - 60 * 60 * 1000,
      status: "livrée",
    });
    // Inside prev week
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1234,
      paidAt: startOfPrevWeek + 60 * 60 * 1000,
      status: "livrée",
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const stats = await asManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats.caPrevWeek).toBe(1234);
    expect(stats.caWeek).toBe(0);
  });

  it("staff can read the quickStats (operational role, same policy as dailyKpis)", async () => {
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 4200,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });

    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    const stats = await asStaff.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(stats.caToday).toBe(4200);
    expect(stats.ordersToday).toBe(1);
  });

  it("isolation: tenant A never sees tenant B's orders", async () => {
    const customerB = await seedCustomer(t, "b@x.fr");
    await seedPaidOrder(t, {
      tenantId: seed.tenantB.tenantId,
      customerId: customerB,
      totalCents: 5000,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });

    const asAManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const statsA = await asAManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(statsA.caToday).toBe(0);
    expect(statsA.ordersToday).toBe(0);
    expect(statsA.caWeek).toBe(0);

    const asBManager = t.withIdentity({ subject: seed.tenantB.managerId });
    const statsB = await asBManager.query(api.lib.stats.quickStats.quickStats, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(statsB.caToday).toBe(5000);
    expect(statsB.ordersToday).toBe(1);
  });
});

describe("#410 — cross-tenant fuzz (MOAT, ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const customerA = await seedCustomer(t, "fuzz@x.fr");
    // Seed some data so the read path has something to (not) leak.
    await seedPaidOrder(t, {
      tenantId: seed.tenantA.tenantId,
      customerId: customerA,
      totalCents: 1234,
      paidAt: todayNoonUtc(),
      status: "livrée",
    });
  });

  it("rejects every unauthorized actor calling quickStats on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.stats.quickStats.quickStats],
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
