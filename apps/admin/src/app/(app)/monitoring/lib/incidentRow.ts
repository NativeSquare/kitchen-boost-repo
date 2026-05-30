/**
 * F-MONITORING — `toIncidentRow` (issue #184, parent EPIC #147).
 *
 * Pure presenter that maps an `Incident` (backend discriminated union from
 * `packages/backend/convex/lib/admin/monitoring.ts`) to the row shape the
 * `/monitoring` table renders. Delegates the visual severity / human label
 * / contextual href to `deriveIncidentDisplay` (issue #177) — this module
 * only adds the per-kind inline details prescribed by the issue body:
 *
 *   - `webhook_latency` → provider + externalId + latencyMs (in seconds)
 *   - `kyc_pending`     → prospectName (or prospectId) + provider + the
 *                          « depuis X heures » copy from `formatPendingSince`
 *   - `paid_no_course`  → orderId + tenantId (when present)
 *
 * Pure (no I/O, no React) so vitest can pin every branch in the `node` env.
 */
import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import {
  deriveIncidentDisplay,
  type IncidentSeverity,
} from "./deriveIncidentDisplay";
import { formatPendingSince } from "./formatPendingSince";

/** A row the `/monitoring` table needs to render one incident. */
export type IncidentRow = {
  /** Stable React `key` for the row — derived from the incident's identity. */
  key: string;
  /** Underlying incident kind (handy for filtering downstream). */
  kind: Incident["kind"];
  /** Visual severity (color of the badge). */
  severity: IncidentSeverity;
  /** Human label for the « Type » column (e.g. "KYC en attente"). */
  typeLabel: string;
  /** Display name of the impacted entity (tenant / prospect / orderId). */
  targetLabel: string;
  /** Concatenated kind-specific inline fields (rendered in the "Détails" column). */
  details: string;
  /** « depuis X heures » copy for kinds that carry a since instant. */
  sinceText?: string;
  /** Contextual href to drill down (when buildable). */
  href?: string;
};

/** Map an `Incident` to its `IncidentRow`. Pure. */
export function toIncidentRow(incident: Incident, now: number): IncidentRow {
  const display = deriveIncidentDisplay(incident);
  switch (incident.kind) {
    case "webhook_latency": {
      const latencySec = Math.round(incident.latencyMs / 1000);
      return {
        key: `webhook_latency:${incident.provider}:${incident.externalId}`,
        kind: incident.kind,
        severity: display.severity,
        typeLabel: display.label,
        targetLabel: incident.provider,
        details: `${incident.provider} · ${incident.externalId} · ${latencySec} s`,
        href: display.href,
      };
    }
    case "kyc_pending": {
      const target = incident.prospectName ?? incident.prospectId;
      const sinceText = formatPendingSince(incident.pendingSinceMs, now);
      return {
        key: `kyc_pending:${incident.provider}:${incident.prospectId}`,
        kind: incident.kind,
        severity: display.severity,
        typeLabel: display.label,
        targetLabel: target,
        details: `${incident.provider} · ${sinceText}`,
        sinceText,
        href: display.href,
      };
    }
    case "paid_no_course": {
      const target = incident.tenantId ?? incident.orderId;
      const details =
        incident.tenantId === undefined
          ? incident.orderId
          : `${incident.orderId} · ${incident.tenantId}`;
      return {
        key: `paid_no_course:${incident.orderId}`,
        kind: incident.kind,
        severity: display.severity,
        typeLabel: display.label,
        targetLabel: target,
        details,
        href: display.href,
      };
    }
  }
}
