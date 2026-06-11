"use client";

/**
 * Reusable address→quote chain (extracted from `<AddressFirstForm>`, PWA-S3
 * #451) so BOTH the full-page address-first form AND the `<DeliveryAddressSheet>`
 * (the bottom sheet that replaces the dead disabled « Livraison » button) drive
 * the SAME IO sequence — no copy-paste.
 *
 * The hook owns the IO that the pure decisions deliberately keep out:
 *   `signIn("anonymous")` (if not already authenticated)
 *     → `mutation getOrCreateCurrentCustomer({ tenantId })`
 *     → `mutation updateAddress({ tenantId, address, lat, lng })`
 *     → `action  requestDeliveryQuote({ tenantId, address })`
 *     → cache the verdict via `encodeVerdict` into `VERDICT_STORAGE_KEY`.
 *
 * It exposes a tiny state machine (`idle | verifying | result | error`) + a
 * `submit(selection)` entry point + a `retry()` (surge re-quote of the same
 * address, signIn/provisioning/persist already done). The CALLER decides what to
 * DO with `state.verdict` (the form runs `decideAddressFirstAction` + Wallet
 * card; the sheet adopts the verdict into the delivery-mode context). The hook
 * itself stays UI-agnostic.
 *
 * Why the auth-flip useEffect (kept verbatim from the form): Convex Auth SDK's
 * `await signIn()` resolves BEFORE the ReactClient has propagated the new
 * session, so an inline « await signIn → await mutation » races and the mutation
 * hits the backend UNAUTHENTICATED. We stash the selection as React state and
 * run the rest of the chain from an effect that fires when `isAuthenticated`
 * flips to `true`. This is the canonical fix the original form documented.
 */
import { useCallback, useEffect, useState } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  encodeVerdict,
  VERDICT_STORAGE_KEY,
} from "@/lib/delivery-mode/verdict-storage";
import type { DeliveryQuoteVerdict } from "./decide-address-first-action";

/** A resolved Places selection — the chain's input. */
export type AddressSelection = {
  address: string;
  lat: number;
  lng: number;
};

/** The chain's observable state. */
export type AddressQuoteState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "result"; verdict: DeliveryQuoteVerdict }
  | { kind: "error"; message: string };

export type UseAddressQuoteChain = {
  /** Current chain state. */
  state: AddressQuoteState;
  /** Fire the full chain for a freshly-picked Places selection. */
  submit: (selection: AddressSelection) => void;
  /**
   * Re-fire `requestDeliveryQuote` ONLY for the last submitted address (surge
   * Retry, US 7) — signIn/provisioning/persist were already done. No-op if no
   * selection has been submitted yet.
   */
  retry: () => void;
  /** Surface an external error (e.g. Places SDK load / mount failure). */
  fail: (message: string) => void;
};

/** Best-effort verdict cache — swallows quota / privacy-mode errors. */
function cacheVerdict(verdict: DeliveryQuoteVerdict): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VERDICT_STORAGE_KEY, encodeVerdict(verdict));
    }
  } catch {
    // Quota / privacy mode — non-fatal; downstream degrades gracefully.
  }
}

function toMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The reusable address→quote chain. Pass the resolved `tenantId`; the hook
 * wires the Convex mutations/action + the anonymous-auth bootstrap internally.
 */
export function useAddressQuoteChain(
  tenantId: Id<"tenants">,
): UseAddressQuoteChain {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const getOrCreateCurrentCustomer = useMutation(
    api.lib.customer.identity.getOrCreateCurrentCustomer,
  );
  const updateAddress = useMutation(api.lib.customer.address.updateAddress);
  const requestDeliveryQuote = useAction(
    api.lib.delivery.quote.requestDeliveryQuote,
  );

  const [state, setState] = useState<AddressQuoteState>({ kind: "idle" });
  // Last submitted selection — kept so `retry()` can re-fire the quote for the
  // same address without re-opening Places.
  const [lastSelection, setLastSelection] = useState<AddressSelection | null>(
    null,
  );
  // Selection pending the auth flip (see file header — anonymous-auth race fix).
  const [pendingSelection, setPendingSelection] =
    useState<AddressSelection | null>(null);

  // Once authenticated AND a selection is pending, run the rest of the chain.
  // The pending selection is cleared SYNCHRONOUSLY before the IO so a re-render
  // (auth flip) does not re-fire the chain.
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
        setState({ kind: "result", verdict });
      } catch (err) {
        setState({
          kind: "error",
          message: toMessage(
            err,
            "Erreur inattendue, réessaie dans un moment.",
          ),
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
    (selection: AddressSelection): void => {
      setLastSelection(selection);
      setState({ kind: "verifying" });
      setPendingSelection(selection);
      if (!isAuthenticated) {
        // Anonymous provider — fire-and-forget; the effect above re-runs when
        // `isAuthenticated` flips to `true`.
        void signIn("anonymous", {}).catch((err) => {
          setState({
            kind: "error",
            message: toMessage(
              err,
              "Impossible de démarrer la session, réessaie.",
            ),
          });
          setPendingSelection(null);
        });
      }
    },
    [isAuthenticated, signIn],
  );

  const retry = useCallback((): void => {
    if (lastSelection === null) return;
    const selection = lastSelection;
    setState({ kind: "verifying" });
    void (async () => {
      try {
        const verdict = await requestDeliveryQuote({
          tenantId,
          address: selection.address,
        });
        cacheVerdict(verdict);
        setState({ kind: "result", verdict });
      } catch (err) {
        setState({
          kind: "error",
          message: toMessage(
            err,
            "Erreur inattendue, réessaie dans un moment.",
          ),
        });
      }
    })();
  }, [lastSelection, requestDeliveryQuote, tenantId]);

  const fail = useCallback((message: string): void => {
    setState({ kind: "error", message });
  }, []);

  return { state, submit, retry, fail };
}
