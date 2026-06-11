/**
 * PWA-S5 (#453) + FEATURE B (#reusable delivery-address sheet) — the
 * delivery-mode reducer, extracted from `<DeliveryModeProvider>` so its
 * transitions (incl. the new `ADOPT_VERDICT`) are PURE and vitest-pinned in node
 * env (same split-decision discipline as `lib/delivery-mode/decide-initial-mode`).
 *
 * `ADOPT_VERDICT` (Feature B) is dispatched when the reusable address sheet
 * replays the address→quote chain and gets a FRESH `deliverable` verdict: it
 * REPLACES the cached verdict, recomputes the toggle enablement from it, and —
 * unlike `REHYDRATE` — selects « delivery » as the live mode (the user just
 * proved a deliverable address, so Livraison is what they want), all in-memory
 * with no page reload. The provider also persists the adopted verdict to
 * localStorage so a later navigation rehydrates the same enabled state.
 */
import {
  decideInitialMode,
  type DeliveryMode,
  type InitialModeDecision,
} from "@/lib/delivery-mode";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";

/** Internal state shape consumed by the reducer. */
export type State = {
  verdict: DeliveryQuoteVerdict | null;
  decision: InitialModeDecision;
  mode: DeliveryMode;
};

/** Reducer actions — rehydration + user toggle + sheet-adopted fresh verdict. */
export type Action =
  | { kind: "REHYDRATE"; verdict: DeliveryQuoteVerdict }
  | { kind: "SET_MODE"; mode: DeliveryMode }
  | { kind: "ADOPT_VERDICT"; verdict: DeliveryQuoteVerdict };

/** SSR-safe default — used at first paint until `useEffect` rehydrates. */
const INITIAL_DECISION_NO_VERDICT = decideInitialMode(null);
export const INITIAL_STATE: State = {
  verdict: null,
  decision: INITIAL_DECISION_NO_VERDICT,
  mode: INITIAL_DECISION_NO_VERDICT.initialMode,
};

export function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case "REHYDRATE": {
      const decision = decideInitialMode(action.verdict);
      return {
        verdict: action.verdict,
        decision,
        // Pick the verdict-implied default mode at rehydration time — the user
        // has not interacted with the toggle yet.
        mode: decision.initialMode,
      };
    }
    case "ADOPT_VERDICT": {
      // The reusable address sheet got a FRESH verdict. Recompute enablement
      // from it and, for a deliverable verdict, SELECT delivery (the user just
      // proved a deliverable address — that's the intent). For a non-deliverable
      // adopted verdict (defensive: the caller normally keeps the sheet open on
      // a refusal) fall back to the verdict-implied mode like REHYDRATE.
      const decision = decideInitialMode(action.verdict);
      return {
        verdict: action.verdict,
        decision,
        mode: action.verdict.deliverable ? "delivery" : decision.initialMode,
      };
    }
    case "SET_MODE":
      return { ...state, mode: action.mode };
    default: {
      const _exhaustive: never = action;
      throw new Error(
        `Unhandled delivery-mode action: ${String(
          (_exhaustive as { kind: string }).kind,
        )}`,
      );
    }
  }
}
