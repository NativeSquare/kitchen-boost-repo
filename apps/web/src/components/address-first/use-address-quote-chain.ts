"use client";

/**
 * FEATURE B (#reusable delivery-address sheet) — the address→quote chain,
 * extracted from `<AddressFirstForm>` so BOTH the full-page form AND the
 * reusable delivery-address sheet replay the SAME IO (DRY — issue spec).
 *
 * Owns the chain `signIn("anonymous")` → `getOrCreateCurrentCustomer` →
 * `updateAddress` → `requestDeliveryQuote` (Convex ACTION) and the localStorage
 * verdict cache. Splitting it out is behaviour-preserving: the form keeps its
 * exact observable flow (the A.1 address → deliverable → palier 1 Wallet card →
 * /menu path stays intact).
 *
 * The race the effect-based trigger fixes (documented verbatim from the original
 * form): Convex Auth SDK's `await signIn()` resolves BEFORE the ReactClient has
 * propagated the new session, so a naive « await signIn → await mutation » races
 * and the mutation hits the backend UNAUTHENTICATED. We set a `pendingSelection`
 * state + watch `isAuthenticated` in an effect, running the chain only once they
 * line up.
 *
 * The hook exposes the RAW verdict result (not a UI decision): each consumer
 * branches it its own way — the form via `decideAddressFirstAction` (Wallet card
 * / message), the sheet via `decideInitialMode` (adopt + close, or keep open on
 * a refusal).
 */
import { useCallback, useEffect, useState } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { encodeVerdict, VERDICT_STORAGE_KEY } from "@/lib/delivery-mode";
import type { PlacesSelection } from "./use-places-autocomplete";

/** The chain's observable state — the consumer renders spinner / verdict / error. */
export type AddressQuoteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "verdict"; verdict: DeliveryQuoteVerdict }
  | { kind: "error"; message: string };

/** Best-effort verdict cache — swallow quota / privacy-mode errors. */
function cacheVerdict(verdict: DeliveryQuoteVerdict): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VERDICT_STORAGE_KEY, encodeVerdict(verdict));
    }
  } catch {
    // Quota / privacy mode — non-fatal; the cart degrades gracefully.
  }
}

export function useAddressQuoteChain({
  tenantId,
}: {
  tenantId: Id<"tenants">;
}): {
  state: AddressQuoteState;
  /** Fire the full chain for an explicit Places selection. */
  submit: (selection: PlacesSelection) => void;
  /** Re-fire `requestDeliveryQuote` only (Retry surge — same address). */
  retry: (selection: PlacesSelection) => void;
  /** Surface an external error (e.g. from the Places widget). */
  setError: (message: string) => void;
  /** The last selection, for a Retry without re-opening Places. */
  lastSelection: PlacesSelection | null;
} {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const getOrCreateCurrentCustomer = useMutation(
    api.lib.customer.identity.getOrCreateCurrentCustomer,
  );
  const updateAddress = useMutation(api.lib.customer.address.updateAddress);
  const requestDeliveryQuote = useAction(
    api.lib.delivery.quote.requestDeliveryQuote,
  );

  const [lastSelection, setLastSelection] = useState<PlacesSelection | null>(
    null,
  );
  const [state, setState] = useState<AddressQuoteState>({ kind: "idle" });
  const [pendingSelection, setPendingSelection] =
    useState<PlacesSelection | null>(null);

  // Run the rest of the chain once authenticated AND a selection is pending.
  // Clear the pending selection SYNCHRONOUSLY before the IO so an auth-flip
  // re-render does not re-fire the chain.
  useEffect(() => {
    if (!isAuthenticated || pendingSelection === null) return;
    const selection = pendingSelection;
    setPendingSelection(null);
    void (async () => {
      try {
        await getOrCreateCurrentCustomer({ tenantId });
        await updateAddress({
          tenantId,
          address: selection.address,
          lat: selection.lat,
          lng: selection.lng,
        });
        const verdict = await requestDeliveryQuote({
          tenantId,
          address: selection.address,
        });
        cacheVerdict(verdict);
        setState({ kind: "verdict", verdict });
      } catch (err) {
        setState({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Erreur inattendue, réessaie dans un moment.",
        });
      }
    })();
  }, [
    isAuthenticated,
    pendingSelection,
    tenantId,
    getOrCreateCurrentCustomer,
    updateAddress,
    requestDeliveryQuote,
  ]);

  const submit = useCallback(
    (selection: PlacesSelection) => {
      setLastSelection(selection);
      setState({ kind: "loading" });
      setPendingSelection(selection);
      if (!isAuthenticated) {
        void signIn("anonymous", {}).catch((err) => {
          setState({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Impossible de démarrer la session, réessaie.",
          });
          setPendingSelection(null);
        });
      }
    },
    [isAuthenticated, signIn],
  );

  const retry = useCallback(
    (selection: PlacesSelection) => {
      setState({ kind: "loading" });
      void (async () => {
        try {
          const verdict = await requestDeliveryQuote({
            tenantId,
            address: selection.address,
          });
          cacheVerdict(verdict);
          setState({ kind: "verdict", verdict });
        } catch (err) {
          setState({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Erreur inattendue, réessaie dans un moment.",
          });
        }
      })();
    },
    [requestDeliveryQuote, tenantId],
  );

  const setError = useCallback((message: string) => {
    setState({ kind: "error", message });
  }, []);

  return { state, submit, retry, setError, lastSelection };
}
