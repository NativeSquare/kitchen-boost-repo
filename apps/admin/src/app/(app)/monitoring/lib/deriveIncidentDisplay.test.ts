/**
 * F-MONITORING — `deriveIncidentDisplay` (issue #177, parent EPIC #147).
 *
 * Pure mapping `Incident → { severity, label, href? }` consumed by the
 * monitoring dashboard table + drill-down panel (next slice). NO React, NO
 * Convex here — the discriminated `Incident` union is the only input, the
 * display tuple is the only output. Mapping is the one Alex froze in the
 * F-MONITORING handoff (cf. EPIC #147 "Implementation Decisions"):
 *
 *  - `kyc_pending`       → `warning`,  href `/pipeline/[prospectId]`
 *  - `webhook_latency`   → `critical`, no href V1 (no per-webhook fiche yet)
 *  - `paid_no_course`    → `critical`, href `/t/[tenantId]/commandes` only if
 *    `tenantId` is present (the backend union types it as optional — when
 *    absent we can't build the link, so we just don't).
 *
 * These tests pin both branches of `paid_no_course` (with and without
 * `tenantId`), so a future refactor that drops the optional check breaks
 * loudly.
 */
import { describe, expect, it } from "vitest";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import { deriveIncidentDisplay } from "./deriveIncidentDisplay";

describe("deriveIncidentDisplay", () => {
  it("maps `kyc_pending` to a warning with the prospect fiche href", () => {
    const incident: Incident = {
      kind: "kyc_pending",
      provider: "stripe",
      prospectId: "prospect_123",
      prospectName: "L'Artisan",
      pendingSinceMs: 1_700_000_000_000,
    };

    expect(deriveIncidentDisplay(incident)).toEqual({
      severity: "warning",
      label: "KYC en attente",
      href: "/pipeline/prospect_123",
    });
  });

  it("maps `webhook_latency` to a critical with NO href (V1 — no per-webhook fiche)", () => {
    const incident: Incident = {
      kind: "webhook_latency",
      provider: "stripe",
      externalId: "evt_abc",
      latencyMs: 45_000,
    };

    const display = deriveIncidentDisplay(incident);
    expect(display.severity).toBe("critical");
    expect(display.label).toBe("Webhook lent");
    expect(display.href).toBeUndefined();
  });

  it("maps `paid_no_course` WITH a tenantId to a critical pointing at that tenant's commandes view", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
      tenantId: "tenant_khan",
    };

    expect(deriveIncidentDisplay(incident)).toEqual({
      severity: "critical",
      label: "Cmd payée sans course",
      href: "/t/tenant_khan/commandes",
    });
  });

  it("maps `paid_no_course` WITHOUT a tenantId to a critical with NO href (can't build the link)", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
    };

    const display = deriveIncidentDisplay(incident);
    expect(display.severity).toBe("critical");
    expect(display.label).toBe("Cmd payée sans course");
    expect(display.href).toBeUndefined();
  });
});
