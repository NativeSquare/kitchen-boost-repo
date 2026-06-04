/**
 * F-MONITORING — pure UI mapping for an `Incident` (issue #177, parent EPIC
 * #147). Takes a backend `Incident` (discriminated union from
 * `packages/backend/convex/lib/admin/monitoring.ts`) and returns the display
 * tuple the dashboard table + drill-down panel render: a visual severity
 * (`critical` / `warning`), a short human-readable label, and an optional
 * contextual href.
 *
 * NO React, NO Convex here — this is pure TS so the next slices (the
 * monitoring page + the drill-down `Sheet`) can both consume it and test it
 * in isolation without RTL.
 *
 * Mapping frozen in the F-MONITORING handoff (cf. EPIC #147 "Implementation
 * Decisions" — severity is derived V1, not exposed by the backend):
 *
 *  - `kyc_pending`       → warning  + `/pipeline/[prospectId]`
 *  - `webhook_latency`   → critical + (no href V1 — no per-webhook fiche)
 *  - `paid_no_course`    → critical + `/t/[tenantId]/commandes` ONLY when
 *    `tenantId` is present (the backend union types it optional; without it
 *    we can't build the link, so we drop the href rather than guess).
 */
import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

/** Visual severity rendered by the dashboard (orange vs red). */
export type IncidentSeverity = "critical" | "warning";

/** What the dashboard needs to render one incident row + its drill-down link. */
export type IncidentDisplay = {
  severity: IncidentSeverity;
  label: string;
  /** Contextual link to the relevant supervision/ops view, when buildable. */
  href?: string;
};

export function deriveIncidentDisplay(incident: Incident): IncidentDisplay {
  switch (incident.kind) {
    case "kyc_pending":
      return {
        severity: "warning",
        label: "KYC en attente",
        href: `/pipeline/${incident.prospectId}`,
      };
    case "webhook_latency":
      return {
        severity: "critical",
        label: "Webhook lent",
      };
    case "paid_no_course":
      return {
        severity: "critical",
        label: "Cmd payée sans course",
        href:
          incident.tenantId === undefined
            ? undefined
            : `/t/${incident.tenantId}/commandes`,
      };
    case "auto_expired_burst":
      // #415 — PRD 20 §6b + ADR 0016. Operational signal (resto silently
      // dropping cmds) — same severity discipline as `kyc_pending` (warning,
      // not critical: no live outage, just a 24 h trend ops nudges). The
      // drill-down jumps straight to the resto's history filtered on the
      // « Manquées » tab via the `?tab=missed` query param — the page reads
      // it on mount so ops audits the exact cmds that were auto-expired.
      return {
        severity: "warning",
        label: "Cmds manquées (burst)",
        href: `/t/${incident.tenantId}/commandes?tab=missed`,
      };
  }
}
