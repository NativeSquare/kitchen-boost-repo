/**
 * PWA-S8 (#459) — `decideEtaLabel` — pure decision returning the
 * « ETA: 12 min » label rendered on the tracking page (PRD 10 §11, US 51).
 *
 * The ETA shown depends on the COURSE PHASE :
 *  - delivery, before pickup     → `pickupEta`  (« le courier arrive au resto »)
 *  - delivery, after pickup      → `dropoffEta` (« le courier arrive chez toi »)
 *  - delivery, terminal          → null (the step list shows « Livrée »)
 *  - click & collect             → null (no Uber ETA — the kitchen ETA is V2)
 *
 * The ETA is a wall-clock TIMESTAMP (ms) coming from Uber Direct webhooks
 * (decisions-log Q7). We convert it to a delta « X min » against `nowMs`,
 * rounded UP to the next minute so a 30-second remainder doesn't display
 * « 0 min ». A past ETA collapses to « Bientôt » (the courier is overdue
 * but not declared an incident yet — the « petit retard » signal lives
 * elsewhere, PRD 40 §5 Cas B).
 */
import { describe, expect, it } from "vitest";
import { decideEtaLabel } from "./decide-eta-label";

const NOW = 1_700_000_000_000;

describe("decideEtaLabel — delivery mode", () => {
  it("returns null when no ETA is available yet (pre-pickup, courier not yet assigned)", () => {
    expect(
      decideEtaLabel({
        mode: "delivery",
        deliveryStatus: "pending",
        pickupEta: undefined,
        dropoffEta: undefined,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("uses `pickupEta` before pickup_complete (courier going to resto)", () => {
    const label = decideEtaLabel({
      mode: "delivery",
      deliveryStatus: "pickup",
      pickupEta: NOW + 12 * 60_000,
      dropoffEta: NOW + 25 * 60_000,
      nowMs: NOW,
    });
    expect(label).toBe("ETA : 12 min");
  });

  it("uses `dropoffEta` after pickup_complete (courier en route to client)", () => {
    const label = decideEtaLabel({
      mode: "delivery",
      deliveryStatus: "pickup_complete",
      pickupEta: NOW - 5 * 60_000, // already past
      dropoffEta: NOW + 8 * 60_000,
      nowMs: NOW,
    });
    expect(label).toBe("ETA : 8 min");
  });

  it("uses `dropoffEta` during `dropoff` (courier still en route to client)", () => {
    const label = decideEtaLabel({
      mode: "delivery",
      deliveryStatus: "dropoff",
      pickupEta: NOW - 5 * 60_000,
      dropoffEta: NOW + 3 * 60_000,
      nowMs: NOW,
    });
    expect(label).toBe("ETA : 3 min");
  });

  it("rounds UP a fractional minute (90s remainder → 2 min, not 1 min)", () => {
    const label = decideEtaLabel({
      mode: "delivery",
      deliveryStatus: "pickup",
      pickupEta: NOW + 90_000, // 1.5 min
      dropoffEta: undefined,
      nowMs: NOW,
    });
    expect(label).toBe("ETA : 2 min");
  });

  it("collapses a past ETA to « Bientôt » (overdue, no negative minutes shown)", () => {
    const label = decideEtaLabel({
      mode: "delivery",
      deliveryStatus: "pickup",
      pickupEta: NOW - 60_000,
      dropoffEta: undefined,
      nowMs: NOW,
    });
    expect(label).toBe("Bientôt");
  });

  it("returns null on terminal `delivered` (the step list shows « Livrée »)", () => {
    const label = decideEtaLabel({
      mode: "delivery",
      deliveryStatus: "delivered",
      pickupEta: NOW - 30 * 60_000,
      dropoffEta: NOW - 5 * 60_000,
      nowMs: NOW,
    });
    expect(label).toBeNull();
  });

  it("returns null on incident states (failed / canceled) — incident card takes over", () => {
    expect(
      decideEtaLabel({
        mode: "delivery",
        deliveryStatus: "failed",
        pickupEta: NOW + 5 * 60_000,
        dropoffEta: undefined,
        nowMs: NOW,
      }),
    ).toBeNull();
    expect(
      decideEtaLabel({
        mode: "delivery",
        deliveryStatus: "canceled",
        pickupEta: undefined,
        dropoffEta: undefined,
        nowMs: NOW,
      }),
    ).toBeNull();
  });
});

describe("decideEtaLabel — click & collect mode", () => {
  it("returns null for pickup mode (no Uber ETA; kitchen ETA is V2)", () => {
    expect(
      decideEtaLabel({
        mode: "pickup",
        deliveryStatus: "pending",
        pickupEta: undefined,
        dropoffEta: undefined,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("returns null even if deliveries.pickupEta happened to be set defensively", () => {
    expect(
      decideEtaLabel({
        mode: "pickup",
        deliveryStatus: "pickup_complete",
        pickupEta: NOW + 5 * 60_000,
        dropoffEta: undefined,
        nowMs: NOW,
      }),
    ).toBeNull();
  });
});
