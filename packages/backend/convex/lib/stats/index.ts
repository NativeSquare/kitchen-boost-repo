/**
 * Public API of the `stats` backend module (F-STATS-DASHBOARD #252, parent
 * F-STATS epic).
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.stats.dailyKpis.dailyKpis`; re-exporting here does not change that
 * address — it merely states the module's contract in one place.
 *
 * Isolation (ADR 0010 — MOAT) : every function goes through the sanctioned
 * `tenantQuery` / `kbAdminQuery` wrappers and reads through the sanctioned
 * tenant stores (`lib/tenancy/*Store`) — no raw `ctx.db.query` here. Identity
 * resolution is delegated to `getCurrentActor` (ADR 0011) by the wrapper.
 *
 *  - `dailyKpis` (F-STATS-DASHBOARD, #252) — the 4 daily KPIs of a tenant
 *    (CA jour, nb commandes jour, panier moyen, commandes en cours).
 *  - `rangeAggregates` (F-STATS-DASHBOARD [3/8], #253) — the 2 chiffres bruts
 *    de la fenêtre N jours (panier moyen + total commandes) pour la page
 *    Stats `/t/[tenantId]/stats`.
 *  - `revenuePerDay` (F-STATS-DASHBOARD [4/8], #257) — la série revenu par
 *    jour sur la fenêtre N (7/30/90 jours) pour le LineChart Recharts de la
 *    page Stats. Entrées remplies à 0 sur les jours sans commande (continuité
 *    temporelle pour le graphique).
 *  - `quickStats` (#410) — 4 KPI minimalistes (CA jour + nb cmds jour + CA
 *    semaine + CA semaine précédente) pour la home native KB Orders (PRD 20
 *    §9). EXCLUT `refusée` et `auto_expired` (CA réalisé only) — contrat
 *    fondamentalement différent de `dailyKpis` (qui sert F-STATS-DASHBOARD KB
 *    Admin avec panier moyen). Le delta % S-1 est dérivé CÔTÉ CLIENT.
 */
export { dailyKpis } from "./dailyKpis";
export { quickStats } from "./quickStats";
export { rangeAggregates } from "./rangeAggregates";
export { revenuePerDay } from "./revenuePerDay";
