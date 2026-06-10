"use client";

/**
 * PWA-S11 (#463) — `<IOSStandaloneHeuristicRunner>` — fires the
 * `customer.pushEnrollment.recordA2hsAccepted` mutation the FIRST time it
 * detects standalone display-mode on a fiche whose `a2hsStatus` is not yet
 * `"enrolled"` (decisions-log Q4, US 59).
 *
 * Why a separate runner from `<IOSInstallBottomSheet>` :
 *  - The sheet only mounts on `/c/[orderId]`. If the user dismisses + closes
 *    the tab + later re-opens the PWA from the home-screen icon (the
 *    standalone signal), they land on `/` or `/menu`, NOT on /c/[orderId] —
 *    so the sheet-internal effect would never fire on that path.
 *  - The runner mounts at the ROOT layout so EVERY standalone visit gets a
 *    chance to attribute the install, no matter where the user lands.
 *  - This also covers the Android cross-session race (#462 `appinstalled`
 *    event was missed because the tab closed too quickly after the prompt).
 *    The standalone heuristic is the cross-platform safety net.
 *
 * Why not iOS-only :
 *  - The standalone media query is the SAME signal on Android (user installed
 *    via Chrome menu, closed tab before `appinstalled` event was caught,
 *    re-opens in standalone). Restricting the runner to iOS would create a
 *    backend signal gap.
 *  - The sibling `<IOSInstallBottomSheet>` IS iOS-only — it ships the
 *    install INSTRUCTIONS only iOS users need. The runner ships the
 *    install ATTRIBUTION every standalone user benefits from.
 *
 * Idempotence :
 *  - The pure `decideIosStandaloneHeuristic` returns `kind: "noop"` once
 *    `a2hsStatus === "enrolled"` → no re-fire on subsequent renders.
 *  - The backend mutation is idempotent (re-writing `"enrolled"` + a second
 *    audit row on re-fire). The runner adds a `useRef` guard so even within
 *    the same React tree we never fire twice (mirror of
 *    <AndroidInstallButton>'s `installedMutationFired` ref).
 *
 * `tenantId` is read by the layout from the `__Host-kb_tenant` cookie and
 * passed through. The component renders nothing (no UI) — pure side-effect
 * surface, same shape as `<WalletBridgeRunner>` (#461 / S9b).
 *
 * If `tenantId` is `undefined` (degraded shell — cookie missing), the runner
 * mounts but skips the mutation. Backend never receives a flip without a
 * tenant context.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  decideIosStandaloneHeuristic,
  getServerIsStandalone,
  readIsStandalone,
  subscribeIsStandalone,
} from "@/lib/a2hs-ios";

export type IOSStandaloneHeuristicRunnerProps = {
  /**
   * Resolved tenant from the `__Host-kb_tenant` cookie. `undefined` in the
   * degraded shell (cookie missing) — the runner mounts but skips the
   * mutation (Convex `useQuery` is conditional via `"skip"`).
   */
  tenantId: Id<"tenants"> | undefined;
};

export function IOSStandaloneHeuristicRunner({
  tenantId,
}: IOSStandaloneHeuristicRunnerProps): React.JSX.Element | null {
  const isStandalone = useSyncExternalStore<boolean>(
    subscribeIsStandalone,
    readIsStandalone,
    getServerIsStandalone,
  );

  // Convex sub on the customer fiche — gated on tenantId. `"skip"` is the
  // Convex pattern for « don't run this query until args are ready ».
  const customer = useQuery(
    api.lib.customer.identity.getCurrentCustomer,
    tenantId === undefined ? "skip" : { tenantId },
  );
  const a2hsStatus = customer?.pushEnrollment?.a2hsStatus;

  const recordA2hsAccepted = useMutation(
    api.lib.customer.pushEnrollment.recordA2hsAccepted,
  );

  // Single-fire-per-mount guard — even with idempotent backend, avoid the
  // network noise within the same React tree. Mirror of
  // <AndroidInstallButton>'s `installedMutationFired` ref.
  const mutationFired = useRef(false);

  useEffect(() => {
    if (tenantId === undefined) return;

    const decision = decideIosStandaloneHeuristic({
      isStandalone,
      a2hsStatus,
    });
    if (decision.kind !== "flip") return;
    if (mutationFired.current) return;
    mutationFired.current = true;

    void recordA2hsAccepted({ tenantId }).catch(() => {
      // Best-effort — allow a retry on next mount (page navigation).
      mutationFired.current = false;
    });
  }, [tenantId, isStandalone, a2hsStatus, recordA2hsAccepted]);

  return null;
}
