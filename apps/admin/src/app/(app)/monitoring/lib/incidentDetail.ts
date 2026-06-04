/**
 * F-MONITORING — `toIncidentDetail` (issue #207, parent EPIC #147).
 *
 * Pure module: takes a backend `Incident` (discriminated union from
 * `packages/backend/convex/lib/admin/monitoring.ts`) and returns the
 * key/value pairs the drill-down `Sheet` panel renders — every raw field
 * of the discriminated incident, plus the contextual `href` derived via
 * `deriveIncidentDisplay` (issue #177) and the kind's human label.
 *
 * Kept React-free so vitest pins every per-kind branch in the lean `node`
 * env, same as its sibling helpers (`deriveIncidentDisplay`,
 * `toIncidentRow`, `filterIncidents`).
 *
 * Optional fields are dropped from the `fields` list when absent (rather
 * than rendered as "—") so the panel never lies about data that doesn't
 * exist on the wire. The discriminated union's optional fields per kind:
 *
 *   - `webhook_latency` → none optional
 *   - `kyc_pending`     → `prospectName?` is optional
 *   - `paid_no_course`  → `tenantId?` is optional
 */
import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import { deriveIncidentDisplay } from "./deriveIncidentDisplay";

/** One row in the « raw fields » block of the drill-down panel. */
export type IncidentDetailField = {
  /** Field name as defined by the backend discriminated union. */
  label: string;
  /** String value rendered next to the label (numbers are stringified). */
  value: string;
};

/** Everything the drill-down `Sheet` needs to render one incident. */
export type IncidentDetail = {
  kind: Incident["kind"];
  /** Human label for the panel title (e.g. "KYC en attente"). */
  typeLabel: string;
  /** Raw fields of the discriminated incident, in declaration order. */
  fields: IncidentDetailField[];
  /** Contextual link to the relevant supervision view, when buildable. */
  href?: string;
};

/** Map an `Incident` to its drill-down `IncidentDetail`. Pure. */
export function toIncidentDetail(incident: Incident): IncidentDetail {
  const display = deriveIncidentDisplay(incident);
  switch (incident.kind) {
    case "webhook_latency":
      return {
        kind: incident.kind,
        typeLabel: display.label,
        href: display.href,
        fields: [
          { label: "provider", value: incident.provider },
          { label: "externalId", value: incident.externalId },
          { label: "latencyMs", value: String(incident.latencyMs) },
        ],
      };
    case "kyc_pending": {
      const fields: IncidentDetailField[] = [
        { label: "provider", value: incident.provider },
        { label: "prospectId", value: incident.prospectId },
      ];
      if (incident.prospectName !== undefined) {
        fields.push({ label: "prospectName", value: incident.prospectName });
      }
      fields.push({
        label: "pendingSinceMs",
        value: String(incident.pendingSinceMs),
      });
      return {
        kind: incident.kind,
        typeLabel: display.label,
        href: display.href,
        fields,
      };
    }
    case "paid_no_course": {
      const fields: IncidentDetailField[] = [
        { label: "orderId", value: incident.orderId },
      ];
      if (incident.tenantId !== undefined) {
        fields.push({ label: "tenantId", value: incident.tenantId });
      }
      return {
        kind: incident.kind,
        typeLabel: display.label,
        href: display.href,
        fields,
      };
    }
    case "auto_expired_burst": {
      // #415 — Same field-by-field exposure pattern as the other kinds:
      // every raw field of the discriminated union surfaces as a row, optional
      // fields are dropped when absent (so the panel never lies about
      // data that doesn't exist — same discipline as `kyc_pending.prospectName`).
      const fields: IncidentDetailField[] = [
        { label: "tenantId", value: incident.tenantId },
      ];
      if (incident.tenantName !== undefined) {
        fields.push({ label: "tenantName", value: incident.tenantName });
      }
      fields.push(
        { label: "count", value: String(incident.count) },
        { label: "thresholdCount", value: String(incident.thresholdCount) },
        { label: "windowMs", value: String(incident.windowMs) },
      );
      return {
        kind: incident.kind,
        typeLabel: display.label,
        href: display.href,
        fields,
      };
    }
  }
}
