"use client";

/**
 * PWA-S9b (#461) — `<WalletBridgeRunner>`: the client-side IO of the
 * cross-device / cross-resto identity BRIDGE at the tap-deep-link surface
 * (decisions-log Q5 « Bridge identité au tap deep-link », US 39 / 40 / 41 /
 * 42).
 *
 * ── Why a tiny client component ───────────────────────────────────────────────
 * The PWA edge middleware (`apps/web/src/proxy.ts`) intercepts the
 * `?wallet=<serial>` query param via the pure `decideWalletBridgeInterception`,
 * sets the short-lived `__Host-kb_wallet_bridge_pending` cookie, and 307-
 * redirects to the clean URL (US 42). The actual session re-bind, however,
 * happens on the CLIENT: Convex Auth's `signIn` is a React hook that mints
 * the auth tokens INTO `localStorage` / `inMemory`, then surfaces them via
 * the `ConvexAuthNextjsProvider` cookie sync — that flow simply cannot run
 * at the Edge.
 *
 * The RSC entry point (`app/page.tsx`) reads the pending cookie server-side
 * (`cookies()`), forwards the serial as a prop, and mounts THIS component.
 * On first effect we:
 *  1. Call `signIn(WALLET_BRIDGE_PROVIDER_ID, { serial })` — the Convex
 *     Auth `WalletBridge` `ConvexCredentials` provider in `auth.ts` asks
 *     `internal.lib.wallet.bridgeSerialToSession.resolveSerialForBridge`
 *     for `{ userId }`, and the framework issues a new auth session
 *     for that EXISTING user. The OLD anonymous session (if any) becomes
 *     orphan — its `users` row is anonymised later by the V2 RGPD cron
 *     (issue body « cas conflit : session anonymous existante sur ce
 *     device → ancien user devient orphan, nouvelle session = customer
 *     bridgé »).
 *  2. POST `/api/wallet-bridge/clear` so the cookie is wiped and a refresh
 *     (back button, second tab) does NOT re-trigger the bridge.
 *
 * If `signIn` returns null / rejects (unknown serial, inactive pass, fiche
 * orphan — all the closed failure modes of `resolveSerialForBridge`), we
 * STILL clear the cookie: the bridge is one-shot from the user's perspective
 * — leaving a failing serial in the cookie would re-attempt on every page
 * load. The user falls back to the normal anonymous flow without surfacing
 * a banner (US 42 « graceful »).
 *
 * The component renders nothing — it is a side-effect-only React surface,
 * mounted unconditionally by the RSC whenever the pending cookie is present.
 */
import { useEffect, useRef } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { WALLET_BRIDGE_PROVIDER_ID } from "@packages/backend/convex/auth";

export type WalletBridgeRunnerProps = {
  /**
   * The serial extracted from `__Host-kb_wallet_bridge_pending` by the RSC
   * entry point (`app/page.tsx`). The RSC reads the cookie server-side and
   * passes the validated string here — the client never re-parses cookies.
   */
  serial: string;
};

export function WalletBridgeRunner({ serial }: WalletBridgeRunnerProps): null {
  const { signIn } = useAuthActions();
  // React 18+ in dev mounts effects twice; we keep a ref guard so the
  // signIn / clear chain runs EXACTLY once per mount cycle. The clear call
  // is itself idempotent (DELETE a missing cookie = no-op), but signIn
  // would otherwise be raced.
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    const run = async (): Promise<void> => {
      try {
        await signIn(WALLET_BRIDGE_PROVIDER_ID, { serial });
      } catch {
        // Closed failure mode — `authorize` returned `null` (unknown serial /
        // inactive pass / orphan fiche). Fall through to the cookie clear so
        // a refresh does not re-attempt the same failing bridge.
      }
      try {
        await fetch("/api/wallet-bridge/clear", {
          method: "POST",
          // Same-origin; no body needed — the route is a fixed cookie wipe.
          credentials: "same-origin",
        });
      } catch {
        // Network blip — the cookie TTL (5 min) is the FALLBACK, so even a
        // failed clear cannot strand the user. Silent.
      }
    };

    void run();
  }, [serial, signIn]);

  return null;
}
