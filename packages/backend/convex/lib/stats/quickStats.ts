import { type TenantRole, listTenantOrders, tenantQuery } from "../tenancy";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

/**
 * #410 — `quickStats` : 4 KPI minimalistes pour la home native KB Orders
 * (PRD 20 §9 « Stats rapides V1 »).
 *
 *  - `caToday`     : chiffre d'affaires du jour, en cents, sur les états
 *                    terminaux `livrée` + `collectée` UNIQUEMENT (PRD 20 §9
 *                    « c'est du CA réalisé »).
 *  - `ordersToday` : nombre de commandes du jour, même filtre (entier).
 *  - `caWeek`      : CA cette semaine en cents (depuis lundi 00:00 UTC),
 *                    même filtre.
 *  - `caPrevWeek`  : CA semaine précédente en cents
 *                    (`[prevMonday, currentMonday)`), même filtre. Le delta %
 *                    + le pourcentage sont dérivés CÔTÉ CLIENT
 *                    (`decideQuickStats`) — logique pure, testable sans
 *                    Convex.
 *
 * Différence vs `dailyKpis` (#252) : `dailyKpis` compte TOUS les `paidAt`
 * sets (incluant `refusée` + `auto_expired` + in-progress) — il sert le KB
 * Admin dashboard avec panier moyen et commandes en cours. Le contrat est
 * fondamentalement différent (CA brut payé vs CA réalisé) ; on n'altère pas
 * `dailyKpis` (déjà consommé par F-STATS-DASHBOARD `apps/admin`) et on
 * publie une query séparée que la home native consomme via sub temps réel.
 *
 * Wrapper RBAC : `tenantQuery({ allow: ["kb_manager", "staff"] })`. Même
 * politique que `dailyKpis` / `rangeAggregates` — un staff cuisinier
 * consulte le même tableau que le gérant (PRD 20 §1c audit monolithique).
 * `kb_admin` passe via le root override.
 *
 * Isolation (ADR 0010 — MOAT) : `tenantId` injecté par le wrapper ; les reads
 * passent EXCLUSIVEMENT par le seam sanctionné `listTenantOrders`
 * (`lib/tenancy/ordersStore`) — pas de `getAuthUserId` direct (le wrapper
 * appelle `getCurrentActor` cf. ADR 0011) et pas de raw `ctx.db.query` ici
 * (lint `no-untenanted-query` actif sur `convex/**` hors `lib/tenancy/*`).
 *
 * Coût Convex : `listTenantOrders` parcourt l'index `by_tenant` (cardinalité
 * « commandes d'un resto », petite par construction — quelques dizaines/jour
 * en V1, ~3K sur 90 jours pire cas). Filtre `paidAt >= start` + status en
 * mémoire — accepté tant que la cardinalité reste petite ; si elle explose,
 * un index `by_tenant_paidAt` deviendra nécessaire (out-of-scope ici, cf.
 * la même note dans `dailyKpis.ts` / `rangeAggregates.ts`).
 */

const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

/** Les états terminaux qui comptent dans le CA réalisé (PRD 20 §9). */
const REALIZED_ORDER_STATUSES = new Set<Doc<"orders">["status"]>([
  "livrée",
  "collectée",
]);

/** UTC start-of-day timestamp (ms) for the given instant. */
function startOfDayUtc(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
}

/**
 * UTC start-of-week (Monday 00:00 UTC) timestamp (ms) for the given instant.
 * `getUTCDay()` returns 0 (Sunday) … 6 (Saturday) — we shift to a Monday-based
 * index where Monday = 0 and Sunday = 6, matching PRD 20 §9 « lundi 00:00 ».
 */
function startOfWeekUtcMonday(nowMs: number): number {
  const sod = startOfDayUtc(nowMs);
  const d = new Date(sod);
  const dow = d.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  return sod - daysSinceMonday * 24 * 60 * 60 * 1000;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Aggregator extracted from the Convex handler so the (eventual) HTTP / SSR
 * mirror can call it directly without re-routing through the wrapper. Single
 * fetch through the sanctioned seam, then a single pass over the rows that
 * routes each order to its time bucket.
 */
async function computeQuickStats(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
): Promise<{
  caToday: number;
  ordersToday: number;
  caWeek: number;
  caPrevWeek: number;
}> {
  const now = Date.now();
  const startOfToday = startOfDayUtc(now);
  const startOfWeek = startOfWeekUtcMonday(now);
  const startOfPrevWeek = startOfWeek - WEEK_MS;

  const all: Doc<"orders">[] = await listTenantOrders(ctx, tenantId);

  let caToday = 0;
  let ordersToday = 0;
  let caWeek = 0;
  let caPrevWeek = 0;
  for (const o of all) {
    if (o.paidAt === undefined) continue;
    if (o.pricingSnapshot === undefined) continue;
    // CA réalisé only — `refusée`/`auto_expired`/in-progress excluded (PRD
    // 20 §9). A refused or auto-expired order is paid (it has `paidAt`) but
    // refunded; counting it would inflate the CA the gérant sees.
    if (!REALIZED_ORDER_STATUSES.has(o.status)) continue;

    const total = o.pricingSnapshot.total;
    if (o.paidAt >= startOfToday) {
      caToday += total;
      ordersToday += 1;
    }
    if (o.paidAt >= startOfWeek) {
      caWeek += total;
    } else if (o.paidAt >= startOfPrevWeek) {
      // `paidAt < startOfWeek` is implied by the `else` — caPrevWeek is the
      // window `[prevMonday, currentMonday)`.
      caPrevWeek += total;
    }
  }

  return { caToday, ordersToday, caWeek, caPrevWeek };
}

/**
 * Public Convex query. The wrapper consumes `tenantId`, resolves the actor
 * via `getCurrentActor` (ADR 0011), enforces the allow-list, and exposes
 * `{ actor, tenantId }` on `ctx`. Cross-tenant fuzz pinned by
 * `quickStats.test.ts` (5 actors × 1 fn, 0 leak).
 */
export const quickStats = tenantQuery(OPERATIONAL_ALLOW)({
  args: {},
  handler: async (ctx) => computeQuickStats(ctx, ctx.tenantId),
});
