/**
 * F-MONITORING — `filterIncidents` + `collectTenantOptions` (issue #197,
 * parent EPIC #147).
 *
 * Pure filter pipeline that backs the 3 client-side filters (kind, tenant,
 * severity) the `/monitoring` page renders above its table. Kept pure (no
 * React, no Convex) so vitest can pin every branch in the `node` env, and
 * so the wrapping `MonitoringView` stays a thin shell.
 *
 * Filter semantics (issue body):
 *   - `kind`     : "all" | one of the 3 Incident kinds — exact-match.
 *   - `tenantId` : "all" | a tenant id string. When set, ONLY the tenant-
 *                  scoped incidents (`paid_no_course` with `tenantId`) can
 *                  match (the issue's explicit fallback when the
 *                  prospect→tenant join is not derivable from the
 *                  `Incident` payload).
 *   - `severity` : "all" | "critical" | "warning" — derived per incident
 *                  via `deriveIncidentDisplay`.
 *
 * Combination is AND.
 */
import { describe, expect, it } from "vitest";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import { collectTenantOptions, filterIncidents } from "./filterIncidents";

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const KYC: Incident = {
  kind: "kyc_pending",
  provider: "stripe",
  prospectId: "prospect_42",
  prospectName: "L'Artisan",
  pendingSinceMs: NOW - 4 * HOUR,
};
const WEBHOOK: Incident = {
  kind: "webhook_latency",
  provider: "stripe",
  externalId: "evt_abc",
  latencyMs: 45_000,
};
const PAID_KHAN: Incident = {
  kind: "paid_no_course",
  orderId: "order_42",
  tenantId: "tenant_khan",
};
const PAID_KIM: Incident = {
  kind: "paid_no_course",
  orderId: "order_77",
  tenantId: "tenant_kim",
};
const PAID_ORPHAN: Incident = {
  // `tenantId` is optional on the backend type — a `paid_no_course` without
  // tenant is possible (the order belongs to a tenant that was archived,
  // etc.). It must be reachable when no tenant filter is set, and excluded
  // when a tenant filter is set (no tenant id to match against).
  kind: "paid_no_course",
  orderId: "order_99",
};

const BURST_KHAN: Incident = {
  // #415 — tenant-scoped warning incident (auto_expired/24h > seuil). Carries
  // `tenantId` like `paid_no_course`, so the tenant filter must match it AND
  // the kind filter must surface it via the new « Manquées » select option.
  kind: "auto_expired_burst",
  tenantId: "tenant_khan",
  tenantName: "Khan's Resto",
  count: 5,
  windowMs: 24 * HOUR,
  thresholdCount: 3,
};

const ALL = [KYC, WEBHOOK, PAID_KHAN, PAID_KIM, PAID_ORPHAN, BURST_KHAN];

describe("filterIncidents — F-MONITORING (#197)", () => {
  it("returns the input unchanged when every filter is « all »", () => {
    expect(
      filterIncidents(ALL, { kind: "all", tenantId: "all", severity: "all" }),
    ).toEqual(ALL);
  });

  it("filters by kind exactly — `kyc_pending` keeps only the KYC row", () => {
    const out = filterIncidents(ALL, {
      kind: "kyc_pending",
      tenantId: "all",
      severity: "all",
    });
    expect(out).toEqual([KYC]);
  });

  it("filters by kind exactly — `webhook_latency` keeps only the webhook row", () => {
    const out = filterIncidents(ALL, {
      kind: "webhook_latency",
      tenantId: "all",
      severity: "all",
    });
    expect(out).toEqual([WEBHOOK]);
  });

  it("filters by kind exactly — `paid_no_course` keeps every paid-no-course row including the orphan (drops the burst)", () => {
    const out = filterIncidents(ALL, {
      kind: "paid_no_course",
      tenantId: "all",
      severity: "all",
    });
    expect(out).toEqual([PAID_KHAN, PAID_KIM, PAID_ORPHAN]);
  });

  it("filters by severity « critical » → keeps `webhook_latency` + `paid_no_course`, drops `kyc_pending` + `auto_expired_burst` (both warnings)", () => {
    const out = filterIncidents(ALL, {
      kind: "all",
      tenantId: "all",
      severity: "critical",
    });
    expect(out).toEqual([WEBHOOK, PAID_KHAN, PAID_KIM, PAID_ORPHAN]);
  });

  it("filters by severity « warning » → keeps `kyc_pending` + `auto_expired_burst` (#415)", () => {
    const out = filterIncidents(ALL, {
      kind: "all",
      tenantId: "all",
      severity: "warning",
    });
    expect(out).toEqual([KYC, BURST_KHAN]);
  });

  it("filters by tenant id — keeps every tenant-scoped incident matching that id (paid + burst share the same tenant)", () => {
    // #415: `auto_expired_burst` is tenant-scoped on the wire (carries
    // tenantId), so it must surface under the tenant filter alongside the
    // `paid_no_course` row of the same resto.
    const out = filterIncidents(ALL, {
      kind: "all",
      tenantId: "tenant_khan",
      severity: "all",
    });
    expect(out).toEqual([PAID_KHAN, BURST_KHAN]);
  });

  it("a tenant filter excludes non-tenant-scoped incidents (kyc_pending, webhook_latency, and tenant-less paid_no_course)", () => {
    // No incident in the input carries `tenant_khan` outside of PAID_KHAN, so
    // KYC / WEBHOOK / PAID_ORPHAN must all drop.
    const out = filterIncidents(ALL, {
      kind: "all",
      tenantId: "tenant_khan",
      severity: "all",
    });
    expect(out).not.toContain(KYC);
    expect(out).not.toContain(WEBHOOK);
    expect(out).not.toContain(PAID_ORPHAN);
  });

  it("combines the three filters as AND — kind + severity + tenant must all match", () => {
    // Asking for `paid_no_course` + critical + tenant_kim → only PAID_KIM.
    const out = filterIncidents(ALL, {
      kind: "paid_no_course",
      tenantId: "tenant_kim",
      severity: "critical",
    });
    expect(out).toEqual([PAID_KIM]);
  });

  it("combines the three filters as AND — incompatible combination yields []", () => {
    // `kyc_pending` is « warning », so asking for kyc_pending + critical
    // must produce zero results (no need to look at the tenant filter).
    const out = filterIncidents(ALL, {
      kind: "kyc_pending",
      tenantId: "all",
      severity: "critical",
    });
    expect(out).toEqual([]);
  });

  it("#415 filters by kind exactly — `auto_expired_burst` keeps only the burst row", () => {
    const out = filterIncidents(ALL, {
      kind: "auto_expired_burst",
      tenantId: "all",
      severity: "all",
    });
    expect(out).toEqual([BURST_KHAN]);
  });

  it("preserves input order (stable filter, no resorting)", () => {
    // Important for the UI: rows shouldn't reshuffle when a filter is
    // toggled, so the user keeps their place.
    const out = filterIncidents([PAID_KIM, KYC, PAID_KHAN], {
      kind: "all",
      tenantId: "all",
      severity: "all",
    });
    expect(out).toEqual([PAID_KIM, KYC, PAID_KHAN]);
  });
});

describe("collectTenantOptions — F-MONITORING (#197)", () => {
  it("returns [] when no incident carries a tenantId (only KYC / webhook / orphan)", () => {
    expect(collectTenantOptions([KYC, WEBHOOK, PAID_ORPHAN])).toEqual([]);
  });

  it("collects distinct tenant ids from tenant-scoped incidents (paid_no_course + auto_expired_burst #415)", () => {
    expect(collectTenantOptions([PAID_KHAN, PAID_KIM])).toEqual([
      "tenant_khan",
      "tenant_kim",
    ]);
  });

  it("#415 collects the tenantId of an `auto_expired_burst` incident too (tenant-scoped on the wire)", () => {
    // BURST_KHAN carries the same tenant as PAID_KHAN; the dedupe keeps a
    // single entry. A burst on a NEW tenant adds it to the dropdown so ops
    // can drill into that resto.
    expect(collectTenantOptions([PAID_KHAN, BURST_KHAN])).toEqual([
      "tenant_khan",
    ]);
    const burstSolo: Incident = {
      kind: "auto_expired_burst",
      tenantId: "tenant_solo",
      count: 4,
      windowMs: 24 * HOUR,
      thresholdCount: 3,
    };
    expect(collectTenantOptions([burstSolo])).toEqual(["tenant_solo"]);
  });

  it("deduplicates repeated tenant ids", () => {
    const dup: Incident = {
      kind: "paid_no_course",
      orderId: "order_xx",
      tenantId: "tenant_khan",
    };
    expect(collectTenantOptions([PAID_KHAN, dup, PAID_KIM])).toEqual([
      "tenant_khan",
      "tenant_kim",
    ]);
  });

  it("preserves first-seen order (stable for the UI dropdown)", () => {
    expect(collectTenantOptions([PAID_KIM, PAID_KHAN])).toEqual([
      "tenant_kim",
      "tenant_khan",
    ]);
  });
});
