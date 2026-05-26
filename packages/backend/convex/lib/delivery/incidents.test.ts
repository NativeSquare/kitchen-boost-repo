import { describe, expect, it } from "vitest";
import {
  PETIT_RETARD_THRESHOLD_MS,
  incidentRefundPolicy,
  resolveCourierDrift,
} from "./incidents";

/**
 * 2.6-D — the PURE delivery-incident policy (delivery CONTEXT Q40-Q6→Q40-Q14
 * acted, PRD 40 §5), written BEFORE the implementation (TDD red). No I/O: every
 * one of the 4 acted cases is a deterministic policy lookup / computation here.
 *
 * `incidentRefundPolicy(incidentType)` is the static policy table of the 3
 * persisted incident types + the Create-Delivery `refused_post_payment` refusal:
 * whether KB auto-refunds (via 2.5), whether the resto's manual-refund button is
 * exposed, which dedicated client push fires, and whether the kitchen (KDS) is
 * suppressed. `resolveCourierDrift(prior, transition)` is the Cas B passive
 * re-dispatch ETA accumulation — the "petit retard ⏰" push fires ONLY past the
 * 10-min cumulative drift threshold. NO case is invented (exactly the 4 acted).
 */

describe("2.6-D incidentRefundPolicy — the acted policy of the incident cases", () => {
  it("refused_post_payment (Cas A) → auto-refund, NO manual button, NO KDS, refused push", () => {
    const p = incidentRefundPolicy("refused_post_payment");
    expect(p.autoRefund).toBe(true);
    expect(p.manualRefundAvailable).toBe(false);
    // Cuisine non notifiée — the order was never transmitted to the KDS.
    expect(p.suppressKds).toBe(true);
    expect(p.incidentPush).toBe("delivery_unavailable");
  });

  it("incident_after_pickup (Cas C) → auto-refund total, NO manual button, incident push", () => {
    const p = incidentRefundPolicy("incident_after_pickup");
    expect(p.autoRefund).toBe(true);
    expect(p.manualRefundAvailable).toBe(false);
    expect(p.incidentPush).toBe("delivery_incident");
    // KB does NOT touch the kitchen here (the order was already worked/picked up).
    expect(p.suppressKds).toBe(false);
  });

  it("customer_absent (Cas D) → NO auto-refund, manual button exposed, contact-resto push", () => {
    const p = incidentRefundPolicy("customer_absent");
    // Client en faute — pas de refund auto.
    expect(p.autoRefund).toBe(false);
    // Geste commercial à la discrétion du resto.
    expect(p.manualRefundAvailable).toBe(true);
    expect(p.incidentPush).toBe("customer_absent");
    expect(p.suppressKds).toBe(false);
  });
});

describe("2.6-D resolveCourierDrift — Cas B passive re-dispatch + petit-retard gate", () => {
  it("the 10-min threshold is exactly 10 minutes in ms", () => {
    expect(PETIT_RETARD_THRESHOLD_MS).toBe(10 * 60 * 1000);
  });

  it("no prior ETA and no new ETA ⇒ no drift, no petit-retard", () => {
    const r = resolveCourierDrift({}, {});
    expect(r.cumulativeEtaDriftMs).toBe(0);
    expect(r.petitRetard).toBe(false);
  });

  it("a NEW pickup ETA later than the prior one accumulates the positive slip", () => {
    const r = resolveCourierDrift(
      { pickupEta: 1_700_000_000_000, cumulativeEtaDriftMs: 0 },
      { pickupEta: 1_700_000_300_000 }, // +5 min
    );
    expect(r.cumulativeEtaDriftMs).toBe(5 * 60 * 1000);
    expect(r.petitRetard).toBe(false); // 5 min ≤ 10 min threshold
  });

  it("an EARLIER new ETA never decreases the cumulative drift (clamped at 0 slip)", () => {
    const r = resolveCourierDrift(
      { pickupEta: 1_700_000_300_000, cumulativeEtaDriftMs: 2 * 60 * 1000 },
      { pickupEta: 1_700_000_000_000 }, // courier now earlier
    );
    expect(r.cumulativeEtaDriftMs).toBe(2 * 60 * 1000); // unchanged, no negative slip
    expect(r.petitRetard).toBe(false);
  });

  it("cumulative drift crossing 10 min fires the petit-retard push exactly when > threshold", () => {
    // prior cumulative 7 min, a fresh +4 min slip ⇒ 11 min > 10 min ⇒ push.
    const r = resolveCourierDrift(
      { pickupEta: 1_700_000_000_000, cumulativeEtaDriftMs: 7 * 60 * 1000 },
      { pickupEta: 1_700_000_240_000 }, // +4 min
    );
    expect(r.cumulativeEtaDriftMs).toBe(11 * 60 * 1000);
    expect(r.petitRetard).toBe(true);
  });

  it("drift of EXACTLY 10 min does NOT fire (strictly greater than 10 min, CONTEXT)", () => {
    const r = resolveCourierDrift(
      { pickupEta: 1_700_000_000_000, cumulativeEtaDriftMs: 0 },
      { pickupEta: 1_700_000_000_000 + 10 * 60 * 1000 },
    );
    expect(r.cumulativeEtaDriftMs).toBe(10 * 60 * 1000);
    expect(r.petitRetard).toBe(false);
  });

  it("once past the threshold, a further slip does NOT re-fire the petit-retard (one-shot)", () => {
    // Already over threshold (12 min), a +3 min slip ⇒ 15 min: still over, but the
    // push already fired on the crossing — do not spam the client again.
    const r = resolveCourierDrift(
      { pickupEta: 1_700_000_000_000, cumulativeEtaDriftMs: 12 * 60 * 1000 },
      { pickupEta: 1_700_000_180_000 }, // +3 min
    );
    expect(r.cumulativeEtaDriftMs).toBe(15 * 60 * 1000);
    expect(r.petitRetard).toBe(false); // crossing already happened earlier
  });

  it("uses dropoff ETA slip when no pickup ETA is present (also drifts)", () => {
    const r = resolveCourierDrift(
      { dropoffEta: 1_700_000_000_000, cumulativeEtaDriftMs: 9 * 60 * 1000 },
      { dropoffEta: 1_700_000_000_000 + 2 * 60 * 1000 }, // +2 min ⇒ 11 min
    );
    expect(r.cumulativeEtaDriftMs).toBe(11 * 60 * 1000);
    expect(r.petitRetard).toBe(true);
  });
});
