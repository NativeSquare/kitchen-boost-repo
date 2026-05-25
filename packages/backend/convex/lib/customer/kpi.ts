import {
  listTenantCustomerOrders,
  logAudit,
  readCustomerAggregateFields,
  tenantMutation,
  tenantQuery,
} from "../tenancy";
import { channelReachability } from "./reachability";
import { computeSegment } from "./segments";

/**
 * 2.1-E — `aggregateCustomerKPIs`, the SINGLE resto-facing surface on the MOAT
 * (PRD 90 §3 / Q90-Q2, customer-data CONTEXT "KPI clients (vue resto V1)").
 *
 * A `kb_manager` (resto) sees ONLY aggregates for THEIR tenant — NEVER a raw
 * `customer` object, a coordinate, a name or an individual id, and the module
 * exposes NO export / bulk / nominative-list surface (the technical lock of the
 * moat, ADR 0010 + "Anti-extraction"). The query is reconstructed from
 * `customerOrdersPerTenant` (which carries `tenantId`, so it is tenant-scoped
 * through `tenantQuery`) plus the NARROW reachability projection of each linked
 * fiche read via the sanctioned seam — reduced to COUNTS before anything crosses
 * the wrapper boundary. Identity flows ONLY through `getCurrentActor` (inside the
 * wrapper, ADR 0011). 2.1 NEVER writes the link (reserved 2.3).
 *
 * KPI definitions are taken VERBATIM from PRD 90 §3 (NOT invented):
 *  - segments  : Actif / Inactif / VIP counts (frozen V1 thresholds, via
 *    `computeSegment`).
 *  - reachability : # clients atteignables push / email / SMS (via
 *    `channelReachability`).
 *  - total      : total clients of the tenant.
 *  - newThisMonth : clients new THIS calendar month — counted from the link's
 *    `_creationTime` (the link is created on the customer's FIRST order at this
 *    tenant by 2.3, so it is the tenant-scoped "became a customer here" date; the
 *    GLOBAL `customers.createdAt` is cross-tenant and would NOT be tenant-scoped).
 *  - returnRate : share (0..1) of clients with ≥2 orders (`totalOrders >= 2`),
 *    "% clients ayant ≥2 cmds". 0 when the tenant has no customers.
 *
 * Auditing: a Convex query CANNOT write, so the consultation trace required by
 * PRD 90 §4 ("audit log toutes les requêtes consultation") is carried by the
 * companion `logKpiConsultation` mutation, which the resto admin UI calls when it
 * opens the "Mes clients" view. It reuses the foundation `logAudit` (ADR 0010).
 */

/** Per-tenant segment counts (the three named V1 segments — PRD 90 §3). */
export type KpiSegmentCounts = {
  actif: number;
  inactif: number;
  vip: number;
};

/** Per-tenant reachability counts by channel (PRD 90 §3). */
export type KpiReachabilityCounts = {
  push: number;
  email: number;
  sms: number;
};

/** The aggregates-only KPI payload exposed to a `kb_manager` (the MOAT). */
export type CustomerKPIs = {
  segments: KpiSegmentCounts;
  reachability: KpiReachabilityCounts;
  /** Total clients of the tenant. */
  total: number;
  /** Clients new this calendar month (counted from the link creation time). */
  newThisMonth: number;
  /** Share (0..1) of clients with ≥2 orders; 0 when the tenant has none. */
  returnRate: number;
};

/** First-instant (ms) of the calendar month containing `now` (local time). */
function startOfMonth(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * The resto's "Mes clients" KPI for the calling tenant (kb_manager; kb_admin via
 * root override). Returns ONLY aggregates — never a customer fiche, prénom,
 * coordinate or individual id (PRD 90 §3 / Q90-Q2, the MOAT). Reconstructed from
 * `customerOrdersPerTenant`, scoped to `ctx.tenantId`.
 */
export const aggregateCustomerKPIs = tenantQuery({ allow: ["kb_manager"] })({
  args: {},
  handler: async (ctx): Promise<CustomerKPIs> => {
    const now = Date.now();
    const monthStart = startOfMonth(now);
    const links = await listTenantCustomerOrders(ctx, ctx.tenantId);

    const segments: KpiSegmentCounts = { actif: 0, inactif: 0, vip: 0 };
    const reachability: KpiReachabilityCounts = { push: 0, email: 0, sms: 0 };
    let total = 0;
    let newThisMonth = 0;
    let returning = 0;

    for (const link of links) {
      total += 1;

      // Segment (frozen V1 thresholds) — counts only the three named segments;
      // the "entre" bucket contributes to `total` but to no named segment.
      const segment = computeSegment(
        {
          totalOrders: link.totalOrders,
          lastOrderAt: link.lastOrderAt,
          ltv: link.ltv,
        },
        now,
      );
      if (segment === "actif") segments.actif += 1;
      else if (segment === "inactif") segments.inactif += 1;
      else if (segment === "vip") segments.vip += 1;

      // Reachability — NARROW projection of the linked fiche, reduced to counts.
      const fields = await readCustomerAggregateFields(ctx, link.customerId);
      if (fields !== null) {
        const r = channelReachability(fields);
        if (r.push) reachability.push += 1;
        if (r.email) reachability.email += 1;
        if (r.sms) reachability.sms += 1;
      }

      // New this month — the link's creation = first order at THIS tenant (2.3).
      if (link._creationTime >= monthStart) newThisMonth += 1;

      // Return rate numerator — clients having ordered ≥2 times.
      if (link.totalOrders >= 2) returning += 1;
    }

    return {
      segments,
      reachability,
      total,
      newThisMonth,
      returnRate: total === 0 ? 0 : returning / total,
    };
  },
});

/**
 * Audit the resto's consultation of its KPI view (PRD 90 §4 — scraping detection
 * / RGPD trace). The resto admin UI calls this when it opens "Mes clients"; the
 * read itself is the separate `aggregateCustomerKPIs` query (queries cannot
 * write). One EXPLICIT `logAudit` row is emitted (richer `targetType`/`targetId`
 * than the wrapper's auto-log can infer); the call only reaches the handler after
 * the wrapper's access gate passed, so a refused / cross-tenant call writes
 * nothing (the insert commits in the same transaction). NOT tagged `audit: true`,
 * so the wrapper does not ALSO auto-log — exactly one row per consult.
 */
export const logKpiConsultation = tenantMutation({ allow: ["kb_manager"] })({
  args: {},
  handler: async (ctx): Promise<void> => {
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.effectiveRole ?? ctx.actor.role,
      action: "customer.kpi.consult",
      tenantId: ctx.tenantId,
      targetType: "tenant",
      targetId: ctx.tenantId,
    });
  },
});
