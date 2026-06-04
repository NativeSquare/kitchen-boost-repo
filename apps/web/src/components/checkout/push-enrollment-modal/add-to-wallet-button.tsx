"use client";

/**
 * PWA-S6a (#455) — `<AddToWalletButton>` — the device-specific "Ajouter à mon
 * Wallet" CTA (decisions-log Q5 « Distribution device-specific iOS Blob /
 * Android Save link / Desktop disabled », US 31 / US 32).
 *
 * Flow per device (pure `decideDeviceTarget` decides the bucket from
 * `navigator.userAgent`):
 *
 *  - iOS    → `useAction(api.lib.wallet.generatePass.generatePass)` returns
 *             `{ applePass, appleSigned, googleSaveLink, serialNumber }`. The
 *             slice ALSO needs the raw signed bytes for the Blob route — for
 *             S6a we install via the SAME action's signed pkpass when present,
 *             else fall back to the Apple PassKit `pass/[serial]` Web Service
 *             route (`apps/admin/api/wallet/pass/[serial]`) which re-signs +
 *             returns the `application/vnd.apple.pkpass` bytes (2.8-B mergé).
 *             We `window.location.assign(blobUrl)` — Safari intercepts the MIME
 *             and opens the native Apple Wallet sheet. Cleanup the blob URL
 *             after 5 s to avoid leaks.
 *  - Android→ `window.location.href = googleSaveLink` → Google Wallet preview.
 *  - Desktop→ button disabled + message « Disponible sur mobile uniquement ».
 *
 * Component contract:
 *  - Receives `tenantId` (current resto, used as `brandTenantId` of the pass —
 *    it IS the « last resto ordered », ADR 0003).
 *  - Calls `onGenerated({ serialNumber })` as soon as the action returns so the
 *    parent (`<PushEnrollmentModal>`) flips to the `wallet-loading` step and
 *    starts polling `checkInstallStatus(serialNumber)`.
 *  - On any throw, calls `onError(message)` so the modal can surface a friendly
 *    error + stay on the `choice` step.
 *
 * S6a deliberately does NOT poll the Apple PassKit `pass/[serial]` route here —
 * the install signal flows through the webhook → Convex sub on
 * `customers.pushEnrollment.walletStatus`, which the modal's parent
 * `<CheckoutForm>` already subscribes to. The "Tester sans attendre" button in
 * `<WalletInstallLoader>` polls the Convex `checkInstallStatus` query we
 * introduced in this slice.
 */
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideDeviceTarget } from "@/lib/push-enrollment";

/** Resolves the host browser UA — safe SSR fallback to `undefined`. */
function readUserAgent(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.userAgent;
}

/**
 * MIME-typed base64 → Blob URL. Apple Wallet intercepts the
 * `application/vnd.apple.pkpass` MIME on assignment to `window.location`.
 */
function pkpassBlobUrl(pkpassBase64: string): string {
  const binary = atob(pkpassBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/vnd.apple.pkpass" });
  return URL.createObjectURL(blob);
}

export type AddToWalletButtonProps = {
  /** The current resto (= `brandTenantId` of the generated pass, ADR 0003). */
  tenantId: Id<"tenants">;
  /**
   * Called as soon as the `generatePass` action returns a serial number. The
   * parent modal uses it to flip into the loader step + start the poll.
   */
  onGenerated: (args: { serialNumber: string }) => void;
  /** Called on any failure path so the modal can surface a friendly error. */
  onError: (message: string) => void;
};

/**
 * The Wallet CTA. The button label + the click behaviour adapt to the
 * detected device bucket. Desktop is rendered as a disabled button with the
 * « mobile uniquement » message — by design (Q5).
 */
export function AddToWalletButton({
  tenantId,
  onGenerated,
  onError,
}: AddToWalletButtonProps): React.JSX.Element {
  const generatePass = useAction(api.lib.wallet.generatePass.generatePass);
  const [isGenerating, setIsGenerating] = useState(false);
  const target = decideDeviceTarget({ userAgent: readUserAgent() });

  if (target === "desktop") {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          aria-disabled
          className="cursor-not-allowed rounded-lg bg-zinc-300 px-4 py-3 text-base font-semibold text-zinc-500"
        >
          Ajouter à mon Wallet
        </button>
        <p className="text-xs text-zinc-500">
          Disponible sur mobile uniquement.
        </p>
      </div>
    );
  }

  const onClick = async (): Promise<void> => {
    if (isGenerating) return; // idempotent against double-click
    setIsGenerating(true);
    try {
      const result = await generatePass({
        tenantId,
        brandTenantId: tenantId,
      });
      // Signal the parent FIRST so the loader step renders even if the
      // window.location dispatch is slow.
      onGenerated({ serialNumber: result.serialNumber });

      if (target === "ios") {
        // iOS Safari: decode the signed `.pkpass` bytes returned by
        // `generatePass` (PWA-S6a addition — `pkpassBase64`) into a Blob with
        // MIME `application/vnd.apple.pkpass`, mint a blob URL, and assign it
        // to `window.location`. Safari intercepts the MIME → native Apple
        // Wallet sheet (decisions-log Q5).
        if (result.pkpassBase64 === null) {
          // Dev / staging without the real Apple certs (POC #3 HITL prereq).
          // Surface a friendly error so the modal stays usable; production
          // always has the certs configured (US 22).
          onError(
            "Le Wallet n'est pas encore configuré sur cet environnement.",
          );
          return;
        }
        const blobUrl = pkpassBlobUrl(result.pkpassBase64);
        // Cleanup the blob URL after the navigation has had time to fire.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        window.location.assign(blobUrl);
      } else {
        // Android: Google Wallet "Save to Wallet" link the action signed.
        window.location.href = result.googleSaveLink;
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de générer ton Wallet. Réessaie dans un instant.";
      onError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        // Fire-and-forget — React doesn't await onClick handlers.
        void onClick();
      }}
      disabled={isGenerating}
      aria-disabled={isGenerating}
      className={
        isGenerating
          ? "cursor-wait rounded-lg bg-emerald-600 px-4 py-3 text-base font-semibold text-white opacity-70"
          : "rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800"
      }
    >
      {isGenerating ? "Génération…" : "Ajouter à mon Wallet"}
    </button>
  );
}

// Expose for tests + future slices.
export { pkpassBlobUrl };
