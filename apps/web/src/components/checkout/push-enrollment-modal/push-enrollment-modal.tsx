"use client";

/**
 * PWA-S6a (#455) — `<PushEnrollmentModal>` — the blocking push-enrollment modal
 * (decisions-log Q8 « Modal single-screen non-skippable »).
 *
 * Two visible steps (state machine pinned in `decideModalStep`):
 *  - `choice`         — header + incentive hook + Wallet primary + Web Push
 *                       placeholder (the Web Push branch is the next slice
 *                       S6b #456 — here it renders disabled with a
 *                       « Bientôt disponible » badge).
 *  - `wallet-loading` — the async install loader (US 33 / US 34) with
 *                       « Tester sans attendre » + « J'ai changé d'avis ».
 *
 * Non-skippable (decisions-log Q8 « non-skippable Esc / click outside ») :
 *  - `onEscapeKeyDown` / `onPointerDownOutside` preventDefault — Radix dialog
 *    primitive contract.
 *  - `showCloseButton={false}` — no × button.
 *  - The only exits S6a allows are (a) a successful Wallet install → Convex
 *    sub on `walletStatus = "enrolled"` → the parent `<CheckoutForm>` re-runs
 *    `decidePaymentGate` → the gate flips to active → the modal closes via
 *    `open={!gateActive}` (handled by the parent), and (b) the user clicks
 *    « J'ai changé d'avis » DURING the loader → back to choice (US 34 — but
 *    they still can't escape the modal until they enroll a channel).
 *
 * Auto-close on gate flip: the parent passes `onEnrolled` which is fired
 * whenever the parent observes the gate flip to active — this lets the modal
 * cleanly unmount (we don't render the dialog `open` while the gate is
 * already active).
 *
 * S6b will inject the Web Push primary action on this same screen; S6c the
 * fallback chain. The whole component lives in `apps/web/src/components/
 * checkout/push-enrollment-modal/` and is the single mount point — the parent
 * `<CheckoutForm>` opens it via `<PushEnrollmentModal open=… onChannelInstalled=… />`.
 */
import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { type ModalStep, decideModalStep } from "@/lib/push-enrollment";
import { cn } from "@/lib/utils";
import { AddToWalletButton } from "./add-to-wallet-button";
import { WalletInstallLoader } from "./wallet-install-loader";

export type PushEnrollmentModalProps = {
  /** Controlled open state. The parent flips it to `false` once the gate is active. */
  open: boolean;
  /** The current resto (passed through to `<AddToWalletButton>`). */
  tenantId: Id<"tenants">;
  /**
   * Display name of the resto for the incentive hook (« -10% sur ta prochaine
   * cmd chez {Resto} »). Same source as `<CheckoutForm>` (the RSC parent
   * resolved it from the tenant cookie).
   */
  restoName: string;
};

export function PushEnrollmentModal({
  open,
  tenantId,
  restoName,
}: PushEnrollmentModalProps): React.JSX.Element {
  const [step, setStep] = useState<ModalStep>({ kind: "choice" });
  const [pendingSerial, setPendingSerial] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onGenerated = (args: { serialNumber: string }): void => {
    setErrorMessage(null);
    setPendingSerial(args.serialNumber);
    setStep((s) => decideModalStep(s, { kind: "ClickWalletPrimary" }));
  };
  const onError = (message: string): void => {
    setErrorMessage(message);
  };
  const onChangeOfMind = (): void => {
    setPendingSerial(null);
    setStep((s) => decideModalStep(s, { kind: "ClickChangeOfMind" }));
  };

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          // Non-skippable (decisions-log Q8): kill Esc + outside-click.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg outline-none sm:max-w-lg",
          )}
        >
          <DialogPrimitive.Title className="text-lg font-semibold text-black">
            Pour finaliser ta cmd, choisis comment recevoir ta confirmation +
            offres
          </DialogPrimitive.Title>

          <DialogPrimitive.Description className="text-sm text-zinc-600">
            🎁 -10% sur ta prochaine cmd chez{" "}
            <strong className="text-zinc-700">{restoName}</strong> dès que ta
            carte est ajoutée.
          </DialogPrimitive.Description>

          {step.kind === "choice" && (
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase text-emerald-700">
                  Option 1 — recommandée
                </p>
                <AddToWalletButton
                  tenantId={tenantId}
                  onGenerated={onGenerated}
                  onError={onError}
                />
                <p className="text-xs text-zinc-600">
                  2 taps · push sur ton écran de verrouillage.
                </p>
              </section>

              <section className="flex flex-col gap-2 opacity-60">
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Option 2
                </p>
                <button
                  type="button"
                  disabled
                  aria-disabled
                  className="cursor-not-allowed rounded-lg bg-zinc-300 px-4 py-3 text-base font-semibold text-zinc-500"
                >
                  Activer les notifs du navigateur
                </button>
                <p className="text-xs text-zinc-500">
                  Bientôt disponible (livré dans S6b).
                </p>
              </section>

              {errorMessage !== null && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {errorMessage}
                </p>
              )}
            </div>
          )}

          {step.kind === "wallet-loading" && pendingSerial !== null && (
            <WalletInstallLoader
              tenantId={tenantId}
              serialNumber={pendingSerial}
              onChangeOfMind={onChangeOfMind}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
