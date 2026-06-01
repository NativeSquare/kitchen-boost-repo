import { ConvexError, v } from "convex/values";
import { type TenantRole, listTenantOrders, tenantQuery } from "../tenancy";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

/**
 * F-STATS-DASHBOARD [4/8] (#257) — `revenuePerDay` : revenu agrégé jour par
 * jour sur la fenêtre N (7/30/90) pour le LineChart Recharts de la page Stats
 * `/t/[tenantId]/stats` (PRD 70 §4.10, parent epic #151).
 *
 * Surface : `api.lib.stats.revenuePerDay.revenuePerDay({ tenantId, rangeDays })`.
 * `tenantId` est absorbé par le wrapper `tenantQuery({ allow: ["kb_manager",
 * "staff"] })` (sanctionné, ADR 0010/0011) — même politique que `dailyKpis` et
 * `rangeAggregates` : les chiffres stats sont OPÉRATIONNELS (PRD 70 §4.10),
 * staff y a accès. Pas de `getAuthUserId` direct (le wrapper appelle
 * `getCurrentActor` cf. ADR 0011). Pas de raw `ctx.db.query` ici (lint
 * `no-untenanted-query`) — lit via le seam `listTenantOrders`
 * (`lib/tenancy/ordersStore`).
 *
 * Contrat de retour : `Array<{ date: string /* ISO YYYY-MM-DD UTC *​/, revenue:
 * number /* cents *​/ }>` — EXACTEMENT `rangeDays` entrées, triées par date
 * croissante, jours sans commande payée à `revenue: 0`. Le LineChart Recharts
 * a besoin de cette continuité temporelle pour ne pas afficher une courbe
 * trouée (issue body).
 *
 * Définition « par jour » : on bucketize chaque `paidAt` sur le jour UTC
 * correspondant (`startOfDayUtc(paidAt)`). On compte UNIQUEMENT les commandes
 * PAYÉES (`paidAt` set) avec `pricingSnapshot` — une commande encore `en
 * attente de paiement` ne contribue NI au revenu NI à un bucket (PRD 10
 * §10/§11, même règle que `dailyKpis` / `rangeAggregates`).
 *
 * Fenêtre : `[startOfDayUtc(now - (rangeDays - 1) * 24h), endOfDayUtc(now)]`.
 * On émet exactement `rangeDays` buckets dont le dernier est le jour de `now`
 * — cette construction garantit l'invariant testé `out.length === rangeDays`.
 *
 * Range autorisée : `rangeDays ∈ {7, 30, 90}` (les 3 options du RangePicker
 * front, cf. `apps/admin/src/lib/stats-range.ts`). Toute autre valeur →
 * `ConvexError` (refuse les fenêtres custom V1) — 3ᵉ frontière de défense
 * derrière convex.values + le wrapper d'isolation.
 *
 * Coût Convex : `listTenantOrders` parcourt l'index `by_tenant` (cardinalité
 * « commandes d'un resto », petite par construction — quelques dizaines /
 * jour en V1, ~3K sur 90 jours pire cas). Bucketize en mémoire — accepté
 * tant que la cardinalité reste petite ; si elle explose, un index
 * `by_tenant_paidAt` deviendra nécessaire (commun à `rangeAggregates`,
 * traité plus tard).
 */

const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

const ALLOWED_RANGE_DAYS = [7, 30, 90] as const;
type AllowedRangeDays = (typeof ALLOWED_RANGE_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

function isAllowedRange(value: number): value is AllowedRangeDays {
  return (ALLOWED_RANGE_DAYS as readonly number[]).includes(value);
}

/** UTC start-of-day timestamp (ms). */
function startOfDayUtc(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
}

/** ISO YYYY-MM-DD label (UTC) for a given instant. */
function isoDayUtc(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Aggregator extracted from the Convex handler so the (eventual) HTTP / SSR
 * mirror can call it directly without re-routing through the wrapper.
 */
async function computeRevenuePerDay(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  rangeDays: AllowedRangeDays,
): Promise<{ date: string; revenue: number }[]> {
  const todayStart = startOfDayUtc(Date.now());
  // Window covers exactly `rangeDays` UTC buckets ending with today.
  const windowStart = todayStart - (rangeDays - 1) * DAY_MS;

  // Pre-build the empty series so days without orders surface as revenue=0
  // (LineChart continuity, issue body).
  const buckets = new Map<string, number>();
  for (let i = 0; i < rangeDays; i++) {
    const dayMs = windowStart + i * DAY_MS;
    buckets.set(isoDayUtc(dayMs), 0);
  }

  const all: Doc<"orders">[] = await listTenantOrders(ctx, tenantId);
  for (const o of all) {
    if (o.paidAt === undefined) continue;
    if (o.paidAt < windowStart) continue;
    if (o.pricingSnapshot === undefined) continue;
    const dayLabel = isoDayUtc(o.paidAt);
    const prev = buckets.get(dayLabel);
    if (prev === undefined) continue; // beyond today, defensive
    buckets.set(dayLabel, prev + o.pricingSnapshot.total);
  }

  // Sort ascending so the LineChart receives oldest → newest.
  return Array.from(buckets.entries())
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Public Convex query. Wrapper absorbs `tenantId`, resolves the actor via
 * `getCurrentActor` (ADR 0011), enforces the allow-list, and exposes
 * `{ actor, tenantId }` on `ctx`. Cross-tenant fuzz pinned by
 * `revenuePerDay.test.ts` (5 actors × 1 fn, 0 leak).
 */
export const revenuePerDay = tenantQuery(OPERATIONAL_ALLOW)({
  args: { rangeDays: v.number() },
  handler: async (ctx, { rangeDays }) => {
    if (!isAllowedRange(rangeDays)) {
      throw new ConvexError(
        `rangeDays must be one of ${ALLOWED_RANGE_DAYS.join(
          ", ",
        )} (V1 RangePicker contract)`,
      );
    }
    return computeRevenuePerDay(ctx, ctx.tenantId, rangeDays);
  },
});
