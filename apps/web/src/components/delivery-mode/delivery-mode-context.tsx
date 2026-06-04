"use client";

/**
 * PWA-S5 (#453) — `<DeliveryModeContext>` (CONTEXT client-ordering
 * « Mode toggle » / decisions-log Q7 / PRD US 24-26).
 *
 * Wraps the pure `decideInitialMode` decision (in `lib/delivery-mode`)
 * with React state + a one-shot localStorage read of the cached
 * `DeliveryQuoteVerdict` written by `<AddressFirstForm>` at S3 submit
 * time. The choice of React Context (NOT localStorage) for the LIVE
 * `mode` value is deliberate (issue #453 spec: « pas localStorage,
 * évite stale cross-tabs ») — a user toggling C&C on tab A must not
 * silently flip tab B's checkout to C&C.
 *
 * The verdict, by contrast, is a stable artefact of the address-first
 * chain — it does NOT change across tabs unless the user re-runs the
 * chain on / from /. So we read it from localStorage on mount (the
 * verdict is the only piece S3 → S5 needs to carry across a navigation).
 *
 * The « switch sans re-quote » requirement (decisions-log Q7 + US 25) is
 * structurally satisfied: there is no async call in `setMode`. The
 * `<CartTotals>` row recomputes from the cached fee instantly.
 *
 * Provider is rendered above the cart on `/panier` AND above the
 * `<MenuView>` on `/menu` so the header toggle is visible across the
 * shop (issue #453: « toggle rendu header permanent »).
 *
 * Internally we use `useReducer` (rather than 2 `useState` calls) for
 * the same reason `<CartProvider>` does : the rehydration effect needs
 * to apply a single batched state transition, and `dispatch(...)` is
 * the React-recommended pattern for « apply a state machine action
 * from an effect » (it does not trip the `set-state-in-effect` lint
 * rule because the next state is a function of the previous state via
 * the reducer, not an arbitrary setter).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import {
  decideInitialMode,
  decodeVerdict,
  VERDICT_STORAGE_KEY,
  type DeliveryMode,
  type InitialModeDecision,
} from "@/lib/delivery-mode";

type DeliveryModeContextValue = {
  /** The cached verdict from S3, `null` if no S3 happened yet on this device. */
  verdict: DeliveryQuoteVerdict | null;
  /** Currently-selected mode (header toggle source of truth, in-memory). */
  mode: DeliveryMode;
  /** Setter — instant, no async call (Q7 « switch sans re-quote »). */
  setMode: (mode: DeliveryMode) => void;
  /** True iff the « Livraison » button should render disabled. */
  deliveryDisabled: boolean;
  /** True iff the « Retrait » button should render disabled. */
  pickupDisabled: boolean;
};

const DeliveryModeCtx = createContext<DeliveryModeContextValue | null>(null);

/** Defensive one-shot read — same shape as `<CartProvider>.safeReadFromStorage`. */
function safeReadVerdict(): DeliveryQuoteVerdict | null {
  if (typeof window === "undefined") return null;
  try {
    return decodeVerdict(window.localStorage.getItem(VERDICT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Internal state shape consumed by the reducer. */
type State = {
  verdict: DeliveryQuoteVerdict | null;
  decision: InitialModeDecision;
  mode: DeliveryMode;
};

/** Reducer actions — narrow on purpose (rehydration + user toggle only). */
type Action =
  | { kind: "REHYDRATE"; verdict: DeliveryQuoteVerdict }
  | { kind: "SET_MODE"; mode: DeliveryMode };

/** SSR-safe default — used at first paint until `useEffect` rehydrates. */
const INITIAL_DECISION_NO_VERDICT = decideInitialMode(null);
const INITIAL_STATE: State = {
  verdict: null,
  decision: INITIAL_DECISION_NO_VERDICT,
  mode: INITIAL_DECISION_NO_VERDICT.initialMode,
};

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case "REHYDRATE": {
      const decision = decideInitialMode(action.verdict);
      return {
        verdict: action.verdict,
        decision,
        // Pick the verdict-implied default mode at rehydration time —
        // the user has not interacted with the toggle yet.
        mode: decision.initialMode,
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

export function DeliveryModeProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Rehydrate the verdict once on mount (idem `<CartProvider>` localStorage
  // rehydration). Same pattern: `dispatch(...)` is one state transition,
  // not a cascade of setStates.
  useEffect(() => {
    const stored = safeReadVerdict();
    if (stored === null) return;
    dispatch({ kind: "REHYDRATE", verdict: stored });
  }, []);

  const setMode: Dispatch<DeliveryMode> = (mode) =>
    dispatch({ kind: "SET_MODE", mode });

  const value = useMemo<DeliveryModeContextValue>(
    () => ({
      verdict: state.verdict,
      mode: state.mode,
      setMode,
      deliveryDisabled: state.decision.deliveryDisabled,
      pickupDisabled: state.decision.pickupDisabled,
    }),
    [state],
  );

  return (
    <DeliveryModeCtx.Provider value={value}>
      {children}
    </DeliveryModeCtx.Provider>
  );
}

/** Hook accessor — throws when used outside the provider. */
export function useDeliveryMode(): DeliveryModeContextValue {
  const ctx = useContext(DeliveryModeCtx);
  if (ctx === null) {
    throw new Error(
      "useDeliveryMode() must be called inside <DeliveryModeProvider>",
    );
  }
  return ctx;
}
