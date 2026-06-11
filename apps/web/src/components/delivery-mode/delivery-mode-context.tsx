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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import {
  decideInitialMode,
  decodeVerdict,
  encodeVerdict,
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
  /**
   * The resto id, threaded through so the `<DeliveryAddressSheet>` (opened from
   * the toggle on a null verdict) can run the address→quote chain. `undefined`
   * in the degraded state (cookie missing) — the toggle then keeps the inert
   * disabled button rather than opening a sheet it cannot drive.
   */
  tenantId: Id<"tenants"> | undefined;
  /**
   * Adopt a fresh verdict at runtime (the address sheet pushes the new verdict
   * in after a successful re-quote) — re-derives the toggle enablement + default
   * mode and persists the verdict to localStorage, all WITHOUT a page reload.
   */
  adoptVerdict: (verdict: DeliveryQuoteVerdict) => void;
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

/** Internal state shape consumed by the reducer. Exported for the reducer test. */
export type DeliveryModeState = {
  verdict: DeliveryQuoteVerdict | null;
  decision: InitialModeDecision;
  mode: DeliveryMode;
};

/**
 * Reducer actions.
 *  - `REHYDRATE`     — one-shot localStorage read on mount.
 *  - `SET_MODE`      — user toggle (instant, no re-quote).
 *  - `ADOPT_VERDICT` — a NEW verdict obtained at runtime (the address sheet
 *    after a successful re-quote). Same transition as REHYDRATE but semantically
 *    distinct: it's a live adoption, not a page-load rehydration.
 */
export type DeliveryModeAction =
  | { kind: "REHYDRATE"; verdict: DeliveryQuoteVerdict }
  | { kind: "SET_MODE"; mode: DeliveryMode }
  | { kind: "ADOPT_VERDICT"; verdict: DeliveryQuoteVerdict };

/** SSR-safe default — used at first paint until `useEffect` rehydrates. */
const INITIAL_DECISION_NO_VERDICT = decideInitialMode(null);
export const INITIAL_STATE: DeliveryModeState = {
  verdict: null,
  decision: INITIAL_DECISION_NO_VERDICT,
  mode: INITIAL_DECISION_NO_VERDICT.initialMode,
};

/** Re-derive state from a verdict — shared by REHYDRATE + ADOPT_VERDICT. */
function stateFromVerdict(verdict: DeliveryQuoteVerdict): DeliveryModeState {
  const decision = decideInitialMode(verdict);
  return {
    verdict,
    decision,
    // Pick the verdict-implied default mode — for a freshly-adopted deliverable
    // verdict this flips `mode` to "delivery" so Livraison becomes selected, no
    // reload (the whole point of ADOPT_VERDICT from the sheet).
    mode: decision.initialMode,
  };
}

export function deliveryModeReducer(
  state: DeliveryModeState,
  action: DeliveryModeAction,
): DeliveryModeState {
  switch (action.kind) {
    case "REHYDRATE":
      return stateFromVerdict(action.verdict);
    case "ADOPT_VERDICT":
      return stateFromVerdict(action.verdict);
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
  tenantId,
}: {
  children: ReactNode;
  /**
   * Resto id — threaded down so the `<DeliveryAddressSheet>` opened from the
   * toggle can run the address→quote chain. `undefined` in the degraded state
   * (cookie missing); the toggle then keeps the inert disabled button.
   */
  tenantId?: Id<"tenants">;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(deliveryModeReducer, INITIAL_STATE);

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

  // Adopt a fresh verdict pushed by the address sheet: persist it to
  // localStorage (so a reload keeps it + cross-route consistency, same key the
  // address-first chain writes) THEN dispatch so the toggle flips without a
  // reload. Persist-then-dispatch mirrors the S3 chain's own ordering.
  const adoptVerdict = useCallback((verdict: DeliveryQuoteVerdict): void => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          VERDICT_STORAGE_KEY,
          encodeVerdict(verdict),
        );
      }
    } catch {
      // Quota / privacy mode — non-fatal; the in-memory dispatch below still
      // flips the toggle for this session.
    }
    dispatch({ kind: "ADOPT_VERDICT", verdict });
  }, []);

  const value = useMemo<DeliveryModeContextValue>(
    () => ({
      verdict: state.verdict,
      mode: state.mode,
      setMode,
      deliveryDisabled: state.decision.deliveryDisabled,
      pickupDisabled: state.decision.pickupDisabled,
      tenantId,
      adoptVerdict,
    }),
    [state, tenantId, adoptVerdict],
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
