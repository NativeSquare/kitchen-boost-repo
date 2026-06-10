/**
 * PWA-S8 (#459) — `decideTrackingSteps` — pure decision returning the
 * ordered list of tracking steps for `/c/[orderId]` (US 51 animations
 * étapes / US 52 Convex sub realtime — decisions-log Q7).
 *
 * PRD 10 §11 mapping :
 *  - 6 étapes delivery : `Cmd reçue` → `En préparation` → `Courier assigné`
 *    → `Courier en route vers le resto` → `Courier en route vers toi` →
 *    `Livrée`.
 *  - 3 étapes C&C : `Cmd reçue` → `En préparation` → `Prête à récupérer`.
 *
 * The combined state is derived from the order workflow status (PRD 20 §5)
 * AND the delivery status (`deliveries.status`, PRD 40 §4 — Uber Direct
 * lifecycle for delivery, KDS for C&C). The mapper takes the two signals +
 * the mode and emits ONE step list with each step tagged
 * `done` / `current` / `pending`. The React surface only has to render
 * these tags.
 *
 * PURE on purpose — no Convex, no DOM, no time, no env. The React surface
 * reads the live snapshot from `useQuery` and re-runs the mapper on every
 * Convex push (re-render < 500ms target, decisions-log Q7).
 */

/** Closed set of order workflow states (mirrors `table/orders.orderStatus`). */
export type OrderStatus =
  | "en attente de paiement"
  | "nouvelle"
  | "en préparation"
  | "prête"
  | "remise"
  | "livrée"
  | "collectée"
  | "refusée"
  | "auto_expired";

/** Closed set of delivery statuses (mirrors `table/deliveries.deliveryStatus`). */
export type DeliveryStatus =
  | "pending"
  | "pickup"
  | "pickup_complete"
  | "dropoff"
  | "delivered"
  | "canceled"
  | "returned"
  | "failed";

/** Where each step sits in the linear timeline at the moment of the read. */
export type StepState = "done" | "current" | "pending";

/** A stable, codepath-friendly key for each rendered step (data-test, CSS). */
export type StepKey =
  // delivery 6-step + C&C 3-step shared prefix
  | "received"
  | "preparing"
  // delivery only
  | "courier_assigned"
  | "courier_to_resto"
  | "courier_to_you"
  | "delivered"
  // C&C only
  | "ready_to_pickup";

export type TrackingStep = {
  key: StepKey;
  label: string;
  state: StepState;
};

export type DecideTrackingStepsInput = {
  mode: "delivery" | "pickup";
  orderStatus: OrderStatus;
  /** `null` when no delivery row exists yet (C&C, or pre-course race). */
  deliveryStatus: DeliveryStatus | null;
};

/**
 * Decide the steps list for the tracking page. Pure. Returns 6 steps in
 * `delivery` mode and 3 in `pickup` mode (PRD 10 §11). The mapper picks
 * the « current » step from the highest-progressed signal of order +
 * delivery, marks every previous step `done`, and leaves the rest
 * `pending`. Defensive on every closed-set value : an unknown delivery
 * status (V2 enum drift) collapses to the order-side state alone.
 */
export function decideTrackingSteps(
  input: DecideTrackingStepsInput,
): TrackingStep[] {
  if (input.mode === "pickup") {
    return clickAndCollectSteps(input.orderStatus);
  }
  return deliverySteps(input.orderStatus, input.deliveryStatus);
}

// ---------------------------------------------------------------------------
// Delivery — 6 steps
// ---------------------------------------------------------------------------

const DELIVERY_KEYS: StepKey[] = [
  "received",
  "preparing",
  "courier_assigned",
  "courier_to_resto",
  "courier_to_you",
  "delivered",
];

const DELIVERY_LABELS: Record<StepKey, string> = {
  received: "Cmd reçue",
  preparing: "En préparation",
  courier_assigned: "Courier assigné",
  courier_to_resto: "Courier en route vers le resto",
  courier_to_you: "Courier en route vers toi",
  delivered: "Livrée",
  ready_to_pickup: "Prête à récupérer", // unused in delivery, here for the shared map
};

/** The 0-based index of the « current » step, given the joint signals. */
function deliveryCurrentIndex(
  orderStatus: OrderStatus,
  deliveryStatus: DeliveryStatus | null,
): number {
  // Terminal — everything done.
  if (orderStatus === "livrée") return 5; // last step is « Livrée »
  if (deliveryStatus === "delivered") return 5;

  // Delivery-side signals win once a course exists (the order can sit at
  // « prête » / « remise » while the courier is in motion).
  if (deliveryStatus === "dropoff") return 4; // courier_to_you
  if (deliveryStatus === "pickup_complete") return 4;
  if (deliveryStatus === "pickup") return 3; // courier_to_resto

  // Order-side signals (no course yet, or pre-pickup terminal cases).
  if (orderStatus === "remise") return 4; // courier_to_you (handed over)
  if (orderStatus === "prête") return 3; // courier_to_resto (waiting pickup)
  if (orderStatus === "en préparation") return 1; // preparing
  if (orderStatus === "nouvelle") return 0; // received (paid, accepted)
  if (orderStatus === "en attente de paiement") return 0; // race: post-redirect, pre-webhook

  // Terminal failure cases (refusée / auto_expired) — we leave « received »
  // done so the timeline reads truthfully ; the incident card takes over
  // visually (decideIncident).
  if (orderStatus === "refusée" || orderStatus === "auto_expired") return 0;

  // Defensive fallthrough — never reached given the closed enum, but
  // guarantees a deterministic output if the enum drifts (V2 add).
  return 0;
}

function deliverySteps(
  orderStatus: OrderStatus,
  deliveryStatus: DeliveryStatus | null,
): TrackingStep[] {
  const currentIndex = deliveryCurrentIndex(orderStatus, deliveryStatus);
  // Terminal: every step done.
  const allDone = orderStatus === "livrée" || deliveryStatus === "delivered";
  // For terminal failure (refusée / auto_expired), only « received » is done
  // — the rest stays pending so the visual timeline reflects « the kitchen
  // never moved past it ». The incident card carries the real message.
  const terminalFail =
    orderStatus === "refusée" || orderStatus === "auto_expired";

  return DELIVERY_KEYS.map((key, idx): TrackingStep => {
    let state: StepState;
    if (allDone) {
      state = "done";
    } else if (terminalFail) {
      state = idx === 0 ? "done" : "pending";
    } else if (idx < currentIndex) {
      state = "done";
    } else if (idx === currentIndex) {
      state = "current";
    } else {
      state = "pending";
    }
    return { key, label: DELIVERY_LABELS[key], state };
  });
}

// ---------------------------------------------------------------------------
// Click & collect — 3 steps
// ---------------------------------------------------------------------------

const PICKUP_KEYS: StepKey[] = ["received", "preparing", "ready_to_pickup"];

const PICKUP_LABELS: Record<StepKey, string> = {
  received: "Cmd reçue",
  preparing: "En préparation",
  ready_to_pickup: "Prête à récupérer",
  // Unused in pickup mode but typed-completeness :
  courier_assigned: "",
  courier_to_resto: "",
  courier_to_you: "",
  delivered: "",
};

function pickupCurrentIndex(orderStatus: OrderStatus): number {
  if (orderStatus === "collectée") return 2;
  if (orderStatus === "remise") return 2;
  if (orderStatus === "prête") return 2;
  if (orderStatus === "en préparation") return 1;
  if (orderStatus === "nouvelle") return 0;
  if (orderStatus === "en attente de paiement") return 0;
  // Terminal failure (refusée / auto_expired) — same shape as delivery.
  return 0;
}

function clickAndCollectSteps(orderStatus: OrderStatus): TrackingStep[] {
  const currentIndex = pickupCurrentIndex(orderStatus);
  const allDone = orderStatus === "collectée";
  const terminalFail =
    orderStatus === "refusée" || orderStatus === "auto_expired";
  return PICKUP_KEYS.map((key, idx): TrackingStep => {
    let state: StepState;
    if (allDone) {
      state = "done";
    } else if (terminalFail) {
      state = idx === 0 ? "done" : "pending";
    } else if (idx < currentIndex) {
      state = "done";
    } else if (idx === currentIndex) {
      state = "current";
    } else {
      state = "pending";
    }
    return { key, label: PICKUP_LABELS[key], state };
  });
}
