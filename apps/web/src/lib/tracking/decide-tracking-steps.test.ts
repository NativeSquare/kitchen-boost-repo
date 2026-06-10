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
 * lifecycle for delivery, KDS for C&C). The pure mapper takes the two
 * signals + the mode and emits ONE step list with each step tagged
 * `done` / `current` / `pending`. The React surface only has to render
 * these tags.
 *
 * Same shape as the other PWA pure decisions (`decideAddressFirstAction`,
 * `decidePaymentBranch`, `decideCheckoutRedirect`) so vitest pins every
 * branch in node env.
 */
import { describe, expect, it } from "vitest";
import {
  decideTrackingSteps,
  type DeliveryStatus,
  type OrderStatus,
} from "./decide-tracking-steps";

describe("decideTrackingSteps — delivery (6 étapes)", () => {
  it("post-paiement T+0 (nouvelle, no delivery yet) → step 1 'Cmd reçue' is current, rest pending", () => {
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "nouvelle",
      deliveryStatus: null,
    });
    expect(steps).toHaveLength(6);
    expect(steps[0]).toMatchObject({ key: "received", state: "current" });
    expect(steps[1]).toMatchObject({ key: "preparing", state: "pending" });
    expect(steps[2]).toMatchObject({
      key: "courier_assigned",
      state: "pending",
    });
    expect(steps[3]).toMatchObject({
      key: "courier_to_resto",
      state: "pending",
    });
    expect(steps[4]).toMatchObject({ key: "courier_to_you", state: "pending" });
    expect(steps[5]).toMatchObject({ key: "delivered", state: "pending" });
  });

  it("'en préparation' marks 'Cmd reçue' done + 'En préparation' current", () => {
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "en préparation",
      deliveryStatus: "pending",
    });
    expect(steps[0]?.state).toBe("done");
    expect(steps[1]?.state).toBe("current");
    expect(steps[2]?.state).toBe("pending");
  });

  it("delivery 'pickup' (courier en route vers le resto) → step 4 current", () => {
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "prête",
      deliveryStatus: "pickup",
    });
    expect(steps[0]?.state).toBe("done");
    expect(steps[1]?.state).toBe("done");
    expect(steps[2]?.state).toBe("done"); // courier assigned (implied by pickup)
    expect(steps[3]?.state).toBe("current"); // courier_to_resto
    expect(steps[4]?.state).toBe("pending");
    expect(steps[5]?.state).toBe("pending");
  });

  it("delivery 'pickup_complete' (courier en route vers toi) → step 5 current", () => {
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "remise",
      deliveryStatus: "pickup_complete",
    });
    expect(steps[3]?.state).toBe("done");
    expect(steps[4]?.state).toBe("current"); // courier_to_you
    expect(steps[5]?.state).toBe("pending");
  });

  it("delivery 'dropoff' → step 5 still current (delivering to client)", () => {
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "remise",
      deliveryStatus: "dropoff",
    });
    expect(steps[4]?.state).toBe("current");
    expect(steps[5]?.state).toBe("pending");
  });

  it("order 'livrée' → every step done", () => {
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "livrée",
      deliveryStatus: "delivered",
    });
    for (const step of steps) {
      expect(step.state).toBe("done");
    }
  });
});

describe("decideTrackingSteps — click & collect (3 étapes)", () => {
  it("'nouvelle' → step 1 current, rest pending", () => {
    const steps = decideTrackingSteps({
      mode: "pickup",
      orderStatus: "nouvelle",
      deliveryStatus: null,
    });
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ key: "received", state: "current" });
    expect(steps[1]).toMatchObject({ key: "preparing", state: "pending" });
    expect(steps[2]).toMatchObject({
      key: "ready_to_pickup",
      state: "pending",
    });
  });

  it("'en préparation' → step 2 current", () => {
    const steps = decideTrackingSteps({
      mode: "pickup",
      orderStatus: "en préparation",
      deliveryStatus: "pending",
    });
    expect(steps[0]?.state).toBe("done");
    expect(steps[1]?.state).toBe("current");
    expect(steps[2]?.state).toBe("pending");
  });

  it("'prête' → step 3 current (ready to pickup)", () => {
    const steps = decideTrackingSteps({
      mode: "pickup",
      orderStatus: "prête",
      deliveryStatus: "pickup_complete",
    });
    expect(steps[0]?.state).toBe("done");
    expect(steps[1]?.state).toBe("done");
    expect(steps[2]?.state).toBe("current");
  });

  it("'collectée' → every step done", () => {
    const steps = decideTrackingSteps({
      mode: "pickup",
      orderStatus: "collectée",
      deliveryStatus: "delivered",
    });
    for (const step of steps) {
      expect(step.state).toBe("done");
    }
  });
});

describe("decideTrackingSteps — edge cases", () => {
  it("'en attente de paiement' (race after redirect, webhook not yet) → step 1 current", () => {
    // The redirect can happen a few hundred ms before the Stripe webhook
    // confirms the order. The tracking page MUST render the « Cmd reçue »
    // state immediately (US 50) — no crash, no « Order not found ».
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "en attente de paiement",
      deliveryStatus: null,
    });
    expect(steps).toHaveLength(6);
    expect(steps[0]?.state).toBe("current");
    expect(steps[1]?.state).toBe("pending");
  });

  it("'refusée' → step 1 done, rest pending (terminal handled separately)", () => {
    // The refusal card is rendered by a SEPARATE block (decideIncident);
    // the step list still reflects « received » as done — the order DID
    // exist and reach the kitchen.
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "refusée",
      deliveryStatus: null,
    });
    expect(steps[0]?.state).toBe("done");
    expect(steps[1]?.state).toBe("pending");
  });

  it("delivery 'failed' / 'canceled' → preserve done steps, don't crash", () => {
    // Defensive: an Uber failure mid-course shouldn't blow up the step
    // mapper. The incident card handles the user-visible message.
    const failed: DeliveryStatus = "failed";
    const canceled: DeliveryStatus = "canceled";
    expect(() =>
      decideTrackingSteps({
        mode: "delivery",
        orderStatus: "en préparation",
        deliveryStatus: failed,
      }),
    ).not.toThrow();
    expect(() =>
      decideTrackingSteps({
        mode: "delivery",
        orderStatus: "en préparation",
        deliveryStatus: canceled,
      }),
    ).not.toThrow();
  });

  it("each step carries a human-readable French label", () => {
    const steps = decideTrackingSteps({
      mode: "delivery",
      orderStatus: "nouvelle",
      deliveryStatus: null,
    });
    expect(steps[0]?.label).toBe("Cmd reçue");
    expect(steps[1]?.label).toBe("En préparation");
    expect(steps[5]?.label).toBe("Livrée");
  });

  it("C&C step 3 label = 'Prête à récupérer'", () => {
    const steps = decideTrackingSteps({
      mode: "pickup",
      orderStatus: "prête",
      deliveryStatus: null,
    });
    expect(steps[2]?.label).toBe("Prête à récupérer");
  });
});

describe("decideTrackingSteps — type narrowness", () => {
  it("OrderStatus union covers every workflow state used", () => {
    // Compile-time check: every status the backend emits must be a valid
    // input. Listed here so a future enum drift breaks the test build.
    const all: OrderStatus[] = [
      "en attente de paiement",
      "nouvelle",
      "en préparation",
      "prête",
      "remise",
      "livrée",
      "collectée",
      "refusée",
      "auto_expired",
    ];
    for (const s of all) {
      expect(() =>
        decideTrackingSteps({
          mode: "delivery",
          orderStatus: s,
          deliveryStatus: null,
        }),
      ).not.toThrow();
    }
  });
});
