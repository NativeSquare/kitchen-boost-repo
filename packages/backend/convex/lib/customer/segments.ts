import { listTenantCustomerOrders, tenantQuery } from "../tenancy";

/**
 * 2.1-D — customer Segments (Actif / Inactif / VIP), read-only on
 * `customerOrdersPerTenant` (PRD 90 §3, customer-data CONTEXT "Segment").
 *
 * Thresholds are FROZEN V1 (NOT invented — taken verbatim from PRD 90 §3; resto-
 * configurable only in V2):
 *  - Actif   : ≥1 cmd dans les 30 derniers jours
 *  - Inactif : 0 cmd dans les 90 derniers jours
 *  - VIP     : ≥5 cmds total OU LTV cumulé ≥ 150€ (peu importe récence)
 *
 * `computeSegment` is a PURE rule (no Convex ctx): trivially unit-testable and
 * reused by the per-tenant aggregate. The aggregate `segmentCounts` is reconstructed
 * from `customerOrdersPerTenant` (which carries `tenantId`, so it is tenant-scoped
 * through `tenantQuery`) and exposes ONLY counts to a `kb_manager` — never a raw
 * `customer` object (the MOAT, ADR 0010). 2.1 NEVER writes the link (reserved 2.3).
 */

/** Frozen V1 segment thresholds (PRD 90 §3). */
const ACTIF_WINDOW_DAYS = 30;
const INACTIF_WINDOW_DAYS = 90;
const VIP_MIN_ORDERS = 5;
const VIP_MIN_LTV_EUR = 150;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The per-tenant order stats a segment is computed from (the link's columns). */
export type CustomerOrderStats = {
  totalOrders: number;
  lastOrderAt: number;
  ltv: number;
};

/**
 * The V1 segments. `entre` is the explicit "between 30 and 90 days, not VIP"
 * bucket — neither Actif nor Inactif — so the three named segments stay exactly
 * the PRD definitions without an implicit catch-all.
 */
export type Segment = "actif" | "inactif" | "vip" | "entre";

/**
 * Classify a customer's per-tenant stats into a V1 segment (PRD 90 §3). VIP wins
 * over recency (a VIP who also ordered recently is reported VIP). `now` is
 * injected so the rule is deterministic + unit-testable.
 */
export function computeSegment(
  stats: CustomerOrderStats,
  now: number,
): Segment {
  // VIP first — "peu importe récence".
  if (stats.totalOrders >= VIP_MIN_ORDERS || stats.ltv >= VIP_MIN_LTV_EUR) {
    return "vip";
  }
  const daysSinceLastOrder = (now - stats.lastOrderAt) / DAY_MS;
  if (daysSinceLastOrder <= ACTIF_WINDOW_DAYS) return "actif";
  if (daysSinceLastOrder > INACTIF_WINDOW_DAYS) return "inactif";
  return "entre";
}

/** Per-tenant segment counts exposed to the resto (counts only — the MOAT). */
export type SegmentCounts = {
  actif: number;
  inactif: number;
  vip: number;
  total: number;
};

/**
 * Per-tenant segment KPI for the calling tenant (kb_manager; kb_admin via root
 * override). Reconstructed from `customerOrdersPerTenant`, scoped to
 * `ctx.tenantId`. Returns ONLY counts — never a customer fiche, prénom or
 * coordinate (PRD 90 §3 / Q90-Q2, the MOAT). The `entre` bucket is folded out of
 * the reported KPI (the resto sees the three named segments + total).
 */
export const segmentCounts = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<SegmentCounts> => {
    const now = Date.now();
    const links = await listTenantCustomerOrders(ctx, ctx.tenantId);
    const counts: SegmentCounts = { actif: 0, inactif: 0, vip: 0, total: 0 };
    for (const link of links) {
      counts.total += 1;
      const segment = computeSegment(
        {
          totalOrders: link.totalOrders,
          lastOrderAt: link.lastOrderAt,
          ltv: link.ltv,
        },
        now,
      );
      if (segment === "actif") counts.actif += 1;
      else if (segment === "inactif") counts.inactif += 1;
      else if (segment === "vip") counts.vip += 1;
      // `entre` contributes to `total` only — not a reported segment.
    }
    return counts;
  },
});
