import { describe, expect, it } from "vitest";
import {
  decideToastVariant,
  decideWorkflowActionKey,
  type ActionKey,
} from "./decide-toast";

/**
 * Pure decision matrix for the KB cuisine confirmation toast.
 *
 * Same vitest discipline as the other native decision modules — no React, no
 * Convex, no Expo runtime. The truth table here is the single source the
 * `notifyAction` adapter consults at every mutation site, so a regression in
 * a label / icon / variant lands here before it reaches the kiosque.
 */

describe("decideToastVariant", () => {
  // Frozen reference table — explicit per action so a label drift on any
  // single row fails its own assertion rather than hiding in a snapshot.
  const cases: {
    action: ActionKey;
    kind: "positive" | "destructive";
    label: string;
    icon: string;
    durationMs: number;
  }[] = [
    {
      action: "workflow.acknowledge",
      kind: "positive",
      label: "Commande acceptée",
      icon: "restaurant-outline",
      durationMs: 2500,
    },
    {
      action: "workflow.markPrepared",
      kind: "positive",
      label: "Commande prête",
      icon: "checkmark-done-outline",
      durationMs: 2500,
    },
    {
      action: "workflow.markHandedOff.delivery",
      kind: "positive",
      label: "Remise au coursier",
      icon: "bicycle-outline",
      durationMs: 2500,
    },
    {
      action: "workflow.markHandedOff.pickup",
      kind: "positive",
      label: "Remise au client",
      icon: "bag-handle-outline",
      durationMs: 2500,
    },
    {
      action: "workflow.refuse",
      kind: "destructive",
      label: "Commande refusée",
      icon: "close-circle-outline",
      durationMs: 2500,
    },
    {
      action: "availability.pause",
      kind: "destructive",
      label: "En pause",
      icon: "pause-circle-outline",
      durationMs: 2500,
    },
    {
      action: "availability.resume",
      kind: "positive",
      label: "Resto rouvert",
      icon: "play-outline",
      durationMs: 2500,
    },
    {
      action: "availability.close",
      kind: "destructive",
      label: "Resto fermé",
      icon: "lock-closed-outline",
      // 4000 ms — body usually carries a date and must stay readable longer.
      durationMs: 4000,
    },
    {
      action: "availability.reopen",
      kind: "positive",
      label: "Resto rouvert",
      icon: "lock-open-outline",
      durationMs: 2500,
    },
    {
      action: "printer.save",
      kind: "positive",
      label: "Imprimante enregistrée",
      icon: "save-outline",
      durationMs: 2500,
    },
    {
      action: "printer.testOk",
      kind: "positive",
      label: "Test d'impression envoyé",
      icon: "print-outline",
      durationMs: 2500,
    },
    {
      action: "printer.remove",
      kind: "destructive",
      label: "Imprimante retirée",
      icon: "trash-outline",
      durationMs: 2500,
    },
    {
      action: "serviceHours.save",
      kind: "positive",
      label: "Horaires mis à jour",
      icon: "time-outline",
      durationMs: 2500,
    },
    {
      action: "menu.itemSetAvailable",
      kind: "positive",
      label: "Article rendu disponible",
      icon: "checkmark-circle-outline",
      durationMs: 2500,
    },
    {
      action: "menu.itemSetUnavailable",
      kind: "destructive",
      label: "Article rendu indisponible",
      icon: "close-circle-outline",
      durationMs: 2500,
    },
  ];

  for (const c of cases) {
    it(`maps ${c.action} → ${c.kind} / "${c.label}" / ${c.icon}`, () => {
      const variant = decideToastVariant(c.action);
      expect(variant.kind).toBe(c.kind);
      expect(variant.label).toBe(c.label);
      expect(variant.icon).toBe(c.icon);
      expect(variant.durationMs).toBe(c.durationMs);
    });
  }

  it("uses 4000 ms only for the closure toast (longer date body)", () => {
    // Defense-in-depth: keep the long-duration branch unique. If a future
    // action needs > 2500 ms, add it explicitly here so the rationale stays
    // visible in the test suite.
    const longRunning = cases.filter((c) => c.durationMs !== 2500);
    expect(longRunning.map((c) => c.action)).toEqual(["availability.close"]);
  });
});

describe("decideWorkflowActionKey", () => {
  it("acknowledge → workflow.acknowledge regardless of mode", () => {
    expect(decideWorkflowActionKey("acknowledge", "delivery")).toBe(
      "workflow.acknowledge",
    );
    expect(decideWorkflowActionKey("acknowledge", "pickup")).toBe(
      "workflow.acknowledge",
    );
  });

  it("markPrepared → workflow.markPrepared regardless of mode", () => {
    expect(decideWorkflowActionKey("markPrepared", "delivery")).toBe(
      "workflow.markPrepared",
    );
    expect(decideWorkflowActionKey("markPrepared", "pickup")).toBe(
      "workflow.markPrepared",
    );
  });

  it("markHandedOff discriminates by mode (delivery → coursier, pickup → client)", () => {
    expect(decideWorkflowActionKey("markHandedOff", "delivery")).toBe(
      "workflow.markHandedOff.delivery",
    );
    expect(decideWorkflowActionKey("markHandedOff", "pickup")).toBe(
      "workflow.markHandedOff.pickup",
    );
  });
});
