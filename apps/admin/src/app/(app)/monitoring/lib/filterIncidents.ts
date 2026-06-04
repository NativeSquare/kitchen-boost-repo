/**
 * F-MONITORING — `filterIncidents` + `collectTenantOptions` (issue #197,
 * parent EPIC #147).
 *
 * Pure pipeline that backs the 3 client-side filters (kind / tenant /
 * severity) rendered above the `/monitoring` table. The query
 * (`previewIncidents`) takes NO params — filtering is 100 % client-side on
 * the snapshot it returns, by design (small list, full reactivity, no
 * server round-trip per toggle).
 *
 * Kept pure (no React, no Convex, no Date) so vitest pins every branch in
 * the `node` env and the wrapping `MonitoringView` stays a thin shell.
 *
 * Tenant filter scope (issue #197 fallback):
 *   The `Incident` discriminated union only carries `tenantId` on
 *   `paid_no_course`. Deriving a tenant from `prospectId` for
 *   `kyc_pending` would require a backend join the V1 backend doesn't
 *   expose. The issue body explicitly allows the fallback: « sinon
 *   limiter le filtre aux incidents tenant-scoped » — so when the user
 *   picks a tenant, ONLY tenant-scoped incidents whose `tenantId`
 *   matches survive. Everything else is dropped.
 */
import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import { deriveIncidentDisplay } from "./deriveIncidentDisplay";

/** « Tous » sentinel for the kind / tenant / severity filters. */
export const ALL_FILTER = "all" as const;

/** The shape held by the page's filter state. AND-combined. */
export type IncidentFilters = {
  /** `"all"` or one of the 3 Incident kinds — exact-match. */
  kind: typeof ALL_FILTER | Incident["kind"];
  /** `"all"` or a tenant id — restricted to tenant-scoped incidents. */
  tenantId: typeof ALL_FILTER | string;
  /** `"all"` or visual severity derived via `deriveIncidentDisplay`. */
  severity: typeof ALL_FILTER | "critical" | "warning";
};

/** Default state (nothing filtered) — keeps consumers free of magic strings. */
export const ALL_PASS_FILTERS: IncidentFilters = {
  kind: ALL_FILTER,
  tenantId: ALL_FILTER,
  severity: ALL_FILTER,
};

/**
 * Apply the AND-combined filter set to `incidents`. Preserves input order
 * (the UI does not resort on toggle, to keep the user's place).
 */
export function filterIncidents(
  incidents: Incident[],
  filters: IncidentFilters,
): Incident[] {
  return incidents.filter((incident) => {
    if (filters.kind !== ALL_FILTER && incident.kind !== filters.kind) {
      return false;
    }
    if (filters.severity !== ALL_FILTER) {
      const severity = deriveIncidentDisplay(incident).severity;
      if (severity !== filters.severity) return false;
    }
    if (filters.tenantId !== ALL_FILTER) {
      // Only tenant-scoped incidents can match. The discriminated union
      // carries `tenantId` on `paid_no_course` (optionally) and on the
      // new #415 `auto_expired_burst` (always — burst is aggregated PER
      // tenant by definition).
      const ownTenantId =
        incident.kind === "paid_no_course"
          ? incident.tenantId
          : incident.kind === "auto_expired_burst"
            ? incident.tenantId
            : undefined;
      if (ownTenantId === undefined) return false;
      if (ownTenantId !== filters.tenantId) return false;
    }
    return true;
  });
}

/**
 * Collect the distinct tenant ids reachable from the incident snapshot, in
 * first-seen order, so the tenant filter dropdown only offers options the
 * user could realistically pick (no empty matches).
 *
 * V1 scope: only `paid_no_course` exposes a tenant id on the wire — that's
 * the tenant-scoped fallback documented at the top of this file. If a
 * future Incident kind carries `tenantId`, extend the switch here.
 */
export function collectTenantOptions(incidents: Incident[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const incident of incidents) {
    const ownTenantId =
      incident.kind === "paid_no_course"
        ? incident.tenantId
        : incident.kind === "auto_expired_burst"
          ? // #415 — burst is tenant-scoped on the wire (tenantId is required,
            // unlike paid_no_course where it's optional).
            incident.tenantId
          : undefined;
    if (ownTenantId === undefined) continue;
    if (seen.has(ownTenantId)) continue;
    seen.add(ownTenantId);
    ordered.push(ownTenantId);
  }
  return ordered;
}
