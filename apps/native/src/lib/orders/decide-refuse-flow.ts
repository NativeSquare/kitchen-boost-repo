/**
 * #403 + #413 — pure decision functions for the human Refusal flow (PRD 20 §6a,
 * kb-orders CONTEXT "Refusal", ADR 0016 — `refusée` vs `auto_expired`). Same
 * split convention as `decide-order-card.ts` (#401), `decideForceUpdate`
 * (#394), etc. — React, Convex and Expo stay OUT so the truth table is pinned
 * by a fast deterministic vitest suite (Node env, no jsdom, no native mocks).
 *
 * The React side (`refuse-dialog.tsx` + the detail screen) is a thin adapter
 * that calls `api.lib.orders.workflow.refuse` once and delegates every
 * branching decision (show button? which motifs? next step? step count?) to
 * this module.
 *
 * Six exports:
 *
 *  - `decideRefuseButton` — pure projection of the order status to a
 *    "Refuser" secondary button (PRD 20 §6a). Surfaced on EVERY refundable
 *    live state: `nouvelle`, `en préparation`, `prête`. The cost-of-error
 *    branch lives in `decideRefuseStepCount`, NOT in button hiding — the
 *    cuisinier needs the escape hatch on every live state (rupture
 *    découverte mid-cuisson, incident hygiène, panne frigo, etc.).
 *    Terminal states + pre-payment + post-handoff show no button.
 *
 *  - `decideRefuseStepCount` — 2 from `nouvelle` (#403, original story:
 *    motif → confirm), 3 from `en préparation` / `prête` (#413, anti-fat-
 *    finger: motif → warning "la cuisine a déjà commencé" → typed word
 *    "REFUSER"). The cost of error from inflight states is fort (travail
 *    cuisine perdu, refund total, irréversible), so the 3rd step forces a
 *    custom typed confirmation a fat-finger tap cannot satisfy.
 *
 *  - `REFUSAL_REASONS` — the closed set of 4 motifs, 1:1 with the backend
 *    `refusalReason` validator (`packages/backend/convex/table/orders.ts`):
 *    `rupture | fermeture | surcharge | autre`. Exposed as a frozen tuple so
 *    the dialog can `.map(...)` over it without risking mutation, and so a
 *    new motif requires touching BOTH the backend validator and this tuple
 *    (no silent drift between front + back).
 *
 *  - `decideRefusalReasonLabel` — French human label for each motif. The
 *    backend stores the ENUM (`reason`); these labels are display-only and
 *    align with the push template wording (PRD 20 §6a "push client motivé",
 *    PRD 80 §1 trigger 6 `refund_issued`).
 *
 *  - `REFUSE_TYPED_WORD` + `decideTypedConfirmation` — the typed word at
 *    step 3 of the 3-step flow ("REFUSER", case-insensitive + trimmed). The
 *    backend never sees the typed word — it is a UI-only gate on top of the
 *    closed-set motif: even with a thumb on the Confirm button, the dialog
 *    refuses until the cuisinier has manually typed "REFUSER" in the input.
 *
 *  - `refuseFlowReducer` + `RefuseFlowState` — the dialog's local state
 *    machine. The flow MODE (2-step vs 3-step) is decided at `open` time
 *    via `stepCount: 2 | 3` and CARRIED in the `pickReason` state — the
 *    reducer then branches on it when exiting `pickReason`:
 *      - 2-step: `pickReason → confirm → idle`
 *      - 3-step: `pickReason → warnInflight → typeWord → idle`
 *    The mutation is ONLY fired from the `confirm` (2-step) or `typeWord`
 *    (3-step) step on the React side — never from `warnInflight` (defence
 *    in depth: the reducer drops `confirm` from `warnInflight`).
 *
 *    Defensive transitions (stale dispatches from animation races): a
 *    `selectReason` from a non-`pickReason` step is a no-op; a stale
 *    `setTypedWord` outside `typeWord` is a no-op; `acknowledgeWarning`
 *    outside `warnInflight` is a no-op. The `open` action is idempotent —
 *    re-opening from a non-idle step keeps the current step intact.
 */

import type { OrderStatus } from "@packages/backend/convex/lib/orders";

/**
 * The closed set of refusal motifs the resto picks at Step 1 of the dialog
 * (PRD 20 §6a). 1:1 with the backend `refusalReason` validator — adding /
 * removing a motif requires touching BOTH this tuple and
 * `packages/backend/convex/table/orders.ts`, by design.
 *
 * `Object.freeze` + `as const` make the export both runtime-immutable and
 * type-narrow, so consumers can `REFUSAL_REASONS[number]` to recover the
 * union type without re-declaring it.
 */
export const REFUSAL_REASONS = Object.freeze([
  "rupture",
  "fermeture",
  "surcharge",
  "autre",
] as const);

/** The runtime union recovered from the closed-set tuple (matches backend). */
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/**
 * #413 — the canonical typed word at step 3 of the 3-step flow. Displayed
 * to the cuisinier as a placeholder hint ("Tape REFUSER pour valider"); the
 * comparator `decideTypedConfirmation` is case-insensitive + trims trailing
 * whitespace so iOS / Android autocorrect doesn't fight the cuisinier.
 */
export const REFUSE_TYPED_WORD = "REFUSER";

/**
 * #413 — whether the typed input matches the canonical confirmation word
 * `REFUSER`, case-insensitive + whitespace-trimmed. The backend never sees
 * the typed word — this is a pure UI gate (defence in depth on top of the
 * 3-step state machine). Tablet autocorrect on iOS sometimes adds a
 * trailing space; we trim before comparing so the cuisinier doesn't have
 * to fight the keyboard.
 */
export function decideTypedConfirmation(typed: string): boolean {
  return typed.trim().toUpperCase() === REFUSE_TYPED_WORD;
}

/** PRD 20 §6a — discreet French label per motif, displayed on the dialog. */
export function decideRefusalReasonLabel(reason: RefusalReason): string {
  switch (reason) {
    case "rupture":
      // "Rupture de stock" — the most common motif (one ingredient gone for
      // the day, the resto refuses to start the prep).
      return "Rupture de stock";
    case "fermeture":
      // "Fermeture impromptue" — distinct from a planned exceptional closure
      // (#407 PRD 20 §7b, which blocks new orders upstream). This one fires
      // when the resto needs to refuse an in-flight `nouvelle` order during
      // an unforeseen close.
      return "Fermeture impromptue";
    case "surcharge":
      // "Surcharge cuisine" — the kitchen cannot take another order in
      // reasonable time (PRD 20 §6a + Flow nominal 4).
      return "Surcharge cuisine";
    case "autre":
      // "Autre" — the catch-all motif. The audit log carries the enum so the
      // KB ops can ask the resto later; the push template stays neutral.
      return "Autre";
  }
}

/**
 * PRD 20 §6a — the "Refuser" secondary button on the detail screen. Shown on
 * EVERY refundable live state: `nouvelle` (#403, 2-step UI confirm) and the
 * two in-flight states `en préparation` / `prête` (#413, 3-step anti-fat-
 * finger UI confirm). The cost-of-error gate is `decideRefuseStepCount`,
 * NOT button hiding — even mid-cuisson the cuisinier needs the escape hatch
 * for genuine incidents (rupture découverte, hygiène, panne frigo).
 *
 * Post-handoff (`remise` / `livrée` / `collectée`), pre-payment, and the
 * already-terminal `refusée` all hide the button — the refund door is
 * closed once the order has left the kitchen.
 *
 * Defence in depth: even if the React side mistakenly shows the button on a
 * non-refundable state, the backend `refuse` mutation's state-machine guard
 * (`assertLegalTransition`) would throw — but a button that cannot succeed
 * is a UI bug, so we keep the read-side rule narrow here.
 */
export type RefuseButtonDecision =
  | { kind: "hide" }
  | { kind: "show"; label: string };

export function decideRefuseButton(status: OrderStatus): RefuseButtonDecision {
  if (
    status === "nouvelle" ||
    status === "en préparation" ||
    status === "prête"
  ) {
    return { kind: "show", label: "Refuser" };
  }
  return { kind: "hide" };
}

/**
 * #413 — the dialog's step count per source status. `nouvelle` keeps the
 * 2-step #403 flow (motif → confirm); `en préparation` / `prête` use the
 * 3-step anti-fat-finger flow (motif → warning kitchen-started → typed
 * "REFUSER"). Defaults to 2 on any out-of-range value (defence in depth)
 * but practically only called when `decideRefuseButton` shows the button.
 */
export function decideRefuseStepCount(status: OrderStatus): 2 | 3 {
  if (status === "en préparation" || status === "prête") {
    return 3;
  }
  return 2;
}

/**
 * PRD 20 §6a — the dialog state machine, used by BOTH the 2-step (#403) and
 * 3-step (#413) flows. The flow MODE is decided at `open` time and carried
 * in `pickReason` so the reducer can branch on `selectReason`.
 *
 * `idle`         → dialog closed, no refund in flight.
 * `pickReason`   → Step 1: the 4 motifs are shown as big tap targets. The
 *                  `stepCount` here tells the reducer where to go on
 *                  `selectReason` (2 → confirm directly; 3 → warnInflight).
 * `warnInflight` → 3-step only — Step 2: explicit warning that the kitchen
 *                  has already started (copy distinct, preview du temps
 *                  écoulé). The cuisinier must explicitly acknowledge
 *                  before reaching the typed-word step.
 * `typeWord`     → 3-step only — Step 3: input field where the cuisinier
 *                  types "REFUSER" (case-insensitive). The React side
 *                  gates the Confirm button via `decideTypedConfirmation`.
 * `confirm`      → 2-step only — Step 2: "Confirmer le refus + refund".
 *                  The chosen `reason` is carried in state so it can't
 *                  drift between the displayed text and the about-to-be-
 *                  dispatched mutation.
 *
 * The reducer is the WRITE side of the dialog's local state — the actual
 * `useMutation(api.lib.orders.workflow.refuse)` lives in the React component
 * and is fired in the `confirm → idle` (2-step) or `typeWord → idle`
 * (3-step) transition by the component itself.
 */
export type RefuseFlowState =
  | { step: "idle" }
  | { step: "pickReason"; stepCount: 2 | 3 }
  | { step: "warnInflight"; reason: RefusalReason }
  | { step: "typeWord"; reason: RefusalReason; typed: string }
  | { step: "confirm"; reason: RefusalReason };

export type RefuseFlowAction =
  | { type: "open"; stepCount: 2 | 3 }
  | { type: "selectReason"; reason: RefusalReason }
  | { type: "acknowledgeWarning" }
  | { type: "setTypedWord"; value: string }
  | { type: "confirm" }
  | { type: "cancel" };

export function refuseFlowReducer(
  state: RefuseFlowState,
  action: RefuseFlowAction,
): RefuseFlowState {
  switch (action.type) {
    case "open":
      // Idempotent: re-opening from a non-idle step is a stale dispatch
      // (animation race / accidental re-tap) — keep the current step intact
      // so the user doesn't lose their progress.
      if (state.step === "idle") {
        return { step: "pickReason", stepCount: action.stepCount };
      }
      return state;
    case "selectReason":
      // Step 1 → Step 2. Branch on the `stepCount` carried in pickReason:
      //  - 2-step: jump straight to the final confirm (PRD 20 §6a, #403).
      //  - 3-step: go through the kitchen-started warning first (#413).
      if (state.step === "pickReason") {
        if (state.stepCount === 3) {
          return { step: "warnInflight", reason: action.reason };
        }
        return { step: "confirm", reason: action.reason };
      }
      // From any other step it's a stale dispatch (animation race) — keep
      // the current state. From `confirm` / `typeWord` the reason is
      // already locked in.
      return state;
    case "acknowledgeWarning":
      // Step 2 (3-step) → Step 3. Only legal from `warnInflight` — a stale
      // dispatch from any other step is a no-op (the typed buffer would
      // otherwise be reset unexpectedly from `typeWord`).
      if (state.step === "warnInflight") {
        return { step: "typeWord", reason: state.reason, typed: "" };
      }
      return state;
    case "setTypedWord":
      // Updates the typed buffer at Step 3. The React side reads
      // `decideTypedConfirmation(typed)` to gate the Confirm button — the
      // reducer just stores the value. From any non-typeWord step it's a
      // stale dispatch (no buffer to update).
      if (state.step === "typeWord") {
        return { step: "typeWord", reason: state.reason, typed: action.value };
      }
      return state;
    case "confirm":
      // Closes the dialog. Legal from `confirm` (2-step) and `typeWord`
      // (3-step). NOT legal from `warnInflight` — the cuisinier must reach
      // the typed-word step first (defence in depth on top of the disabled
      // button at the React layer).
      if (state.step === "confirm" || state.step === "typeWord") {
        return { step: "idle" };
      }
      return state;
    case "cancel":
      // Anywhere → idle (no mutation fired, the dialog is closed). Anti-
      // fat-finger: the user can back out at any step (incl. step 3 with a
      // fully typed "REFUSER") without triggering a refund.
      return { step: "idle" };
  }
}
