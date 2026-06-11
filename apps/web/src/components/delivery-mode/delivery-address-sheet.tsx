"use client";

/**
 * `<DeliveryAddressSheet>` — REUSABLE bottom sheet that invites the customer to
 * enter a delivery address, replays the address→quote chain, and (if
 * deliverable) flips the delivery-mode toggle to Livraison WITHOUT a reload.
 *
 * Why it exists (real user feedback): when a customer opens a deep link in a
 * fresh tab (no cookie, no cached verdict), `decideInitialMode(null)` renders
 * the « Livraison » button DISABLED. A dead disabled button is bad UX — the
 * address is simply unknown. Tapping Livraison now opens THIS sheet instead.
 *
 * Reuse — built on the SAME pieces as the full-page `<AddressFirstForm>`:
 *   - `<PlacesAddressInput>` for the Google Places mount (dynamic-import safe).
 *   - `useAddressQuoteChain` for the signIn→getOrCreate→updateAddress→quote→
 *     cache-verdict sequence.
 *   - `<MessageBanner>` + `REASON_COPY` for the refusal wording.
 *
 * Controlled API (`open` / `onOpenChange`) so it can be reused elsewhere:
 *   <DeliveryAddressSheet open={x} onOpenChange={setX} tenantId={id} />
 *
 * Outcome routing:
 *   - deliverable verdict → `adoptVerdict(verdict)` (provider persists +
 *     flips the toggle) → close the sheet.
 *   - refusal verdict (hors_zone / hors_horaire / surge) → render the
 *     `<MessageBanner>` inside the sheet (with its CTA / Retry) and KEEP the
 *     sheet open so the customer can try another address.
 */
import { useEffect } from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { decideAddressFirstAction } from "@/lib/address-first";
import { useAddressQuoteChain } from "@/lib/address-first/use-address-quote-chain";
import { PlacesAddressInput } from "@/components/address-first/places-address-input";
import {
  MessageBanner,
  SPINNER_LABEL,
} from "@/components/address-first/address-first-form";
import { useDeliveryMode } from "./delivery-mode-context";

export type DeliveryAddressSheetProps = {
  /** Controlled open state. */
  open: boolean;
  /** Controlled open-state setter (swipe-down / Esc / outside-click route here). */
  onOpenChange: (open: boolean) => void;
  /** Resto id — drives the address→quote chain. */
  tenantId: Id<"tenants">;
};

export function DeliveryAddressSheet({
  open,
  onOpenChange,
  tenantId,
}: DeliveryAddressSheetProps): React.JSX.Element {
  const { adoptVerdict } = useDeliveryMode();
  const { state, submit, retry, fail } = useAddressQuoteChain(tenantId);

  // On a result, branch: deliverable → adopt + close; refusal → stay open.
  // Done in an effect (not in render) because `adoptVerdict` + `onOpenChange`
  // are state-mutating side effects that must not run during render.
  useEffect(() => {
    if (state.kind !== "result") return;
    if (state.verdict.deliverable) {
      adoptVerdict(state.verdict);
      onOpenChange(false);
    }
    // Refusal verdict: nothing to do here — the render branch below shows the
    // message + keeps the sheet open.
  }, [state, adoptVerdict, onOpenChange]);

  // The refusal banner reuses the form's pure decision + copy.
  const action =
    state.kind === "result" && !state.verdict.deliverable
      ? decideAddressFirstAction(state.verdict)
      : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="delivery-address-sheet" className="px-0">
        <DrawerHeader>
          <DrawerTitle>Où veut-on être livré ?</DrawerTitle>
          <DrawerDescription>
            Indique ton adresse, on vérifie si on peut te livrer depuis ce
            resto.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <label className="flex flex-col gap-2 text-left">
            <span className="text-sm font-medium text-zinc-700">
              Ton adresse de livraison
            </span>
            <PlacesAddressInput
              onSelect={submit}
              onError={fail}
              className="w-full"
              ariaLabel="Adresse de livraison"
            />
          </label>

          {state.kind === "verifying" && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-zinc-600"
            >
              {SPINNER_LABEL}
            </p>
          )}

          {action !== null && action.kind === "show-message" && (
            <MessageBanner
              action={action}
              onCtaClick={() => onOpenChange(false)}
              onRetry={retry}
            />
          )}

          {state.kind === "error" && (
            <p role="alert" className="text-sm text-red-700">
              {state.message}
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
