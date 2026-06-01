import { ConvexError, v } from "convex/values";
import { type TenantRole, listTenantOrders, tenantQuery } from "../tenancy";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

/**
 * F-STATS-DASHBOARD [3/8] (#253) — `rangeAggregates` : 2 chiffres bruts
 * agrégés sur la fenêtre de N jours pour la page Stats `/t/[tenantId]/stats`.
 *
 *  - `panierMoyen`     : `caTotal / nbCommandes` floor cents, 0 si vide ;
 *  - `totalCommandes`  : nombre de commandes payées sur la fenêtre.
 *
 * Surface : `api.lib.stats.rangeAggregates.rangeAggregates({ tenantId,
 * rangeDays })`. `tenantId` est absorbé par le wrapper `tenantQuery({ allow:
 * ["kb_manager", "staff"] })` (sanctionné, ADR 0010/0011).
 *
 * Wrapper RBAC : `tenantQuery({ allow: ["kb_manager", "staff"] })` — même
 * politique que `dailyKpis` ; les chiffres stats sont OPÉRATIONNELS (PRD 70
 * §4.10), staff y a accès. Pas de `getAuthUserId` direct (le wrapper appelle
 * `getCurrentActor` cf. ADR 0011). Pas de raw `ctx.db.query` ici (lint
 * `no-untenanted-query` actif sur `convex/**` hors `lib/tenancy/*`) — lit via
 * le seam `listTenantOrders` (`lib/tenancy/ordersStore`).
 *
 * Définition « sur la fenêtre » : `paidAt >= now - rangeDays * 24h`. Même
 * règle que `dailyKpis` — on compte les commandes PAYÉES (`paidAt` set), pas
 * `createdAt` ; une commande encore `en attente de paiement` ne contribue NI
 * au CA NI au compteur (PRD 10 §10/§11). « Marge » du jour incluse : un
 * order payé il y a 0,5 jour rentre dans `rangeDays=7`.
 *
 * Range autorisée : `rangeDays ∈ {7, 30, 90}` (les 3 options du RangePicker
 * front, cf. `apps/admin/src/lib/stats-range.ts`). Toute autre valeur →
 * `ConvexError` (refuse les fenêtres custom V1). C'est la 3ᵉ frontière de
 * défense : convex.values typecheck en bord, le wrapper isole par tenant,
 * cette validation refuse les inputs hors spec V1.
 *
 * Coût Convex : `listTenantOrders` parcourt l'index `by_tenant` (cardinalité
 * « commandes d'un resto », petite par construction — quelques dizaines /
 * jour en V1, ~3K sur 90 jours dans un pire cas). Filtre `paidAt >= start`
 * en mémoire — accepté tant que la cardinalité reste petite ; si elle
 * explose, un index `by_tenant_paidAt` deviendra nécessaire (out-of-scope
 * ici, sera traité avec les autres queries D9 lourdes — `revenuePerDay`,
 * `topItems`, etc.).
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

/**
 * Aggregator extracted from the Convex handler so the (eventual) HTTP / SSR
 * mirror can call it directly without re-routing through the wrapper.
 */
async function computeRangeAggregates(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  rangeDays: AllowedRangeDays,
): Promise<{ panierMoyen: number; totalCommandes: number }> {
  const start = Date.now() - rangeDays * DAY_MS;
  const all: Doc<"orders">[] = await listTenantOrders(ctx, tenantId);

  let caTotal = 0;
  let totalCommandes = 0;
  for (const o of all) {
    if (o.paidAt === undefined) continue;
    if (o.paidAt < start) continue;
    if (o.pricingSnapshot === undefined) continue;
    caTotal += o.pricingSnapshot.total;
    totalCommandes += 1;
  }

  const panierMoyen =
    totalCommandes === 0 ? 0 : Math.floor(caTotal / totalCommandes);

  return { panierMoyen, totalCommandes };
}

/**
 * Public Convex query. Wrapper absorbs `tenantId`, resolves the actor via
 * `getCurrentActor` (ADR 0011), enforces the allow-list, and exposes
 * `{ actor, tenantId }` on `ctx`. Cross-tenant fuzz pinned by
 * `rangeAggregates.test.ts` (5 actors × 1 fn, 0 leak).
 */
export const rangeAggregates = tenantQuery(OPERATIONAL_ALLOW)({
  args: { rangeDays: v.number() },
  handler: async (ctx, { rangeDays }) => {
    if (!isAllowedRange(rangeDays)) {
      throw new ConvexError(
        `rangeDays must be one of ${ALLOWED_RANGE_DAYS.join(
          ", ",
        )} (V1 RangePicker contract)`,
      );
    }
    return computeRangeAggregates(ctx, ctx.tenantId, rangeDays);
  },
});
