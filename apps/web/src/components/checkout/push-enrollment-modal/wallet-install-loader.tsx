"use client";

/**
 * PWA-S6a (#455) — `<WalletInstallLoader>` — the async install loader visible
 * while the user installs the Wallet pass in another tab/sheet (decisions-log
 * Q8 « Loader 30s + Tester sans attendre + J'ai changé d'avis », US 33 / US 34).
 *
 * Wording (decisions-log Q8) :
 *   « ⏳ En attente confirmation Wallet... Tu peux fermer Wallet et revenir. »
 *
 * Two secondary actions:
 *  - « Tester sans attendre » — `useQuery(api.lib.wallet.checkInstallStatus,
 *    { serialNumber })` runs continuously while this component is mounted (the
 *    Convex sub IS the poll). The button surfaces a friendly "Pas encore
 *    installé, réessaie dans quelques secondes" toast when the latest snapshot
 *    is `{ installed: false }`. Per ADR 0012, the AUTHORITATIVE close-the-modal
 *    signal is the `customers.pushEnrollment.walletStatus` flip handled by the
 *    parent — this query is the EXPLICIT TEST surface (US 33) for the user who
 *    suspects the webhook is slow.
 *  - « J'ai changé d'avis » — calls `onChangeOfMind()` so the parent reducer
 *    flips back to the `choice` step (US 34).
 *
 * The 30s timer is purely VISUAL feedback (a progress hint that the loader
 * IS doing something) — the actual close-the-modal logic is the Convex sub
 * flip on `walletStatus = "enrolled"`, NOT a timer expiry. Decision: a "timeout
 * → fallback level 1" wiring lands in S6b/S6c, not here.
 */
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

const VISUAL_TIMER_SECONDS = 30;

export type WalletInstallLoaderProps = {
  /** The current resto (the query's wrapper arg). */
  tenantId: Id<"tenants">;
  /** The serial we are waiting on (returned by `generatePass` on click). */
  serialNumber: string;
  /** Click handler for « J'ai changé d'avis » — flip the modal back to choice. */
  onChangeOfMind: () => void;
};

export function WalletInstallLoader({
  tenantId,
  serialNumber,
  onChangeOfMind,
}: WalletInstallLoaderProps): React.JSX.Element {
  const status = useQuery(
    api.lib.wallet.checkInstallStatus.checkInstallStatus,
    { tenantId, serialNumber },
  );
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [lastPollFeedback, setLastPollFeedback] = useState<string | null>(null);

  // Visual progress timer (Q8 « loader 30s »). Does NOT trigger a state flip —
  // the AUTHORITATIVE close is the Convex sub on `walletStatus` handled by the
  // parent modal. We just stop counting at 30 s.
  useEffect(() => {
    if (secondsElapsed >= VISUAL_TIMER_SECONDS) return undefined;
    const handle = setTimeout(() => setSecondsElapsed((s) => s + 1), 1000);
    return () => clearTimeout(handle);
  }, [secondsElapsed]);

  const onPollClick = (): void => {
    // The query reactivity has likely already fired; this button is the
    // EXPLICIT poll the user can press if they want immediate feedback (US 33).
    if (status === undefined) {
      setLastPollFeedback("Vérification en cours…");
      return;
    }
    if (status.installed) {
      // The sub will close us imminently; surface positive feedback in the
      // meantime so the click never feels swallowed.
      setLastPollFeedback("Pass détecté, on continue…");
      return;
    }
    setLastPollFeedback(
      "Pas encore détecté — réessaie dans quelques secondes.",
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"
      >
        <p className="text-base text-emerald-900">
          ⏳ En attente confirmation Wallet…
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          Tu peux fermer Wallet et revenir.
        </p>
        <p className="mt-2 text-xs text-emerald-700">
          {Math.min(secondsElapsed, VISUAL_TIMER_SECONDS)}/
          {VISUAL_TIMER_SECONDS}s
        </p>
      </div>

      <button
        type="button"
        onClick={onPollClick}
        className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
      >
        Tester sans attendre
      </button>

      {lastPollFeedback !== null && (
        <p role="note" className="text-xs text-zinc-600">
          {lastPollFeedback}
        </p>
      )}

      <button
        type="button"
        onClick={onChangeOfMind}
        className="self-start text-sm font-medium text-zinc-700 underline hover:text-zinc-900"
      >
        ← J&apos;ai changé d&apos;avis
      </button>
    </div>
  );
}
