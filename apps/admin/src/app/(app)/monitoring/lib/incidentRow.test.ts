/**
 * F-MONITORING — `toIncidentRow` (issue #184, parent EPIC #147).
 *
 * Pure presenter that maps an `Incident` (backend discriminated union from
 * `packages/backend/convex/lib/admin/monitoring.ts`) to the row shape the
 * `/monitoring` table renders: a kind label, a target label
 * (tenant or prospect), the visual severity (delegated to
 * `deriveIncidentDisplay`, issue #177), and the kind-specific details that
 * the issue body requires inline (no drill-down in this slice):
 *
 *   - `webhook_latency` → provider + externalId + latencyMs
 *   - `kyc_pending`     → prospectName + provider + « depuis X heures »
 *   - `paid_no_course`  → orderId + tenantId
 *
 * Kept pure so vitest can pin every branch in the `node` env (no jsdom, no
 * Convex). The React table is a thin shell that maps `Incident[]` →
 * `IncidentRow[]` → `<tr>`.
 */
import { describe, expect, it } from "vitest";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import { toIncidentRow } from "./incidentRow";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe("toIncidentRow — F-MONITORING (#184)", () => {
  it("maps a `webhook_latency` incident with provider+externalId+latencyMs inline", () => {
    const incident: Incident = {
      kind: "webhook_latency",
      provider: "stripe",
      externalId: "evt_abc",
      latencyMs: 45_000,
    };

    const row = toIncidentRow(incident, NOW);
    expect(row.severity).toBe("critical");
    // The "type" column copy is the human label from deriveIncidentDisplay.
    expect(row.typeLabel).toBe("Webhook lent");
    // The "target" column surfaces the impacted external entity (here, the
    // webhook provider — we don't have a tenant ref).
    expect(row.targetLabel).toMatch(/stripe/i);
    // Inline details for this kind: provider + externalId + the latency in ms.
    expect(row.details).toContain("stripe");
    expect(row.details).toContain("evt_abc");
    expect(row.details).toMatch(/45\s?000|45000|45 s|45s/);
    // No href for webhook_latency in V1 (no per-webhook fiche).
    expect(row.href).toBeUndefined();
    // No "depuis" — this kind doesn't carry a since instant.
    expect(row.sinceText).toBeUndefined();
  });

  it("maps a `kyc_pending` incident with prospectName+provider+« depuis X heures » inline", () => {
    const incident: Incident = {
      kind: "kyc_pending",
      provider: "stripe",
      prospectId: "prospect_123",
      prospectName: "L'Artisan",
      pendingSinceMs: NOW - 4 * HOUR,
    };

    const row = toIncidentRow(incident, NOW);
    expect(row.severity).toBe("warning");
    expect(row.typeLabel).toBe("KYC en attente");
    // Target = the prospect's display name (falls back to id when missing).
    expect(row.targetLabel).toContain("L'Artisan");
    // Inline details: provider + the « depuis X heures » formatting.
    expect(row.details).toMatch(/stripe/i);
    expect(row.sinceText).toMatch(/^depuis /);
    expect(row.sinceText).toMatch(/heure/);
    // Href points at the prospect fiche.
    expect(row.href).toBe("/pipeline/prospect_123");
  });

  it("falls back to prospectId in the target label when prospectName is absent (kyc_pending)", () => {
    const incident: Incident = {
      kind: "kyc_pending",
      provider: "uber_direct",
      prospectId: "prospect_456",
      pendingSinceMs: NOW - 50 * HOUR,
    };

    const row = toIncidentRow(incident, NOW);
    // No name → the id has to be in the target column so the row stays
    // identifiable.
    expect(row.targetLabel).toContain("prospect_456");
  });

  it("maps a `paid_no_course` incident with orderId+tenantId inline + tenant href", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
      tenantId: "tenant_khan",
    };

    const row = toIncidentRow(incident, NOW);
    expect(row.severity).toBe("critical");
    expect(row.typeLabel).toBe("Cmd payée sans course");
    // Target = the impacted tenant when known.
    expect(row.targetLabel).toContain("tenant_khan");
    // Details surface both the orderId and the tenant.
    expect(row.details).toContain("order_42");
    expect(row.details).toContain("tenant_khan");
    // Href points at the tenant's commandes view.
    expect(row.href).toBe("/t/tenant_khan/commandes");
  });

  it("maps a `paid_no_course` incident WITHOUT a tenantId — no href, target falls back to the orderId", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
    };

    const row = toIncidentRow(incident, NOW);
    expect(row.severity).toBe("critical");
    expect(row.href).toBeUndefined();
    // Without a tenant ref, the target column degrades to the orderId so the
    // row is still identifiable.
    expect(row.targetLabel).toContain("order_42");
    expect(row.details).toContain("order_42");
  });
});
