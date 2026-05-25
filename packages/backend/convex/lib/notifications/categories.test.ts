import { describe, expect, it } from "vitest";
import {
  ARCHIVE_TRIGGERS,
  INFO_STATUT_TRIGGERS,
  SMS_FALLBACK_TRIGGERS,
  TEMPS_REEL_TRIGGERS,
  TRANSACTIONAL_ROUTING,
  type TransactionalTrigger,
  categoryForTrigger,
  channelsForTrigger,
  smsFallbackEligible,
} from "./categories";

/**
 * 2.7-B — the WIRED V1 channel routing of the 8 transactional triggers into the
 * 3 categories (Archive / Temps-réel / Info statut), written BEFORE the module
 * (TDD red). This is a PURE module — no Convex ctx, no I/O — so it is exhaustively
 * unit-testable per trigger against the PRD 80 §1 matrix (prior art: the pure
 * `templateBounds` checker + `packages/shared/pricing`).
 *
 * The routing is HARDCODED V1 (no caller override, PRD 80 architecture): a caller
 * passes a business event, the engine decides the category + channels. We assert
 * the exact matrix, NOT invented mappings.
 */

/** Every one of the 8 documented V1 triggers — exhaustiveness guard. */
const ALL_TRIGGERS: TransactionalTrigger[] = [
  "order_paid",
  "order_received_kitchen",
  "courier_pickup",
  "courier_dropoff",
  "order_delivered",
  "refund_issued",
  "uber_course_failed",
  "pickup_ready_click_collect",
];

describe("2.7-B categories — the 8 transactional triggers → 3 categories", () => {
  it("maps every documented trigger (closed taxonomy, no gap)", () => {
    for (const trigger of ALL_TRIGGERS) {
      expect(TRANSACTIONAL_ROUTING[trigger]).toBeDefined();
    }
    // The routing table covers EXACTLY the 8 triggers — no invented extra.
    expect(Object.keys(TRANSACTIONAL_ROUTING).sort()).toEqual(
      [...ALL_TRIGGERS].sort(),
    );
  });

  // --- Archive (PRD 80 §1: 1 cmd payée, 6 refund, 7 course Uber refusée) -------
  it.each(["order_paid", "refund_issued", "uber_course_failed"] as const)(
    "routes %s to Archive → wallet_push + web_push + email",
    (trigger) => {
      expect(categoryForTrigger(trigger)).toBe("archive");
      expect(channelsForTrigger(trigger)).toEqual([
        "wallet_push",
        "web_push",
        "email",
      ]);
    },
  );

  // --- Temps-réel (PRD 80 §1: 4 dropoff, 5 livrée, 8 pickup ready C&C) ----------
  it.each([
    "courier_dropoff",
    "order_delivered",
    "pickup_ready_click_collect",
  ] as const)("routes %s to Temps-réel → wallet_push + web_push", (trigger) => {
    expect(categoryForTrigger(trigger)).toBe("temps_reel");
    expect(channelsForTrigger(trigger)).toEqual(["wallet_push", "web_push"]);
  });

  // --- Info statut (PRD 80 §1: 2 reçue cuisine = silent only) ------------------
  it("routes order_received_kitchen to Info statut → wallet_silent only", () => {
    expect(categoryForTrigger("order_received_kitchen")).toBe("info_statut");
    expect(channelsForTrigger("order_received_kitchen")).toEqual([
      "wallet_silent",
    ]);
  });

  // --- Info statut → Temps-réel léger (PRD 80 §1: 3 courier pickup) ------------
  it("routes courier_pickup to Info statut + a light Web Push (silent + web_push)", () => {
    expect(categoryForTrigger("courier_pickup")).toBe("info_statut");
    expect(channelsForTrigger("courier_pickup")).toEqual([
      "wallet_silent",
      "web_push",
    ]);
  });

  it("groups the trigger sets consistently with the per-trigger mapping", () => {
    for (const t of ARCHIVE_TRIGGERS)
      expect(categoryForTrigger(t)).toBe("archive");
    for (const t of TEMPS_REEL_TRIGGERS)
      expect(categoryForTrigger(t)).toBe("temps_reel");
    for (const t of INFO_STATUT_TRIGGERS)
      expect(categoryForTrigger(t)).toBe("info_statut");
  });
});

describe("2.7-B SMS extreme fallback — only triggers 1, 4, 6, 7 (PRD 80 §1)", () => {
  it("flags exactly the documented SMS-fallback triggers", () => {
    expect([...SMS_FALLBACK_TRIGGERS].sort()).toEqual(
      [
        "courier_dropoff",
        "order_paid",
        "refund_issued",
        "uber_course_failed",
      ].sort(),
    );
  });

  it.each([
    "order_paid",
    "courier_dropoff",
    "refund_issued",
    "uber_course_failed",
  ] as const)("%s is SMS-fallback eligible", (trigger) => {
    expect(smsFallbackEligible(trigger)).toBe(true);
  });

  it.each([
    "order_received_kitchen",
    "courier_pickup",
    "order_delivered",
    "pickup_ready_click_collect",
  ] as const)("%s is NOT SMS-fallback eligible", (trigger) => {
    expect(smsFallbackEligible(trigger)).toBe(false);
  });
});
