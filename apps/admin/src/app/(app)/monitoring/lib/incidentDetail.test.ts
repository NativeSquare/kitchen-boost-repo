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
 * Mapping per kind (cf. issue body):
 *   - `webhook_latency` → fields: provider, externalId, latencyMs ; NO href
 *   - `kyc_pending`     → fields: provider, prospectId, prospectName?,
 *                          pendingSinceMs ; href: /pipeline/[prospectId]
 *   - `paid_no_course`  → fields: orderId, tenantId? ; href:
 *                          /t/[tenantId]/commandes (ONLY when tenantId set)
 */
import { describe, expect, it } from "vitest";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import { toIncidentDetail } from "./incidentDetail";

describe("toIncidentDetail — F-MONITORING (#207)", () => {
  it("maps a `webhook_latency` incident: every raw field surfaces, no href in V1", () => {
    const incident: Incident = {
      kind: "webhook_latency",
      provider: "stripe",
      externalId: "evt_abc",
      latencyMs: 45_000,
    };

    const detail = toIncidentDetail(incident);
    expect(detail.kind).toBe("webhook_latency");
    expect(detail.typeLabel).toBe("Webhook lent");
    expect(detail.href).toBeUndefined();
    // Every raw field of the discriminated union surfaces as a row.
    const byLabel = new Map(detail.fields.map((f) => [f.label, f.value]));
    expect(byLabel.get("provider")).toBe("stripe");
    expect(byLabel.get("externalId")).toBe("evt_abc");
    expect(byLabel.get("latencyMs")).toBe("45000");
  });

  it("maps a `kyc_pending` incident: every raw field + href to /pipeline/[prospectId]", () => {
    const incident: Incident = {
      kind: "kyc_pending",
      provider: "stripe",
      prospectId: "prospect_123",
      prospectName: "L'Artisan",
      pendingSinceMs: 1_700_000_000_000,
    };

    const detail = toIncidentDetail(incident);
    expect(detail.kind).toBe("kyc_pending");
    expect(detail.typeLabel).toBe("KYC en attente");
    expect(detail.href).toBe("/pipeline/prospect_123");

    const byLabel = new Map(detail.fields.map((f) => [f.label, f.value]));
    expect(byLabel.get("provider")).toBe("stripe");
    expect(byLabel.get("prospectId")).toBe("prospect_123");
    expect(byLabel.get("prospectName")).toBe("L'Artisan");
    expect(byLabel.get("pendingSinceMs")).toBe("1700000000000");
  });

  it("omits the `prospectName` field row entirely when undefined (kyc_pending)", () => {
    const incident: Incident = {
      kind: "kyc_pending",
      provider: "uber_direct",
      prospectId: "prospect_456",
      pendingSinceMs: 1_700_000_000_000,
    };

    const detail = toIncidentDetail(incident);
    const labels = detail.fields.map((f) => f.label);
    expect(labels).not.toContain("prospectName");
    // The required fields still surface so the panel stays useful.
    expect(labels).toContain("provider");
    expect(labels).toContain("prospectId");
    expect(labels).toContain("pendingSinceMs");
  });

  it("maps a `paid_no_course` incident WITH tenantId: every field + href to /t/[tenantId]/commandes", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
      tenantId: "tenant_khan",
    };

    const detail = toIncidentDetail(incident);
    expect(detail.kind).toBe("paid_no_course");
    expect(detail.typeLabel).toBe("Cmd payée sans course");
    expect(detail.href).toBe("/t/tenant_khan/commandes");

    const byLabel = new Map(detail.fields.map((f) => [f.label, f.value]));
    expect(byLabel.get("orderId")).toBe("order_42");
    expect(byLabel.get("tenantId")).toBe("tenant_khan");
  });

  it("maps a `paid_no_course` incident WITHOUT tenantId: no href, the tenantId field row is omitted", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
    };

    const detail = toIncidentDetail(incident);
    expect(detail.href).toBeUndefined();

    const labels = detail.fields.map((f) => f.label);
    expect(labels).toContain("orderId");
    expect(labels).not.toContain("tenantId");
  });

  it("#415 maps an `auto_expired_burst` incident: every raw field + href to /t/<tenant>/commandes?tab=missed", () => {
    const incident: Incident = {
      kind: "auto_expired_burst",
      tenantId: "tenant_khan",
      tenantName: "Khan's Resto",
      count: 5,
      windowMs: 24 * 60 * 60 * 1000,
      thresholdCount: 3,
    };
    const detail = toIncidentDetail(incident);
    expect(detail.kind).toBe("auto_expired_burst");
    expect(detail.typeLabel).toBe("Cmds manquées (burst)");
    expect(detail.href).toBe("/t/tenant_khan/commandes?tab=missed");

    const byLabel = new Map(detail.fields.map((f) => [f.label, f.value]));
    expect(byLabel.get("tenantId")).toBe("tenant_khan");
    expect(byLabel.get("tenantName")).toBe("Khan's Resto");
    expect(byLabel.get("count")).toBe("5");
    expect(byLabel.get("thresholdCount")).toBe("3");
    expect(byLabel.get("windowMs")).toBe(String(24 * 60 * 60 * 1000));
  });

  it("#415 omits the `tenantName` field row entirely when undefined (auto_expired_burst)", () => {
    const incident: Incident = {
      kind: "auto_expired_burst",
      tenantId: "tenant_anon",
      count: 4,
      windowMs: 24 * 60 * 60 * 1000,
      thresholdCount: 3,
    };
    const detail = toIncidentDetail(incident);
    const labels = detail.fields.map((f) => f.label);
    expect(labels).not.toContain("tenantName");
    expect(labels).toContain("tenantId");
    expect(labels).toContain("count");
  });
});
