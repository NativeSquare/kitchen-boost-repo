/**
 * Pure state machine of the `<RevealableField />` tap-to-reveal control (PRD 20
 * §4 — adresse livraison + téléphone client en tap-to-reveal, ADR 0010 MOAT
 * preserved — la donnée PII est rendue invisible jusqu'au tap explicite).
 *
 * The control has a 2-state lifecycle:
 *
 *   hidden   — initial state, label generic ("Toucher pour afficher").
 *     │ tap
 *     ▼
 *   revealed — value visible, optional second tap fires `action` (tap-to-call
 *              for `customerPhone`). No reverse edge: once revealed the value
 *              stays visible until the screen is unmounted (mirrors the
 *              existing `addressRevealed` flag the detail screen carried before
 *              the refactor — there is no "re-hide" UX, the cuisinier just
 *              leaves the screen).
 *
 * Kept in a SEPARATE pure module so the truth table is pinned by vitest without
 * mounting React (same convention as `decideWorkflowButton`, `decideStatusLabel`,
 * `decideOrderBadgeNew`, etc.).
 */

/** The two visible states the field can be in. */
export type RevealableFieldState = "hidden" | "revealed";

/** Inputs to the state machine — a tap is the single trigger. */
export type RevealableFieldEvent = { type: "tap" };

/**
 * Pure reducer: given the current state + a tap, return the next state.
 *
 *   hidden   + tap → revealed (reveal the value).
 *   revealed + tap → revealed (idempotent — the SECOND tap is what the caller
 *                              interprets as "fire action" via `decideTapAction`,
 *                              the state itself does not flip back to hidden).
 *
 * Separating "what state am I in" from "what should the tap do next" keeps each
 * truth table tiny and re-testable: the screen wires the tap to BOTH reducer
 * (state advance) AND `decideTapAction` (side effect to fire on a revealed tap).
 */
export function revealableFieldReducer(
  state: RevealableFieldState,
  _event: RevealableFieldEvent,
): RevealableFieldState {
  // Only edge is `hidden → revealed`. A tap in `revealed` is a no-op
  // state-wise (the action firing is the caller's concern).
  if (state === "hidden") return "revealed";
  return "revealed";
}

/**
 * Decide what a tap on the field should DO right now (purely from the current
 * state + whether an action is wired). Two outcomes:
 *
 *  - `"reveal"`        — the field is currently hidden ⇒ reveal it (no side
 *                        effect; the value just becomes visible).
 *  - `"fire-action"`   — the field is revealed AND an action is wired (e.g.
 *                        tap-to-call) ⇒ fire it. Used for the phone field.
 *  - `"none"`          — revealed but no action wired ⇒ tap is a no-op (this is
 *                        the address case: no automatic Maps launch, per the
 *                        existing PRD 20 §4 wording in `[orderId].tsx`).
 *
 * The caller wires the side effect; this function only labels what the next
 * tap MEANS so the truth table stays testable.
 */
export function decideTapAction(
  state: RevealableFieldState,
  hasAction: boolean,
): "reveal" | "fire-action" | "none" {
  if (state === "hidden") return "reveal";
  if (hasAction) return "fire-action";
  return "none";
}
