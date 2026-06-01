import {
  TERMINAL_ORDER_STATUSES,
  type TenantRole,
  listTenantOrders,
  tenantQuery,
} from "../tenancy";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

/**
 * F-STATS-DASHBOARD (#252) — `dailyKpis` : 4 KPI agrégés du JOUR pour le
 * dashboard home du gérant restaurateur (`/t/[tenantId]/page.tsx`).
 *
 *  - `caTotal`         : chiffre d'affaires du jour, en cents (somme des
 *                        `pricingSnapshot.total` des commandes payées
 *                        aujourd'hui) ;
 *  - `nbCommandes`     : nombre de commandes payées aujourd'hui ;
 *  - `panierMoyen`     : `caTotal / nbCommandes`, floor cents (0 si pas de
 *                        commande) ;
 *  - `commandesEnCours`: orders dans la live queue (cf.
 *                        `listTenantLiveOrders` — hors `en attente de paiement`
 *                        et hors terminaux `livrée/collectée/refusée`).
 *
 * Wrapper RBAC : `tenantQuery({ allow: ["kb_manager", "staff"] })`. Le KPI
 * dashboard est OPÉRATIONNEL (PRD 20 §2) — staff doit pouvoir consulter le
 * même tableau que le gérant. `kb_admin` passe via le root override.
 *
 * Isolation (ADR 0010 — MOAT) : `tenantId` injecté par le wrapper ; les reads
 * passent EXCLUSIVEMENT par le seam sanctionné `lib/tenancy/ordersStore` qui
 * filtre `by_tenant`. Pas de `getAuthUserId` direct (le wrapper appelle
 * `getCurrentActor` cf. ADR 0011). Pas de raw `ctx.db.query` ici (lint
 * `no-untenanted-query` actif sur `convex/**` hors `lib/tenancy/*`).
 *
 * Définition « du jour » : `paidAt >= startOfDayUtc(now)`. On agrège sur
 * `paidAt` (et NON `createdAt`) — une commande encore `en attente de paiement`
 * n'a pas de `paidAt` et n'entre donc ni dans le CA ni dans le compteur (PRD
 * 10 §10/§11 : invisible jusqu'au paiement). Le retour `commandesEnCours`
 * couvre par construction toutes les LIVE — la frontière « du jour » est
 * implicite (un order qui traîne plus de 24 h en kitchen reste en cours).
 *
 * Coût Convex : `listTenantOrders` parcourt l'index `by_tenant` (cardinalité
 * « commandes d'un resto », petite par construction — quelques dizaines / jour
 * en V1) ; pas de scan global. Filtre `paidAt >= start` en mémoire — accepté
 * tant que la cardinalité reste petite ; si elle explose, un index
 * `by_tenant_paidAt` deviendra nécessaire (out-of-scope ici).
 */

const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

/** UTC start-of-day timestamp (ms) for the given instant. */
function startOfDayUtc(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
}

/**
 * The 4 daily KPIs, computed from the tenant's `orders` rows fetched via the
 * sanctioned seam. Extracted so the (eventual) HTTP / SSR mirror can call it
 * directly without re-routing through the wrapper.
 */
async function computeDailyKpis(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
): Promise<{
  caTotal: number;
  nbCommandes: number;
  panierMoyen: number;
  commandesEnCours: number;
}> {
  // ONE fetch via the sanctioned seam — small per-tenant cardinality (V1, a
  // few dozen orders/day). Both KPI families are derived from the same list,
  // saving the duplicate index scan a 2-pass version would do.
  const start = startOfDayUtc(Date.now());
  const all: Doc<"orders">[] = await listTenantOrders(ctx, tenantId);

  let caTotal = 0;
  let nbCommandes = 0;
  let commandesEnCours = 0;
  for (const o of all) {
    // Live queue: same definition as `listTenantLiveOrders` (PRD 20 §2) —
    // excludes the pending state (invisible until paid, PRD 10 §10/§11) AND
    // the three terminal states (livrée / collectée / refusée).
    if (
      o.status !== "en attente de paiement" &&
      !TERMINAL_ORDER_STATUSES.includes(o.status)
    ) {
      commandesEnCours += 1;
    }

    // CA + nb — paid orders within today's window (paidAt set at confirmation
    // in lockstep with pricingSnapshot, cf. confirmTenantOrderPayment).
    if (o.paidAt === undefined) continue;
    if (o.paidAt < start) continue;
    if (o.pricingSnapshot === undefined) continue;
    caTotal += o.pricingSnapshot.total;
    nbCommandes += 1;
  }

  const panierMoyen = nbCommandes === 0 ? 0 : Math.floor(caTotal / nbCommandes);

  return { caTotal, nbCommandes, panierMoyen, commandesEnCours };
}

/**
 * Public Convex query. The wrapper consumes `tenantId`, resolves the actor
 * via `getCurrentActor` (ADR 0011), and exposes `{ actor, tenantId }` on
 * `ctx`. Cross-tenant fuzz pinned by `dailyKpis.test.ts` (5 actors × 1 fn,
 * 0 leak).
 */
export const dailyKpis = tenantQuery(OPERATIONAL_ALLOW)({
  args: {},
  handler: async (ctx) => computeDailyKpis(ctx, ctx.tenantId),
});
