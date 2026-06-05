import { describe, expect, it } from "vitest";
import {
  CUSTOM_REASON_MAX_LENGTH,
  REFUSAL_REASONS,
  REFUSE_TYPED_WORD,
  decideCanSubmitCustomReason,
  decideRefuseButton,
  decideRefuseStepCount,
  decideRefusalReasonLabel,
  decideTypedConfirmation,
  refuseFlowReducer,
  type RefuseFlowState,
} from "./decide-refuse-flow";

/**
 * #403 + #413 — pure decision functions for the human Refusal flow (PRD 20 §6a
 * + kb-orders CONTEXT "Refusal" + ADR 0016).
 *
 * Same vitest pattern as `decide-order-card.test.ts` — keep React, Convex
 * and Expo out of the matrix so the truth table is pinned by a fast
 * deterministic suite (Node env).
 *
 * Covers:
 *
 *  - `decideRefuseButton` — whether the secondary "Refuser" button is
 *    surfaced on the detail screen. PRD 20 §6a: SHOWN on every refundable
 *    live state (`nouvelle`, `en préparation`, `prête`). The cost of error
 *    branches via `decideRefuseStepCount`, NOT by hiding the button.
 *  - `decideRefuseStepCount` — 2 from `nouvelle` (#403), 3 from
 *    `en préparation` / `prête` (#413, anti-fat-finger: cuisine déjà
 *    commencée). The dialog renders one extra warning step + a typed
 *    confirmation word.
 *  - `REFUSAL_REASONS` — the closed set of 4 motifs (rupture / fermeture /
 *    surcharge / autre), 1:1 with the backend `refusalReason` validator
 *    (`table/orders.ts`) so an invented value can NEVER reach the mutation.
 *  - `decideRefusalReasonLabel` — French human label for each motif (UI
 *    display + push template alignment with PRD 80 §1 trigger 6).
 *  - `REFUSE_TYPED_WORD` + `decideTypedConfirmation` — the typed word at
 *    step 3 of the 3-step flow ("REFUSER", case-insensitive). The backend
 *    never sees it — it's a UI guard on top of the closed-set motif.
 *  - `refuseFlowReducer` — the 2-step (#403) AND 3-step (#413) state
 *    machine of the dialog. Encodes "anti-fat-finger" confirmation: a
 *    single motif tap never refunds. The 3-step variant adds a
 *    `warnInflight` step (visible warning that the kitchen has started)
 *    AND a `typeWord` step where the cuisinier must type "REFUSER". Cancel
 *    from any step returns to idle.
 */

describe("#403 + #413 decideRefuseButton — PRD 20 §6a (live refundable states)", () => {
  it("nouvelle → shows the Refuser secondary button (the 2-step entry point)", () => {
    expect(decideRefuseButton("nouvelle")).toEqual({
      kind: "show",
      label: "Refuser",
    });
  });

  it("`en préparation` / `prête` → SHOWS the Refuser button (the 3-step variant entry point — #413)", () => {
    // The cost of error is gated by `decideRefuseStepCount`, NOT by hiding
    // the button — the cuisinier still needs the escape hatch when a
    // critical issue (incident hygiène, rupture découverte au milieu de la
    // cuisson) arises mid-prep. The 3-step confirm dialog absorbs the
    // anti-fat-finger discipline.
    expect(decideRefuseButton("en préparation")).toEqual({
      kind: "show",
      label: "Refuser",
    });
    expect(decideRefuseButton("prête")).toEqual({
      kind: "show",
      label: "Refuser",
    });
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

describe("#413 decideRefuseStepCount — 2 from `nouvelle`, 3 from `en préparation`/`prête`", () => {
  it("`nouvelle` → 2 (the 2-step #403 flow: motif → confirm)", () => {
    expect(decideRefuseStepCount("nouvelle")).toBe(2);
  });

  it("`en préparation` / `prête` → 3 (anti-fat-finger #413: motif → warn → typed word)", () => {
    // PRD 20 §6a — the cost of error is fort (travail cuisine perdu,
    // refund total, irréversible). The 3rd step forces the cuisinier to
    // type "REFUSER" so a fat-finger on the confirm button can never
    // succeed alone.
    expect(decideRefuseStepCount("en préparation")).toBe(3);
    expect(decideRefuseStepCount("prête")).toBe(3);
  });
});

describe("#413 REFUSE_TYPED_WORD + decideTypedConfirmation — case-insensitive guard", () => {
  it("exposes the typed word as 'REFUSER' (the canonical uppercase form)", () => {
    // The placeholder copy ("Tape REFUSER pour valider") tells the
    // cuisinier the canonical form; the comparator is case-insensitive so
    // a tablet's autocorrect / lowercase entry still goes through.
    expect(REFUSE_TYPED_WORD).toBe("REFUSER");
  });

  it("matches the canonical word case-insensitively and trims surrounding whitespace", () => {
    // Tablet autocorrect on iOS sometimes adds a trailing space — we trim
    // before comparing. Case-insensitive so REFUSER / Refuser / refuser
    // all unlock the confirm button.
    expect(decideTypedConfirmation("REFUSER")).toBe(true);
    expect(decideTypedConfirmation("Refuser")).toBe(true);
    expect(decideTypedConfirmation("refuser")).toBe(true);
    expect(decideTypedConfirmation("  refuser  ")).toBe(true);
  });

  it("rejects anything else — typos, partial words, the empty string", () => {
    expect(decideTypedConfirmation("")).toBe(false);
    expect(decideTypedConfirmation("REFUSE")).toBe(false);
    expect(decideTypedConfirmation("REFUSERS")).toBe(false);
    expect(decideTypedConfirmation("OK")).toBe(false);
    expect(decideTypedConfirmation(" ")).toBe(false);
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

  it("`open` with stepCount=2 from idle → `pickReason` carrying the 2-step mode", () => {
    const next = refuseFlowReducer(
      { step: "idle" },
      { type: "open", stepCount: 2 },
    );
    expect(next).toEqual({ step: "pickReason", stepCount: 2 });
  });

  it("`selectReason` from pickReason (2-step) → `confirm` (final confirmation with reason in tow)", () => {
    const next = refuseFlowReducer(
      { step: "pickReason", stepCount: 2 },
      { type: "selectReason", reason: "surcharge" },
    );
    expect(next).toEqual({ step: "confirm", reason: "surcharge" });
  });

  it("`cancel` from pickReason → `idle` (no refund triggered)", () => {
    const next = refuseFlowReducer(
      { step: "pickReason", stepCount: 2 },
      { type: "cancel" },
    );
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
    expect(
      refuseFlowReducer(
        { step: "pickReason", stepCount: 2 },
        { type: "open", stepCount: 2 },
      ),
    ).toEqual({ step: "pickReason", stepCount: 2 });
    expect(
      refuseFlowReducer(
        { step: "confirm", reason: "fermeture" },
        { type: "open", stepCount: 2 },
      ),
    ).toEqual({ step: "confirm", reason: "fermeture" });
  });
});

describe("#413 refuseFlowReducer — 3-step variant (cuisine déjà commencée, anti-fat-finger)", () => {
  // The 3-step variant adds two interleaved steps between `pickReason` and
  // `confirm`:
  //  - `warnInflight` — explicit warning that the kitchen has already
  //    started (preview du temps écoulé, copy distinct). Mirror cancel.
  //  - `typeWord` — the cuisinier must type "REFUSER" (case-insensitive).
  //    The Confirm button is gated by `decideTypedConfirmation(typed)`.
  //
  // The flow mode is decided at `open` time (via `stepCount: 2 | 3`) and
  // carried in the `pickReason` state — the reducer branches on it when
  // exiting `pickReason`.

  it("`open` with stepCount=3 from idle → `pickReason` carrying the 3-step mode", () => {
    const next = refuseFlowReducer(
      { step: "idle" },
      { type: "open", stepCount: 3 },
    );
    expect(next).toEqual({ step: "pickReason", stepCount: 3 });
  });

  it("`selectReason` from pickReason (3-step) → `warnInflight` (kitchen-started warning)", () => {
    const next = refuseFlowReducer(
      { step: "pickReason", stepCount: 3 },
      { type: "selectReason", reason: "rupture" },
    );
    // Distinct copy at step 2 ("Es-tu sûr ? La cuisine a déjà commencé").
    // The reason is carried so the typeWord step can keep displaying it.
    expect(next).toEqual({ step: "warnInflight", reason: "rupture" });
  });

  it("`acknowledgeWarning` from warnInflight → `typeWord` with empty typed buffer", () => {
    const next = refuseFlowReducer(
      { step: "warnInflight", reason: "surcharge" },
      { type: "acknowledgeWarning" },
    );
    expect(next).toEqual({ step: "typeWord", reason: "surcharge", typed: "" });
  });

  it("`cancel` from warnInflight → `idle` (anti-fat-finger backout at step 2)", () => {
    const next = refuseFlowReducer(
      { step: "warnInflight", reason: "fermeture" },
      { type: "cancel" },
    );
    expect(next).toEqual({ step: "idle" });
  });

  it("`setTypedWord` from typeWord → updates the typed buffer (drives the gate)", () => {
    const next = refuseFlowReducer(
      { step: "typeWord", reason: "rupture", typed: "" },
      { type: "setTypedWord", value: "ref" },
    );
    expect(next).toEqual({ step: "typeWord", reason: "rupture", typed: "ref" });
  });

  it("`confirm` from typeWord → `idle` (the React side already gated on the typed match)", () => {
    // The reducer does NOT re-validate the typed word — the React side
    // gates the Confirm button via `decideTypedConfirmation(typed)` and
    // only dispatches `confirm` when the gate passes. The reducer's job
    // here is to close the dialog so a double-tap can't queue a second
    // refund (defence in depth on top of the button's disabled state).
    const next = refuseFlowReducer(
      { step: "typeWord", reason: "autre", typed: "REFUSER" },
      { type: "confirm" },
    );
    expect(next).toEqual({ step: "idle" });
  });

  it("`cancel` from typeWord → `idle` (the user can still back out at step 3 — no refund)", () => {
    const next = refuseFlowReducer(
      { step: "typeWord", reason: "rupture", typed: "REFUSER" },
      { type: "cancel" },
    );
    expect(next).toEqual({ step: "idle" });
  });

  it("ignores `acknowledgeWarning` from typeWord / confirm / idle (defensive — stale dispatch)", () => {
    // Defence in depth against animation races: an `acknowledgeWarning`
    // fired from any non-warnInflight state is a no-op.
    expect(
      refuseFlowReducer({ step: "idle" }, { type: "acknowledgeWarning" }),
    ).toEqual({ step: "idle" });
    expect(
      refuseFlowReducer(
        { step: "typeWord", reason: "rupture", typed: "" },
        { type: "acknowledgeWarning" },
      ),
    ).toEqual({ step: "typeWord", reason: "rupture", typed: "" });
  });

  it("ignores `setTypedWord` from any non-typeWord step (defensive — no buffer to update)", () => {
    expect(
      refuseFlowReducer(
        { step: "idle" },
        { type: "setTypedWord", value: "REFUSER" },
      ),
    ).toEqual({ step: "idle" });
    expect(
      refuseFlowReducer(
        { step: "pickReason", stepCount: 3 },
        { type: "setTypedWord", value: "REFUSER" },
      ),
    ).toEqual({ step: "pickReason", stepCount: 3 });
  });

  it("`confirm` from `warnInflight` is a no-op (must transit via typeWord first)", () => {
    // Defence in depth: even if the dialog UI fires `confirm` from the
    // warning step (animation race / accidental wiring), the reducer
    // refuses to skip the typeWord step. The mutation can ONLY be fired
    // from the typeWord step.
    const next = refuseFlowReducer(
      { step: "warnInflight", reason: "rupture" },
      { type: "confirm" },
    );
    expect(next).toEqual({ step: "warnInflight", reason: "rupture" });
  });
});

describe("ADR 0019 decideCanSubmitCustomReason — gate du bouton Continuer (autre)", () => {
  it("exposes the max length as 280 (Twitter-like — force la concision)", () => {
    expect(CUSTOM_REASON_MAX_LENGTH).toBe(280);
  });

  it("rejects an empty string (rien à propager au push)", () => {
    expect(decideCanSubmitCustomReason("")).toBe(false);
  });

  it("rejects a whitespace-only string (vide après trim)", () => {
    // L'utilisateur peut taper des espaces dans le multiline input ; on les
    // ignore tels que le backend les ignore (trim avant validation).
    expect(decideCanSubmitCustomReason("   ")).toBe(false);
    expect(decideCanSubmitCustomReason("\t\n  ")).toBe(false);
  });

  it("rejects a string > 280 chars (max enforced ici comme côté backend)", () => {
    expect(decideCanSubmitCustomReason("a".repeat(281))).toBe(false);
    expect(decideCanSubmitCustomReason("a".repeat(500))).toBe(false);
  });

  it("accepts a non-empty trimmed string ≤ 280 chars", () => {
    expect(decideCanSubmitCustomReason("ratatouille brûlée")).toBe(true);
    expect(decideCanSubmitCustomReason("a")).toBe(true);
    expect(decideCanSubmitCustomReason("a".repeat(280))).toBe(true);
  });

  it("accepts a string with leading/trailing whitespace whose trimmed length is in range", () => {
    // L'input rend `  ratatouille  ` (~14 chars) gating-OK car trim → 12.
    expect(decideCanSubmitCustomReason("  ratatouille brûlée  ")).toBe(true);
  });
});

describe("ADR 0019 refuseFlowReducer — `autre` ouvre l'étape customReasonInput", () => {
  // Quand le restaurateur choisit `autre`, on insère une étape supplémentaire
  // `customReasonInput` AVANT le step de confirmation finale (confirm en 2-step,
  // warnInflight en 3-step). Le reducer porte la valeur typed pour gating UI
  // via decideCanSubmitCustomReason.

  it("`selectReason('autre')` from pickReason (2-step) → `customReasonInput` (stepCount=2, typed='')", () => {
    const next = refuseFlowReducer(
      { step: "pickReason", stepCount: 2 },
      { type: "selectReason", reason: "autre" },
    );
    expect(next).toEqual({
      step: "customReasonInput",
      stepCount: 2,
      reason: "autre",
      typed: "",
    });
  });

  it("`selectReason('autre')` from pickReason (3-step) → `customReasonInput` (stepCount=3, typed='')", () => {
    // En 3-step l'étape customReasonInput vient AVANT warnInflight : le motif
    // libre est nécessaire pour formuler le push, donc on le saisit d'abord ;
    // ensuite le warning kitchen-started et le typed REFUSER finalisent.
    const next = refuseFlowReducer(
      { step: "pickReason", stepCount: 3 },
      { type: "selectReason", reason: "autre" },
    );
    expect(next).toEqual({
      step: "customReasonInput",
      stepCount: 3,
      reason: "autre",
      typed: "",
    });
  });

  it("`selectReason('rupture')` (and other enums) → comportement inchangé (pas de customReasonInput)", () => {
    // Les 3 motifs enum sautent l'étape customReasonInput : leur label suffit
    // au push template. Le test pin que la régression est zéro pour eux.
    expect(
      refuseFlowReducer(
        { step: "pickReason", stepCount: 2 },
        { type: "selectReason", reason: "rupture" },
      ),
    ).toEqual({ step: "confirm", reason: "rupture" });
    expect(
      refuseFlowReducer(
        { step: "pickReason", stepCount: 3 },
        { type: "selectReason", reason: "fermeture" },
      ),
    ).toEqual({ step: "warnInflight", reason: "fermeture" });
  });

  it("`setCustomReason` from customReasonInput → met à jour `typed` (drive le gate UI)", () => {
    const next = refuseFlowReducer(
      { step: "customReasonInput", stepCount: 2, reason: "autre", typed: "" },
      { type: "setCustomReason", value: "ratatouille" },
    );
    expect(next).toEqual({
      step: "customReasonInput",
      stepCount: 2,
      reason: "autre",
      typed: "ratatouille",
    });
  });

  it("`submitCustomReason` (2-step) → `confirm` portant reason + customReason", () => {
    const next = refuseFlowReducer(
      {
        step: "customReasonInput",
        stepCount: 2,
        reason: "autre",
        typed: "ratatouille brûlée",
      },
      { type: "submitCustomReason" },
    );
    expect(next).toEqual({
      step: "confirm",
      reason: "autre",
      customReason: "ratatouille brûlée",
    });
  });

  it("`submitCustomReason` (3-step) → `warnInflight` portant reason + customReason", () => {
    const next = refuseFlowReducer(
      {
        step: "customReasonInput",
        stepCount: 3,
        reason: "autre",
        typed: "ratatouille brûlée",
      },
      { type: "submitCustomReason" },
    );
    expect(next).toEqual({
      step: "warnInflight",
      reason: "autre",
      customReason: "ratatouille brûlée",
    });
  });

  it("`cancel` from customReasonInput → `idle` (anti-fat-finger backout)", () => {
    const next = refuseFlowReducer(
      {
        step: "customReasonInput",
        stepCount: 2,
        reason: "autre",
        typed: "ratatouille",
      },
      { type: "cancel" },
    );
    expect(next).toEqual({ step: "idle" });
  });

  it("`setCustomReason` outside customReasonInput is a no-op (defensive)", () => {
    expect(
      refuseFlowReducer(
        { step: "idle" },
        { type: "setCustomReason", value: "x" },
      ),
    ).toEqual({ step: "idle" });
    expect(
      refuseFlowReducer(
        { step: "pickReason", stepCount: 2 },
        { type: "setCustomReason", value: "x" },
      ),
    ).toEqual({ step: "pickReason", stepCount: 2 });
    expect(
      refuseFlowReducer(
        { step: "confirm", reason: "autre" },
        { type: "setCustomReason", value: "x" },
      ),
    ).toEqual({ step: "confirm", reason: "autre" });
  });

  it("`submitCustomReason` outside customReasonInput is a no-op (defensive)", () => {
    // Un dispatch parasite depuis n'importe quel autre step est ignoré : le
    // reducer ne fabrique pas de transition vers confirm/warnInflight sans
    // être dans la bonne étape (dette par défaut : no-op).
    expect(
      refuseFlowReducer({ step: "idle" }, { type: "submitCustomReason" }),
    ).toEqual({ step: "idle" });
    expect(
      refuseFlowReducer(
        { step: "pickReason", stepCount: 2 },
        { type: "submitCustomReason" },
      ),
    ).toEqual({ step: "pickReason", stepCount: 2 });
  });

  it("`confirm` from confirm (2-step) with reason=autre + customReason → idle (mutation dispatched par la UI)", () => {
    // Le reducer ferme la dialog ; la mutation a déjà été appelée par la UI.
    const next = refuseFlowReducer(
      { step: "confirm", reason: "autre", customReason: "ratatouille brûlée" },
      { type: "confirm" },
    );
    expect(next).toEqual({ step: "idle" });
  });

  it("3-step `autre` : customReasonInput → warnInflight → typeWord — typeWord porte customReason aussi", () => {
    // Vérifie le rouage complet 3-step pour `autre` : le customReason est
    // posé une fois et il survit aux deux transitions suivantes
    // (warnInflight → typeWord → confirm).
    const afterSubmit = refuseFlowReducer(
      {
        step: "customReasonInput",
        stepCount: 3,
        reason: "autre",
        typed: "ratatouille brûlée",
      },
      { type: "submitCustomReason" },
    );
    expect(afterSubmit).toEqual({
      step: "warnInflight",
      reason: "autre",
      customReason: "ratatouille brûlée",
    });
    const afterAck = refuseFlowReducer(afterSubmit, {
      type: "acknowledgeWarning",
    });
    expect(afterAck).toEqual({
      step: "typeWord",
      reason: "autre",
      customReason: "ratatouille brûlée",
      typed: "",
    });
  });
});
