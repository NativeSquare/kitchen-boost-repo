import { describe, expect, it } from "vitest";
import { mapWebhookEvent } from "./webhookEvents";

/**
 * 2.6-C — `mapWebhookEvent(payload)`, written BEFORE the implementation (TDD
 * red). PURE mapping of an Uber Direct webhook event onto the internal delivery
 * transition (delivery CONTEXT, PRD 40 §4/§5, research §1.3). No I/O — every Uber
 * event the issue enumerates is exercised here on a fixed payload.
 *
 * Event names + statuses are the documented Uber Direct ones (research §1.3:
 * `event.delivery_status` carrying `pending|pickup|pickup_complete|dropoff|
 * delivered|canceled|returned|failed`, `event.courier_update`), NOT invented.
 * The mapping surfaces, per event: the internal `status`, the courier fields, the
 * ETAs, the incident type (PRD 40 §5 cases A/C/D), the notification trigger
 * consumed by 2.7 (closed `transactionalTrigger` taxonomy) and the KDS signal.
 */

/** A minimal `event.delivery_status` envelope with a given status + data. */
function statusEvent(
  status: string,
  data: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "event.delivery_status",
    delivery_id: "del_uber_1",
    status,
    data: { delivery_id: "del_uber_1", status, ...data },
  };
}

describe("2.6-C mapWebhookEvent — pure Uber event → internal transition", () => {
  it("ignores an unknown / irrelevant event (returns null)", () => {
    expect(mapWebhookEvent({ kind: "event.shopping_progress" })).toBeNull();
    expect(mapWebhookEvent({})).toBeNull();
  });

  it("requires a delivery_id (no id ⇒ null, nothing to route)", () => {
    expect(
      mapWebhookEvent({ kind: "event.delivery_status", status: "pickup" }),
    ).toBeNull();
  });

  it("maps a courier assignment (status pickup + courier) → pickup, courier fields, KDS pickup-eta signal", () => {
    const r = mapWebhookEvent(
      statusEvent("pickup", {
        courier: { name: "Sami", phone_number: "+33600000000" },
        pickup_eta: 1_700_000_000_000,
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.uberDeliveryId).toBe("del_uber_1");
    expect(r?.status).toBe("pickup");
    expect(r?.courierName).toBe("Sami");
    expect(r?.courierPhone).toBe("+33600000000");
    expect(r?.pickupEta).toBe(1_700_000_000_000);
    // KDS pickup-ETA timer signal (PRD 40 §5 wait fee) — courier inbound.
    expect(r?.kdsSignal).toBe("courier_pickup_eta");
  });

  it("maps pickup_complete → pickup_complete + courier_pickup notification", () => {
    const r = mapWebhookEvent(statusEvent("pickup_complete"));
    expect(r?.status).toBe("pickup_complete");
    expect(r?.notificationTrigger).toBe("courier_pickup");
  });

  it("maps dropoff (en route to client) → dropoff + courier_dropoff notification + dropoffEta", () => {
    const r = mapWebhookEvent(
      statusEvent("dropoff", { dropoff_eta: 1_700_000_500_000 }),
    );
    expect(r?.status).toBe("dropoff");
    expect(r?.dropoffEta).toBe(1_700_000_500_000);
    expect(r?.notificationTrigger).toBe("courier_dropoff");
  });

  it("maps delivered → delivered + order_delivered notification, no incident", () => {
    const r = mapWebhookEvent(statusEvent("delivered"));
    expect(r?.status).toBe("delivered");
    expect(r?.notificationTrigger).toBe("order_delivered");
    expect(r?.incidentType).toBeUndefined();
  });

  it("maps canceled (incident after pickup, Cas C) → canceled + incident_after_pickup + uber_course_failed", () => {
    const r = mapWebhookEvent(statusEvent("canceled"));
    expect(r?.status).toBe("canceled");
    expect(r?.incidentType).toBe("incident_after_pickup");
    expect(r?.notificationTrigger).toBe("uber_course_failed");
  });

  it("maps failed (incident after pickup, Cas C) → failed + incident_after_pickup + uber_course_failed", () => {
    const r = mapWebhookEvent(statusEvent("failed"));
    expect(r?.status).toBe("failed");
    expect(r?.incidentType).toBe("incident_after_pickup");
    expect(r?.notificationTrigger).toBe("uber_course_failed");
  });

  it("maps returned (client absent, Cas D) → returned + customer_absent, NO auto-refund notification", () => {
    const r = mapWebhookEvent(statusEvent("returned"));
    expect(r?.status).toBe("returned");
    expect(r?.incidentType).toBe("customer_absent");
    // Cas D: pas de refund auto — the customer-absent push is a dedicated message,
    // NOT one of the closed transactional triggers (no order_delivered/refund).
    expect(r?.notificationTrigger).toBeUndefined();
  });

  it("maps a bare pending status_changed → pending, no notification, no incident", () => {
    const r = mapWebhookEvent(statusEvent("pending"));
    expect(r?.status).toBe("pending");
    expect(r?.notificationTrigger).toBeUndefined();
    expect(r?.incidentType).toBeUndefined();
  });

  it("maps a courier_update (re-dispatch, Cas B) → courier fields only, no status change, no incident", () => {
    const r = mapWebhookEvent({
      kind: "event.courier_update",
      delivery_id: "del_uber_1",
      data: {
        delivery_id: "del_uber_1",
        courier: { name: "Yacine", phone_number: "+33611111111" },
        pickup_eta: 1_700_000_900_000,
      },
    });
    expect(r?.uberDeliveryId).toBe("del_uber_1");
    // Cas B — silent re-dispatch: relay the new courier, NO status transition, no
    // incident, no notification (PRD 40 §5 Cas B).
    expect(r?.status).toBeUndefined();
    expect(r?.courierName).toBe("Yacine");
    expect(r?.courierPhone).toBe("+33611111111");
    expect(r?.incidentType).toBeUndefined();
    expect(r?.notificationTrigger).toBeUndefined();
  });
});
