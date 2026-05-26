import type {
  DeliveryIncidentType,
  DeliveryStatus,
} from "../../table/deliveries";
import type { TransactionalTrigger } from "../../table/notifications";

/**
 * 2.6-C — `mapWebhookEvent`: the PURE mapping of an Uber Direct webhook event
 * onto the internal delivery transition (delivery CONTEXT, PRD 40 §4/§5, research
 * §1.3). No I/O — it takes the parsed JSON payload and returns the fields to
 * persist on the `deliveries` row (status / courier / ETA / incident) plus the
 * side-effect triggers the webhook handler must emit (the notification trigger
 * consumed by 2.7, the KDS signal). The handler owns the persistence + dispatch;
 * this module owns the DECISION, so it is unit-tested exhaustively on fixtures.
 *
 * Event names + statuses are the documented Uber Direct ones (research §1.3), NOT
 * invented: `event.delivery_status` carries one of `pending | pickup |
 * pickup_complete | dropoff | delivered | canceled | returned | failed`;
 * `event.courier_update` carries a (possibly new) courier without a status change
 * (PRD 40 §5 Cas B — silent re-dispatch). The 3 incident cases map per PRD 40 §5 /
 * Q40-Q13: `canceled`/`failed` ⇒ `incident_after_pickup` (Cas C, refund auto in
 * slice D), `returned` ⇒ `customer_absent` (Cas D, NO auto-refund). The Cas A
 * "course refused post-payment" incident is NOT a webhook status — it is the
 * Create Delivery refusal handled in `createCourseOnPaymentConfirmed`.
 *
 * The notification trigger is drawn ONLY from the closed `transactionalTrigger`
 * taxonomy (notifications schema, ADR 0006): `courier_pickup` (pickup_complete),
 * `courier_dropoff` (dropoff, en route to client), `order_delivered` (delivered),
 * `uber_course_failed` (canceled/failed). The customer-absent (`returned`) push is
 * a dedicated message (PRD 40 §5 Cas D), NOT one of the closed triggers, so it
 * carries no `notificationTrigger` here.
 */

/** The KDS coulisses signal a transition raises (PRD 40 §5 wait fee). */
export type KdsSignal = "courier_pickup_eta";

/**
 * The outcome of mapping one event. `status` is ABSENT for a `courier_update`
 * (Cas B — relay the courier, do not transition). `null` (from `mapWebhookEvent`)
 * means the event is irrelevant / unroutable and must be ignored.
 */
export type WebhookTransition = {
  /** The Uber delivery id the event concerns (the routing key on `deliveries`). */
  uberDeliveryId: string;
  /** The new internal status, or absent when the event carries no transition. */
  status?: DeliveryStatus;
  courierName?: string;
  courierPhone?: string;
  pickupEta?: number;
  dropoffEta?: number;
  /** Set for the incident cases (PRD 40 §5 C/D). */
  incidentType?: DeliveryIncidentType;
  /** The transactional notification to fire (2.7), if any. */
  notificationTrigger?: TransactionalTrigger;
  /** The KDS coulisses signal to raise, if any. */
  kdsSignal?: KdsSignal;
};

/** The documented Uber delivery statuses (research §1.3) — the closed set. */
const UBER_STATUSES: readonly DeliveryStatus[] = [
  "pending",
  "pickup",
  "pickup_complete",
  "dropoff",
  "delivered",
  "canceled",
  "returned",
  "failed",
] as const;

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/** Pull the courier name / phone out of a `{ courier: {...} }` data block. */
function readCourier(data: Record<string, unknown>): {
  courierName?: string;
  courierPhone?: string;
} {
  const courier =
    data.courier && typeof data.courier === "object"
      ? (data.courier as Record<string, unknown>)
      : {};
  return {
    courierName: asString(courier.name),
    courierPhone: asString(courier.phone_number),
  };
}

/**
 * Map a parsed Uber webhook payload onto the internal transition, or `null` to
 * ignore it. The `delivery_id` is read from the top level or the nested `data`
 * (Uber nests the resource under `data`); without it there is nothing to route.
 */
export function mapWebhookEvent(
  payload: Record<string, unknown>,
): WebhookTransition | null {
  const kind = asString(payload.kind);
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};

  const uberDeliveryId =
    asString(payload.delivery_id) ?? asString(data.delivery_id);
  if (uberDeliveryId === undefined) return null;

  const courier = readCourier(data);
  const pickupEta = asNumber(data.pickup_eta);
  const dropoffEta = asNumber(data.dropoff_eta);

  // Cas B — silent re-dispatch: relay the (new) courier, NO status transition,
  // no incident, no notification (PRD 40 §5 Cas B).
  if (kind === "event.courier_update") {
    return {
      uberDeliveryId,
      ...courier,
      ...(pickupEta !== undefined ? { pickupEta } : {}),
      ...(dropoffEta !== undefined ? { dropoffEta } : {}),
    };
  }

  if (kind !== "event.delivery_status") return null;

  const rawStatus = asString(payload.status) ?? asString(data.status);
  const status = UBER_STATUSES.find((s) => s === rawStatus);
  if (status === undefined) return null;

  const out: WebhookTransition = {
    uberDeliveryId,
    status,
    ...courier,
    ...(pickupEta !== undefined ? { pickupEta } : {}),
    ...(dropoffEta !== undefined ? { dropoffEta } : {}),
  };

  switch (status) {
    case "pickup":
      // Courier inbound to the resto — raise the KDS pickup-ETA timer (wait fee).
      out.kdsSignal = "courier_pickup_eta";
      break;
    case "pickup_complete":
      out.notificationTrigger = "courier_pickup";
      break;
    case "dropoff":
      out.notificationTrigger = "courier_dropoff";
      break;
    case "delivered":
      out.notificationTrigger = "order_delivered";
      break;
    case "canceled":
    case "failed":
      // Cas C — incident after pickup: refund auto (slice D) + push.
      out.incidentType = "incident_after_pickup";
      out.notificationTrigger = "uber_course_failed";
      break;
    case "returned":
      // Cas D — client absent: NO auto-refund; the push is a dedicated message.
      out.incidentType = "customer_absent";
      break;
    default:
      // `pending` — no notification, no incident.
      break;
  }

  return out;
}
