"use client";

/**
 * PWA-S6c (#457) — `<NoNotifsFallback>` — the 3-level frictional
 * « Continuer sans notifs » escape hatch (decisions-log Q8 (5) + CONTEXT
 * customer-data « Push enrollment »).
 *
 * Surface (the React IO around the pure `decideFallbackStep` state machine):
 *  - A 12px muted link rendered at the bottom of the choice screen IFF the
 *    parent's `failureCount` is `>= FALLBACK_FAILURE_THRESHOLD` (Wallet
 *    abort + Web Push denied/permission denied — counted by the parent).
 *    Issue acceptance: « Lien fallback caché avant 2 échecs ».
 *  - Click → level-2 confirm modal: « Sans notifs : tu n'auras AUCUNE
 *    confirmation… Sûr ? » + 2 buttons (« Je veux les notifs après tout »
 *    primary; « Oui continue sans » discreet link).
 *  - Click « Oui continue sans » → level-3 final modal: « On a vraiment
 *    besoin d'au moins un canal pour te tenir informé. Choisis encore : »
 *    + same 2 buttons. This re-displays the choice options ONE LAST TIME
 *    (the parent modal still shows the Wallet / Web Push options behind, the
 *    l3 modal is a confirm — re-display is via the user going back).
 *  - Click « Oui continue sans » on l3 → `flagged` (terminal):
 *    `customer.pushEnrollment.markNoChannelPossible` mutation fires + the
 *    parent's Convex sub on `pushEnrollment.noChannelPossible` flips the
 *    gate to `active` → modal closes + Payer button is now usable.
 *
 * Wording is the EXACT verbatim from the issue body — every word is part of
 * the friction (« AUCUNE confirmation, AUCUN suivi, AUCUNE offre ») — so the
 * fallback is deliberate, not accidental. No emojis, no soft-pedalling.
 *
 * The l2 / l3 confirm screens use a SECOND Radix dialog stacked above the
 * parent enrollment modal — Radix portal supports stacking natively (each
 * `Dialog.Root` renders its own overlay + content in z-50). The inner dialog
 * IS skippable via Esc / outside-click → returns to the choice screen
 * (back-to-link-visible transition), so the customer can still retry a
 * channel after seeing the consequences. Only the OUTER push-enrollment
 * modal is non-skippable.
 *
 * The mutation fires from a `useEffect` keyed on `step.kind === "flagged"`
 * so a stale React render does not double-fire. After the optimistic flip,
 * the parent's Convex sub takes over for the actual unmount.
 */
import { useEffect } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { type FallbackStep, decideFallbackStep } from "@/lib/push-enrollment";
import { cn } from "@/lib/utils";

export type NoNotifsFallbackProps = {
  /** Resto id — wrapper arg for `customerMutation`. */
  tenantId: Id<"tenants">;
  /** Current fallback step (controlled by the parent modal). */
  step: FallbackStep;
  /** Dispatch a fallback event upward (the parent owns the reducer state). */
  onFallbackEvent: (event: Parameters<typeof decideFallbackStep>[1]) => void;
};

export function NoNotifsFallback({
  tenantId,
  step,
  onFallbackEvent,
}: NoNotifsFallbackProps): React.JSX.Element | null {
  const markNoChannelPossible = useMutation(
    api.lib.customer.pushEnrollment.markNoChannelPossible,
  );

  // Terminal step → fire the mutation once. The parent's Convex sub on
  // `pushEnrollment.noChannelPossible` flips the Payer gate to `active`,
  // which closes the enrollment modal (parent-controlled). useEffect keyed
  // on `step.kind` ensures a stale re-render does NOT double-fire.
  useEffect(() => {
    if (step.kind !== "flagged") return;
    void markNoChannelPossible({ tenantId });
    // Mutation handle is stable enough for an effect dep — Convex's
    // `useMutation` returns a referentially-stable function within a render
    // tree. `tenantId` is a Convex Id (string), stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind]);

  // Hidden = nothing to render (the parent already controls the choice
  // screen + the failure counter).
  if (step.kind === "hidden") return null;

  return (
    <>
      {step.kind === "link-visible" && (
        <button
          type="button"
          onClick={() => onFallbackEvent({ kind: "ClickFallbackLink" })}
          // Issue acceptance: « lien microscopique 12px muted » — text-xs +
          // text-zinc-500 + underline; centered at the bottom of the choice
          // screen.
          className="self-center text-xs text-zinc-500 underline hover:text-zinc-700"
          data-testid="no-notifs-fallback-link"
        >
          Continuer sans notifs →
        </button>
      )}

      {(step.kind === "confirm-l2" || step.kind === "confirm-l3") && (
        <DialogPrimitive.Root
          open
          onOpenChange={(open) => {
            // Esc / outside-click → equivalent to « Je veux les notifs après
            // tout »: go back to link-visible, the choice screen re-appears.
            if (!open) {
              onFallbackEvent({ kind: "ClickIWantNotifsAfterAll" });
            }
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay
              className={cn(
                "fixed inset-0 z-[60] bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0",
              )}
            />
            <DialogPrimitive.Content
              className={cn(
                "bg-background fixed top-[50%] left-[50%] z-[60] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg outline-none sm:max-w-md",
              )}
              data-testid={
                step.kind === "confirm-l2"
                  ? "no-notifs-confirm-l2"
                  : "no-notifs-confirm-l3"
              }
            >
              <DialogPrimitive.Title className="text-base font-semibold text-black">
                {step.kind === "confirm-l2"
                  ? "Sans notifs : tu n'auras AUCUNE confirmation de cmd reçue, AUCUN suivi livraison live, AUCUNE offre. Sûr ?"
                  : "On a vraiment besoin d'au moins un canal pour te tenir informé. Choisis encore :"}
              </DialogPrimitive.Title>

              <DialogPrimitive.Description className="sr-only">
                {step.kind === "confirm-l2"
                  ? "Confirmation niveau 2 du fallback push enrollment."
                  : "Confirmation niveau 3 — dernière chance avant flag noChannelPossible."}
              </DialogPrimitive.Description>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onFallbackEvent({ kind: "ClickIWantNotifsAfterAll" })
                  }
                  className="rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800"
                  data-testid="no-notifs-i-want-notifs"
                >
                  Je veux les notifs après tout
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onFallbackEvent({ kind: "ClickContinueWithout" })
                  }
                  className="self-center text-xs text-zinc-500 underline hover:text-zinc-700"
                  data-testid="no-notifs-continue-without"
                >
                  Oui continue sans
                </button>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}

      {/* `flagged` renders NOTHING — the effect above fired the mutation, the
          parent's Convex sub on `pushEnrollment.noChannelPossible` will flip
          the gate + close the enrollment modal. We render null here so a
          brief render before the unmount stays silent. */}
    </>
  );
}
