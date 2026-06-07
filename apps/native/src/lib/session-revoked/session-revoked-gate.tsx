import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  decideSessionRevoked,
  type SessionRevokedDecision,
} from "./decide-session-revoked";

/**
 * #400 — « Session révoquée » full-screen overlay gate (PRD 20 §13 + AC8).
 *
 * Mounted at the root of the native app, INSIDE the `ConvexAuthProvider`
 * (it needs `useConvexAuth` + `useAuthActions`) but OUTSIDE every
 * auth-dependent screen so the overlay surfaces ABOVE the auth stack the
 * moment a remote revocation lands.
 *
 * The gate itself is a thin adapter — every branching decision lives in
 * the pure `decideSessionRevoked` function next door (pinned by the vitest
 * suite, see `decide-session-revoked.test.ts`). Same convention as #394
 * (ForceUpdateGate), #395 (PushPermissionBanner), #398 (OnboardingFlow),
 * #399 (TenantSwitcher).
 *
 * Responsibilities:
 *
 *  1. Track the « was the user authenticated at least once during this
 *     process? » sticky bit in a `useRef`. The pure decision reads it as
 *     `wasAuthenticated`.
 *
 *  2. Expose `markIntentionalSignOut()` so the Settings « Logout » button
 *     (#418) and the banned-user alert in `_layout.tsx` can flag « this
 *     drop in auth is voluntary, don't show the revoked overlay ». Without
 *     that flag, every local logout would mistakenly trigger the overlay.
 *
 *  3. When the verdict flips to `revoked`, show the full-screen overlay for
 *     ~3 seconds (« écran bloquant pendant ~3s » PRD 20 §13) then call
 *     `signOut()` to clear the local SecureStore token. The root
 *     `Stack.Protected guard={!isAuthenticated}` then naturally routes the
 *     user to `(auth)/sign-in` (« retour login » AC8).
 *
 * Why a 3-second hold rather than instant redirect: the user must read the
 * « Session révoquée — contactez KB » message. Going straight to sign-in
 * with no context would feel like a random app glitch.
 */

const REVOKED_DISPLAY_MS = 3000;

// ---------------------------------------------------------------------------
// Module-scoped intentional-sign-out flag
// ---------------------------------------------------------------------------

/**
 * Shared mutable flag. Set to `true` BEFORE calling `signOut()` from anywhere
 * in the app that wants to opt out of the « Session révoquée » overlay
 * (Settings « Logout », banned-user alert, account deletion, …). The gate
 * reads it on every render and resets it once the local sign-out cleanup
 * completes.
 *
 * Module-scope (vs React context) on purpose: the flag must be settable
 * SYNCHRONOUSLY from any imperative caller (an onPress handler that then
 * fires `signOut()`) without forcing them to be under a provider. Race-free
 * because the gate is a singleton at the root and React's render after the
 * flag-set runs the decision on the next frame.
 */
let intentionalSignOut = false;

/**
 * Imperative API: every caller that intentionally signs the user out must
 * call this FIRST, then call `signOut()`. Without it, the overlay will
 * mistakenly fire on the local logout.
 */
export function markIntentionalSignOut(): void {
  intentionalSignOut = true;
}

// ---------------------------------------------------------------------------
// React adapter component
// ---------------------------------------------------------------------------

export function SessionRevokedGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();

  // Sticky « has the user ever been authenticated during this process? ».
  // Using a ref so a transient `isAuthenticated === undefined` during a
  // foreground re-check doesn't reset it; useState would also work but
  // refs avoid an extra render.
  const wasAuthenticatedRef = useRef(false);
  if (isAuthenticated === true) {
    wasAuthenticatedRef.current = true;
  }

  // #400 watcher backend — fix bug E2E KBO-AD §D6 (2026-06-07). Convex Auth
  // garde le JWT côté client jusqu'à expiration TTL (~1h), donc
  // `isAuthenticated` ne flippe pas immédiatement après un revoke serveur.
  // Cette sub re-pushe `alive: false` au client dès que la `authSessions`
  // row est supprimée → flip immédiat de l'overlay. Skip quand pas auth
  // (la query throw sans auth, et on n'a rien à watcher dans ce cas).
  const livenessProbe = useQuery(
    api.lib.auth.sessions.isMySessionAlive,
    isAuthenticated === true ? {} : "skip",
  );
  const livenessRevoked = livenessProbe?.alive === false;

  // The decision: `undefined` while Convex Auth is still resolving on cold
  // boot OR right after a foreground re-check. The pure function treats
  // `undefined` as « do not surface overlay » (see truth table).
  const resolvedAuth: boolean | undefined = isLoading
    ? undefined
    : isAuthenticated;
  const decision: SessionRevokedDecision = decideSessionRevoked({
    isAuthenticated: resolvedAuth,
    wasAuthenticated: wasAuthenticatedRef.current,
    livenessRevoked,
    intentionalSignOut,
  });

  // Local overlay flag — once flipped on by a `revoked` verdict, it stays on
  // for `REVOKED_DISPLAY_MS` even if the underlying `decision` resolves back
  // to `idle` mid-display (defensive: a flapping isAuthenticated shouldn't
  // hide the overlay before the user has read it).
  const [overlayVisible, setOverlayVisible] = useState(false);

  useEffect(() => {
    if (decision.kind !== "revoked") return;
    setOverlayVisible(true);
    const timer = setTimeout(() => {
      // Clear the local SecureStore token + reset the previously-authenticated
      // sticky bit so we don't loop. Then drop the overlay; the root
      // `Stack.Protected guard={!isAuthenticated}` routes the user to
      // `(auth)/sign-in` (AC8 « retour login »).
      wasAuthenticatedRef.current = false;
      // signOut() may already be a no-op because the token is invalid, but
      // calling it ensures SecureStore is wiped on every code path. Errors
      // are swallowed — the redirect happens regardless.
      void signOut().catch(() => undefined);
      intentionalSignOut = false;
      setOverlayVisible(false);
    }, REVOKED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [decision.kind, signOut]);

  // Once a voluntary sign-out has fully drained (was→not authenticated, with
  // intentional=true), reset both the sticky flag and the intentional flag so
  // the next sign-in starts fresh.
  useEffect(() => {
    if (
      isAuthenticated === false &&
      wasAuthenticatedRef.current &&
      intentionalSignOut
    ) {
      wasAuthenticatedRef.current = false;
      intentionalSignOut = false;
    }
  }, [isAuthenticated]);

  if (overlayVisible) {
    return <SessionRevokedOverlay />;
  }

  return <>{children}</>;
}

/**
 * The « Session révoquée — contactez KB » full-screen overlay. Red on white
 * to match the KitchenBoost art direction (#B91C1C, same palette as
 * `ForceUpdateGate`'s `BlockingNativeUpdateScreen` so the user experience is
 * coherent). No CTA — the redirect happens automatically after
 * `REVOKED_DISPLAY_MS`, the user just needs to read the message.
 */
function SessionRevokedOverlay() {
  return (
    <View
      accessibilityRole="alert"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#B91C1C",
        padding: 24,
      }}
    >
      <Text
        style={{
          color: "#ffffff",
          fontSize: 24,
          fontWeight: "700",
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        Session révoquée
      </Text>
      <Text
        style={{
          color: "#ffffff",
          fontSize: 16,
          textAlign: "center",
          opacity: 0.9,
        }}
      >
        Contactez KitchenBoost pour rétablir l&apos;accès. Vous allez être
        redirigé vers l&apos;écran de connexion.
      </Text>
    </View>
  );
}
