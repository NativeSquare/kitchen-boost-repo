import { describe, expect, it } from "vitest";
import {
  REFUSAL_REASONS,
  decideRefuseButton,
  decideRefusalReasonLabel,
  refuseFlowReducer,
  type RefuseFlowState,
} from "./decide-refuse-flow";

/**
 * #403 — pure decision functions for the human Refusal 2-step flow from
 * `nouvelle` (PRD 20 §6a + kb-orders CONTEXT "Refusal" + ADR 0016).
 *
 * Same vitest pattern as `decide-order-card.test.ts` — keep React, Convex
 * and Expo out of the matrix so the truth table is pinned by a fast
 * deterministic suite (Node env).
 *
 * Covers:
 *
 *  - `decideRefuseButton` — whether the secondary "Refuser" button is
 *    surfaced on the detail screen. PRD 20 §6a: 2-step confirm from
 *    `nouvelle` ONLY (the 3-step variant from `en préparation` / `prête`
 *    is #413, deliberately out of scope here).
 *  - `REFUSAL_REASONS` — the closed set of 4 motifs (rupture / fermeture /
 *    surcharge / autre), 1:1 with the backend `refusalReason` validator
 *    (`table/orders.ts`) so an invented value can NEVER reach the mutation.
 *  - `decideRefusalReasonLabel` — French human label for each motif (UI
 *    display + push template alignment with PRD 80 §1 trigger 6).
 *  - `refuseFlowReducer` — the 2-step state machine of the dialog itself
 *    (idle → pickReason → confirm → idle). Encodes "anti-fat-finger"
 *    confirmation: a single motif tap never refunds — the user must
 *    explicitly confirm at step 2. Cancel from any step returns to idle.
 */

describe("#403 decideRefuseButton — PRD 20 §6a (2-step from `nouvelle` ONLY)", () => {
  it("nouvelle → shows the Refuser secondary button (the 2-step entry point)", () => {
    expect(decideRefuseButton("nouvelle")).toEqual({
      kind: "show",
      label: "Refuser",
    });
  });

  it("`en préparation` / `prête` → hidden here (3-step variant is #413, separate slice)", () => {
    expect(decideRefuseButton("en préparation")).toEqual({ kind: "hide" });
    expect(decideRefuseButton("prête")).toEqual({ kind: "hide" });
  });

  it("terminal + pre-payment states → hidden (no refund possible / not yet visible)", () => {
    expect(decideRefuseButton("en attente de paiement")).toEqual({
      kind: "hide",
    });
    expect(decideRefuseButton("remise")).toEqual({ kind: "hide" });
    expect(decideRefuseButton("livrée")).toEqual({ kind: "hide" });
    expect(decideRefuseButton("collectée")).toEqual({ kind: "hide" });
    expect(decideRefuseButton("refusée")).toEqual({ kind: "hide" });
  });
});

describe("#403 REFUSAL_REASONS — closed set, 1:1 with backend `refusalReason`", () => {
  it("exposes the 4 motifs of PRD 20 §6a (no invented value, no missing one)", () => {
    expect(REFUSAL_REASONS).toEqual([
      "rupture",
      "fermeture",
      "surcharge",
      "autre",
    ]);
  });

  it("is readonly at type level (the array is exported as const)", () => {
    // A `readonly tuple` cannot be mutated — this is a structural check that
    // the export is the tuple type the dialog can map over safely.
    expect(Object.isFrozen(REFUSAL_REASONS)).toBe(true);
  });
});

describe("#403 decideRefusalReasonLabel — French UI labels per motif", () => {
  it("maps every documented motif to a discreet French label", () => {
    // The labels are intentionally short (one-noun, no jargon) so they fit
    // big tap targets on the tablet kiosque (PRD 20 §12). They are also the
    // strings the audit row carries (`reason` is the enum, the label is
    // display-only — the backend never sees them).
    expect(decideRefusalReasonLabel("rupture")).toBe("Rupture de stock");
    expect(decideRefusalReasonLabel("fermeture")).toBe("Fermeture impromptue");
    expect(decideRefusalReasonLabel("surcharge")).toBe("Surcharge cuisine");
    expect(decideRefusalReasonLabel("autre")).toBe("Autre");
  });
});

describe("#403 refuseFlowReducer — 2-step dialog state machine (anti-fat-finger)", () => {
  it("starts at `idle` (the dialog is closed)", () => {
    const initial: RefuseFlowState = { step: "idle" };
    expect(initial.step).toBe("idle");
  });

  it("`open` from idle → `pickReason` (Step 1, motif selection)", () => {
    const next = refuseFlowReducer({ step: "idle" }, { type: "open" });
    expect(next).toEqual({ step: "pickReason" });
  });

  it("`selectReason` from pickReason → `confirm` (Step 2, final confirmation with reason in tow)", () => {
    const next = refuseFlowReducer(
      { step: "pickReason" },
      { type: "selectReason", reason: "surcharge" },
    );
    expect(next).toEqual({ step: "confirm", reason: "surcharge" });
  });

  it("`cancel` from pickReason → `idle` (no refund triggered)", () => {
    const next = refuseFlowReducer({ step: "pickReason" }, { type: "cancel" });
    expect(next).toEqual({ step: "idle" });
  });

  it("`cancel` from confirm → `idle` (the user can back out at step 2 — no refund)", () => {
    const next = refuseFlowReducer(
      { step: "confirm", reason: "rupture" },
      { type: "cancel" },
    );
    // Anti-fat-finger: tapping anywhere outside the confirm button at step 2
    // never sends a refund. We go back to a CLEAN idle, not back to step 1
    // (the user picks again from scratch).
    expect(next).toEqual({ step: "idle" });
  });

  it("`confirm` from `confirm` step → `idle` (closes the dialog after dispatching)", () => {
    // The reducer just closes the dialog — the actual mutation is fired by
    // the React side. The state machine never goes `confirm → confirm`: it
    // closes the dialog on confirm so a double-tap can never fire a second
    // refund (the button is also disabled while the mutation is in flight).
    const next = refuseFlowReducer(
      { step: "confirm", reason: "autre" },
      { type: "confirm" },
    );
    expect(next).toEqual({ step: "idle" });
  });

  it("ignores `selectReason` from idle (defensive — dialog must be opened first)", () => {
    // The dialog's UI never fires this from idle, but a stale dispatch
    // (e.g. animation race) should be a no-op rather than mutate state.
    const next = refuseFlowReducer(
      { step: "idle" },
      { type: "selectReason", reason: "rupture" },
    );
    expect(next).toEqual({ step: "idle" });
  });

  it("ignores `selectReason` from confirm (the reason is already picked)", () => {
    const next = refuseFlowReducer(
      { step: "confirm", reason: "rupture" },
      { type: "selectReason", reason: "autre" },
    );
    // A second motif tap at step 2 is ignored — the user must cancel + restart
    // (or confirm with the current reason). This keeps the displayed reason
    // and the about-to-be-dispatched reason in lockstep.
    expect(next).toEqual({ step: "confirm", reason: "rupture" });
  });

  it("`open` is idempotent from pickReason / confirm (re-opening doesn't reset reason)", () => {
    // Defence in depth: a stale `open` dispatch (animation race) should not
    // wipe the user's current step.
    expect(refuseFlowReducer({ step: "pickReason" }, { type: "open" })).toEqual(
      { step: "pickReason" },
    );
    expect(
      refuseFlowReducer(
        { step: "confirm", reason: "fermeture" },
        { type: "open" },
      ),
    ).toEqual({ step: "confirm", reason: "fermeture" });
  });
});
