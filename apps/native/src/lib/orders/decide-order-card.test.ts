import { describe, expect, it } from "vitest";
import {
  decideModeTag,
  decideOrderBadgeNew,
  decidePickupHandoffNote,
  decideStatusLabel,
  decideWorkflowButton,
} from "./decide-order-card";

/**
 * #401 — pure decision functions for the KB Orders happy path (PRD 20 §2 /
 * §4 / §5 + kb-orders CONTEXT). Same vitest pattern as #394 / #395 / #398 /
 * #399 — keep React / Convex / Expo out of the test, get a fast
 * deterministic suite.
 *
 * Covers:
 *
 *  - `decideModeTag` — the mode tag 🚴 LIVRAISON / 🛍️ À EMPORTER shown on
 *    every home card (PRD 20 §2 / §11).
 *  - `decideStatusLabel` — the French label for every state in the
 *    workflow + pre-payment (PRD 20 §5).
 *  - `decideWorkflowButton` — the read-side state machine for the detail
 *    workflow buttons (PRD 20 §5 happy path : nouvelle → Accepter →
 *    en préparation → Prête → prête → Remise coursier/client → remise).
 *    Terminal + pre-payment states show no button.
 *  - `decideOrderBadgeNew` — the "badge nouvelle non lue" rule on the home
 *    card (PRD 20 §2).
 */

describe("#401 decideModeTag — PRD 20 §2 / §11", () => {
  it("delivery → 🚴 LIVRAISON", () => {
    expect(decideModeTag("delivery")).toEqual({
      emoji: "🚴",
      label: "LIVRAISON",
    });
  });

  it("pickup → 🛍️ À EMPORTER", () => {
    expect(decideModeTag("pickup")).toEqual({
      emoji: "🛍️",
      label: "À EMPORTER",
    });
  });
});

describe("#401 decideStatusLabel — PRD 20 §5", () => {
  it("maps every documented status to a French label", () => {
    expect(decideStatusLabel("en attente de paiement")).toBe(
      "En attente de paiement",
    );
    expect(decideStatusLabel("nouvelle")).toBe("Nouvelle");
    expect(decideStatusLabel("en préparation")).toBe("En préparation");
    expect(decideStatusLabel("prête")).toBe("Prête");
    expect(decideStatusLabel("remise")).toBe("Remise");
    expect(decideStatusLabel("livrée")).toBe("Livrée");
    expect(decideStatusLabel("collectée")).toBe("Collectée");
    expect(decideStatusLabel("refusée")).toBe("Refusée");
  });

  // #417 — PRD 20 §6b + ADR 0016. The auto_expired terminal must read as
  // « Manquée » on the detail screen so the gérant sees the same vocabulary
  // as the « Manquées » history tab (same word, no confusion).
  it("auto_expired → « Manquée » (same word as the « Manquées » tab)", () => {
    expect(decideStatusLabel("auto_expired")).toBe("Manquée");
  });
});

describe("#401 decideWorkflowButton — PRD 20 §5 happy path", () => {
  it("nouvelle → Accepter / Préparer (kicks off prep)", () => {
    // Mode is irrelevant on the first transition — both delivery and pickup
    // go through `acknowledge`.
    expect(decideWorkflowButton("nouvelle", "delivery")).toEqual({
      kind: "show",
      action: "acknowledge",
      label: "Accepter / Préparer",
    });
    expect(decideWorkflowButton("nouvelle", "pickup")).toEqual({
      kind: "show",
      action: "acknowledge",
      label: "Accepter / Préparer",
    });
  });

  it("en préparation → Prête (mode irrelevant)", () => {
    expect(decideWorkflowButton("en préparation", "delivery")).toEqual({
      kind: "show",
      action: "markPrepared",
      label: "Prête",
    });
    expect(decideWorkflowButton("en préparation", "pickup")).toEqual({
      kind: "show",
      action: "markPrepared",
      label: "Prête",
    });
  });

  it("prête + delivery → Remise au coursier (PRD 20 §5 livraison)", () => {
    expect(decideWorkflowButton("prête", "delivery")).toEqual({
      kind: "show",
      action: "markHandedOff",
      label: "Remise au coursier",
    });
  });

  it("prête + pickup → Remise au client (PRD 20 §5 click & collect)", () => {
    expect(decideWorkflowButton("prête", "pickup")).toEqual({
      kind: "show",
      action: "markHandedOff",
      label: "Remise au client",
    });
  });

  it("terminal states (remise, livrée, collectée, refusée, auto_expired) → no button (fade out + archive)", () => {
    expect(decideWorkflowButton("remise", "delivery")).toEqual({
      kind: "none",
    });
    expect(decideWorkflowButton("remise", "pickup")).toEqual({ kind: "none" });
    expect(decideWorkflowButton("livrée", "delivery")).toEqual({
      kind: "none",
    });
    expect(decideWorkflowButton("collectée", "pickup")).toEqual({
      kind: "none",
    });
    expect(decideWorkflowButton("refusée", "delivery")).toEqual({
      kind: "none",
    });
    // #417 — auto_expired is a TERMINAL system state (ADR 0016). The detail
    // screen, reachable from the history « Manquées » tab, must surface no
    // workflow buttons — the order is already refunded.
    expect(decideWorkflowButton("auto_expired", "delivery")).toEqual({
      kind: "none",
    });
    expect(decideWorkflowButton("auto_expired", "pickup")).toEqual({
      kind: "none",
    });
  });

  it("pre-payment status `en attente de paiement` → no button (never reaches the resto)", () => {
    // PRD 20 §2 « NEVER includes `en attente de paiement` » — but the detail
    // screen is reachable by id, so we defend in depth.
    expect(decideWorkflowButton("en attente de paiement", "delivery")).toEqual({
      kind: "none",
    });
    expect(decideWorkflowButton("en attente de paiement", "pickup")).toEqual({
      kind: "none",
    });
  });
});

describe("#401 decideOrderBadgeNew — PRD 20 §2 « Badge nouvelle non lue »", () => {
  it("badge ON for `nouvelle` orders", () => {
    expect(decideOrderBadgeNew("nouvelle")).toBe(true);
  });

  it("badge OFF for every non-`nouvelle` status (acted on or terminal)", () => {
    expect(decideOrderBadgeNew("en préparation")).toBe(false);
    expect(decideOrderBadgeNew("prête")).toBe(false);
    expect(decideOrderBadgeNew("remise")).toBe(false);
    expect(decideOrderBadgeNew("livrée")).toBe(false);
    expect(decideOrderBadgeNew("collectée")).toBe(false);
    expect(decideOrderBadgeNew("refusée")).toBe(false);
    expect(decideOrderBadgeNew("en attente de paiement")).toBe(false);
  });
});

/**
 * #402 — click & collect: the detail screen mirrors the delivery's
 * « Adresse livraison » card with a « À emporter » placeholder card whose
 * presence is decided by mode alone. PRD 20 §4 says explicitly: "adresse
 * livraison (si livraison) ou note 'à emporter' (si click & collect)".
 *
 * The decision is intentionally narrow — only the mode drives it. No customer
 * name and no pickup time: the MOAT (ADR 0010 §"Customer rules") forbids
 * surfacing a raw customer object to `kb_manager`, and the `orders` row carries
 * neither a customer-facing name nor a `pickupAt` field today (PRD 20 §4 does
 * not require either; it asks for the « note "à emporter" »). Inventing them
 * would either leak past the MOAT or invent product spec — both rejected
 * (KitchenBoost guardrail "no invented specs").
 */
describe("#402 decidePickupHandoffNote — PRD 20 §4 « note à emporter »", () => {
  it("pickup → shows the « À emporter » handoff card", () => {
    expect(decidePickupHandoffNote("pickup")).toEqual({
      kind: "show",
      heading: "À emporter",
      body: "Le client passera récupérer la commande.",
    });
  });

  it("delivery → hides it (the delivery address card is shown instead)", () => {
    expect(decidePickupHandoffNote("delivery")).toEqual({ kind: "hide" });
  });
});
