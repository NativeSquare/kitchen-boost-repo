/**
 * #403 — pure decision functions for the human Refusal 2-step flow from
 * `nouvelle` (PRD 20 §6a, kb-orders CONTEXT "Refusal", ADR 0016 — `refusée` vs
 * `auto_expired`). Same split convention as `decide-order-card.ts` (#401),
 * `decideForceUpdate` (#394), etc. — React, Convex and Expo stay OUT so the
 * truth table is pinned by a fast deterministic vitest suite (Node env, no
 * jsdom, no native mocks).
 *
 * The React side (`refuse-dialog.tsx` + the detail screen) is a thin adapter
 * that calls `api.lib.orders.workflow.refuse` once and delegates every
 * branching decision (show button? which motifs? next step?) to this module.
 *
 * Four exports:
 *
 *  - `decideRefuseButton` — pure projection of the order status to a
 *    "Refuser" secondary button (PRD 20 §6a). 2-step confirm from `nouvelle`
 *    is the scope of this story (#403); the 3-step confirm from
 *    `en préparation` / `prête` (#413) is a SEPARATE slice that will extend
 *    this decision later. Terminal states + pre-payment show no button.
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
 *  - `refuseFlowReducer` + `RefuseFlowState` — the 2-step state machine of
 *    the dialog itself (PRD 20 §6a Étape 1 motif → Étape 2 confirmation).
 *    Three states (`idle` / `pickReason` / `confirm`), three actions
 *    (`open` / `selectReason` / `cancel` / `confirm`). Encodes the
 *    "anti-fat-finger" rule of §6a: a single motif tap NEVER fires the
 *    refund — the user must explicitly confirm at step 2. Cancel from any
 *    step goes back to `idle` without mutating anything (the React side
 *    never dispatched the mutation).
 *
 *    Defensive transitions (stale dispatches from animation races): a
 *    `selectReason` from `idle` is a no-op; a `selectReason` from
 *    `confirm` is a no-op (the reason is already locked in for the
 *    confirmation step). The `open` action is idempotent — re-opening from
 *    a non-idle step keeps the current step intact (it would otherwise
 *    wipe the user's progress on a stale event).
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
 * PRD 20 §6a — the "Refuser" secondary button on the detail screen. Shown
 * ONLY on `nouvelle` (this story's scope). The 3-step variant from
 * `en préparation` / `prête` (#413) will extend this decision later — it is
 * out of scope here so the V1 unhappy-path stays unambiguous.
 *
 * Defence in depth: even if the React side mistakenly shows the button on a
 * non-`nouvelle` state, the backend `refuse` mutation's state-machine guard
 * (`assertLegalTransition`) would throw — but a button that cannot succeed
 * is a UI bug, so we keep the read-side rule narrow here.
 */
export type RefuseButtonDecision =
  | { kind: "hide" }
  | { kind: "show"; label: string };

export function decideRefuseButton(status: OrderStatus): RefuseButtonDecision {
  if (status === "nouvelle") {
    return { kind: "show", label: "Refuser" };
  }
  return { kind: "hide" };
}

/**
 * PRD 20 §6a — the 2-step dialog state machine.
 *
 * `idle`        → dialog closed, no refund in flight.
 * `pickReason`  → Step 1 open: the 4 motifs are shown as big tap targets.
 * `confirm`     → Step 2 open: "Confirmer le refus + refund". The chosen
 *                 `reason` is carried in the state so it can't drift between
 *                 the displayed text and the about-to-be-dispatched mutation.
 *
 * The reducer is the WRITE side of the dialog's local state — the actual
 * `useMutation(api.lib.orders.workflow.refuse)` lives in the React component
 * and is fired in the `confirm → idle` transition by the component itself
 * (the reducer just closes the dialog so a double-tap can't queue a second
 * refund; the button is also disabled while the mutation is in flight).
 */
export type RefuseFlowState =
  | { step: "idle" }
  | { step: "pickReason" }
  | { step: "confirm"; reason: RefusalReason };

export type RefuseFlowAction =
  | { type: "open" }
  | { type: "selectReason"; reason: RefusalReason }
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
      if (state.step === "idle") return { step: "pickReason" };
      return state;
    case "selectReason":
      // Step 1 → Step 2 (the only legal path that carries a reason). From
      // `idle` it's a stale dispatch; from `confirm` the reason is already
      // locked in.
      if (state.step === "pickReason") {
        return { step: "confirm", reason: action.reason };
      }
      return state;
    case "confirm":
      // Step 2 → close. The React side fires the mutation BEFORE dispatching
      // this — the reducer just hides the dialog so a double-tap can't queue
      // a second refund (defence in depth on top of the button's disabled
      // state while the mutation is in flight).
      if (state.step === "confirm") return { step: "idle" };
      return state;
    case "cancel":
      // Anywhere → idle (no mutation fired, the dialog is closed). Anti-fat-
      // finger: the user can back out at step 2 without triggering a refund.
      return { step: "idle" };
  }
}
