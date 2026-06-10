/**
 * PWA-S8 (#459) — `decideIncident` — pure decision returning whether the
 * tracking page should render the « Incident livraison, tu as été
 * remboursé » card (PRD 10 §11 « Cas incident », US 54, decisions-log Q7).
 *
 * The incident card is shown WHEN AND ONLY WHEN the delivery row carries
 * an `incidentType ∈ { refused_post_payment, incident_after_pickup }`
 * (PRD 40 §5 — the two AUTO-REFUNDED cases ; `customer_absent` is a
 * resto-discretionary refund and stays silent client-side per PRD 40 §5
 * Cas D — we never auto-display it).
 *
 * Same shape as the other PWA pure decisions so vitest pins every branch
 * in node env.
 */
import { describe, expect, it } from "vitest";
import { decideIncident } from "./decide-incident";

describe("decideIncident", () => {
  it("returns null when no delivery row exists (C&C or pre-course)", () => {
    expect(decideIncident({ incidentType: undefined })).toBeNull();
    expect(decideIncident(null)).toBeNull();
  });

  it("returns the refund card for `refused_post_payment`", () => {
    const incident = decideIncident({
      incidentType: "refused_post_payment",
    });
    expect(incident).not.toBeNull();
    expect(incident?.kind).toBe("auto-refunded");
    expect(incident?.title).toContain("Incident");
    expect(incident?.message).toMatch(/remboursé/);
  });

  it("returns the refund card for `incident_after_pickup`", () => {
    const incident = decideIncident({
      incidentType: "incident_after_pickup",
    });
    expect(incident?.kind).toBe("auto-refunded");
    expect(incident?.message).toMatch(/remboursé/);
  });

  it("returns null for `customer_absent` (silent client-side, PRD 40 §5 Cas D)", () => {
    // Cas D = the resto MAY issue a discretionary refund (geste commercial).
    // The client doesn't see it on the tracking page — they get a separate
    // notification if/when the resto triggers it manually.
    expect(decideIncident({ incidentType: "customer_absent" })).toBeNull();
  });
});
