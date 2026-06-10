/**
 * PWA-S8 (#459) — `decideEtaLabel` — pure decision returning the
 * « ETA : 12 min » label rendered on the tracking page (PRD 10 §11, US 51).
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
 *
 * PURE on purpose : `nowMs` is injected so the test pins every branch
 * deterministically, same shape as `lib/orders/status.ts`'s pure mappers.
 */
import type { DeliveryStatus } from "./decide-tracking-steps";

export type DecideEtaLabelInput = {
  mode: "delivery" | "pickup";
  deliveryStatus: DeliveryStatus | null;
  pickupEta: number | undefined;
  dropoffEta: number | undefined;
  nowMs: number;
};

/**
 * Decide the ETA label string, or `null` if none should be shown. The
 * caller (React) re-runs this against `Date.now()` on every Convex push +
 * a `setInterval` tick (~30s, matches Uber webhook cadence per Q7).
 */
export function decideEtaLabel(input: DecideEtaLabelInput): string | null {
  if (input.mode === "pickup") return null;

  // Terminal / incident states — the timeline / incident card take over.
  const ds = input.deliveryStatus;
  if (
    ds === "delivered" ||
    ds === "canceled" ||
    ds === "returned" ||
    ds === "failed"
  ) {
    return null;
  }

  // Pick the relevant ETA. Pre-pickup = pickupEta ; post-pickup = dropoffEta.
  // The two are NOT mutually exclusive on the wire (Uber sends both), so the
  // PHASE is the disambiguator — never their presence.
  let targetMs: number | undefined;
  if (ds === "pickup_complete" || ds === "dropoff") {
    targetMs = input.dropoffEta;
  } else {
    targetMs = input.pickupEta;
  }
  if (targetMs === undefined) return null;

  const deltaMs = targetMs - input.nowMs;
  if (deltaMs <= 0) return "Bientôt";

  // Round UP : a 90s remainder reads « 2 min », never « 1 min ».
  const minutes = Math.ceil(deltaMs / 60_000);
  return `ETA : ${minutes} min`;
}
