import { describe, expect, it } from "vitest";
import {
  decideSessionRevoked,
  type SessionRevokedInputs,
} from "./decide-session-revoked";

/**
 * #400 — `decideSessionRevoked` pinned as a pure function (PRD 20 §13
 * « Révocation session distante » + AC8). The `SessionRevokedGate` component
 * mounted at the root layout is a thin adapter: it observes
 * `useConvexAuth().isAuthenticated`, subscribes au watcher
 * `api.lib.auth.sessions.isMySessionAlive` (post-2026-06-07, fix bug E2E
 * KBO-AD §D6), tracks whether the user was previously authenticated (sticky
 * local ref) and whether the local sign-out flow was the cause of the
 * transition (intentionalSignOut flag flipped by Settings « Logout » + the
 * banned-user alert), then delegates the verdict here.
 *
 * Same split convention as `decideForceUpdate` (#394),
 * `decidePushPermissionBanner` (#395), `decideOnboardingStep` (#398),
 * `decideTenantSwitcher` (#399) — keep React, `@convex-dev/auth/react` and
 * Expo out of the matrix, get a fast deterministic vitest suite (Node env, no
 * jsdom, no native mocks).
 *
 * Acceptance scenarios from issue #400 + PRD 20 §13 :
 *
 *  (a) « session révoquée à distance » — fix bug KBO-AD §D6 : Convex Auth
 *      garde le JWT côté client jusqu'à expiration TTL (~1h), donc
 *      `isAuthenticated` ne flippait pas malgré la suppression backend.
 *      Le watcher `isMySessionAlive` détecte la mort de la row en sub temps
 *      réel et flippe `livenessRevoked: true` → verdict `revoked`. SLA <5 s
 *      tenu (PRD 20 §13 + AC8).
 *
 *  (a') « JWT expire après revocation » — fallback : si pour une raison X
 *      le watcher ne s'est pas resub à temps, l'ancien path
 *      `wasAuth && !isAuth && !intentional` continue de fonctionner quand
 *      le JWT finit par échouer.
 *
 *  (b) « logout local volontaire » — Settings TB-21 « Logout » flipped the
 *      intentional flag before calling `signOut()`. `wasAuthenticated &&
 *      !isAuthenticated` still matches but the verdict is `idle` — no error
 *      surface for the user who literally just pressed the button. Le guard
 *      intentional est placé AVANT le check `livenessRevoked` pour que la
 *      cascade `revokeSession` du logout volontaire (qui supprime aussi la
 *      `authSessions` row côté serveur) ne pop pas l'overlay.
 *
 *  (c) « pas encore authentifié / login flow » — no prior auth, current
 *      state may be loading or `false`. Verdict `idle`. The `(auth)` stack
 *      handles sign-in naturally; we do not lock people out before they have
 *      even attempted to sign in.
 *
 *  Plus edge cases the adapter has to handle gracefully — auth state still
 *  resolving (undefined), normal authenticated steady-state, etc.
 */

/** Default input — sane defaults for the steady authenticated state. Tests
 * override only the keys they care about. */
function inputs(
  overrides: Partial<SessionRevokedInputs> = {},
): SessionRevokedInputs {
  return {
    isAuthenticated: true,
    wasAuthenticated: true,
    livenessRevoked: false,
    intentionalSignOut: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario (a) — watcher backend signale révoqué (le path KBO-AD §D6)
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — scenario (a) « watcher backend signale révoqué » (fix KBO-AD §D6)", () => {
  it("was auth, still isAuth (JWT pas expiré), watcher dit révoqué → revoked", () => {
    // Le canonical scenario du fix : KB Admin a cliqué « Révoquer »,
    // backend a supprimé la `authSessions` row, le watcher
    // `isMySessionAlive` push `alive: false` au sub côté natif → ce flag
    // suffit à déclencher l'overlay AVANT que le JWT n'expire (sinon on
    // attendait jusqu'à 1h Convex Auth default).
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: true,
          wasAuthenticated: true,
          livenessRevoked: true,
          intentionalSignOut: false,
        }),
      ),
    ).toEqual({ kind: "revoked" });
  });

  it("watcher dit révoqué AVANT que isAuthenticated ne se résolve (undefined) → revoked", () => {
    // Le watcher peut résoudre avant l'auth check (Convex sub déjà
    // établi sur une frame antérieure). On flippe quand même.
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: undefined,
          wasAuthenticated: true,
          livenessRevoked: true,
          intentionalSignOut: false,
        }),
      ),
    ).toEqual({ kind: "revoked" });
  });
});

// ---------------------------------------------------------------------------
// Scenario (a') — JWT expire après revocation (fallback ancien path)
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — scenario (a') « JWT expire après revocation » (fallback)", () => {
  it("was authenticated, now NOT, watcher silencieux, NO local sign-out → revoked", () => {
    // Path historique pré-watcher : utile en V2 si le watcher tombe / si
    // la sub Convex est broken un instant. Conservé en défense en
    // profondeur.
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: false,
          wasAuthenticated: true,
          livenessRevoked: false,
          intentionalSignOut: false,
        }),
      ),
    ).toEqual({ kind: "revoked" });
  });
});

// ---------------------------------------------------------------------------
// Scenario (b) — voluntary local logout
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — scenario (b) « logout local volontaire »", () => {
  it("was authenticated, now NOT, WITH a local sign-out request → idle (no overlay)", () => {
    // PRD 20 §10 Settings « Logout : révoque la session locale côté Convex
    // Auth ». The user pressed the button intentionally — the « Session
    // révoquée » error overlay would lie to them about what just happened.
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: false,
          wasAuthenticated: true,
          intentionalSignOut: true,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });

  it("logout volontaire qui supprime aussi la authSessions row → idle (intentional > watcher)", () => {
    // Quand Settings Logout signOut(), le serveur supprime aussi la
    // `authSessions` row. Le watcher push `alive: false`. Mais le flag
    // intentional dit « c'est moi qui ai demandé » → idle.
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: false,
          wasAuthenticated: true,
          livenessRevoked: true,
          intentionalSignOut: true,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });

  it("was NOT authenticated, intentional flag set → idle (cleanup phase, no overlay)", () => {
    // Once the local sign-out goes through, the adapter resets the previous-
    // auth flag and the intentional flag together; both `false` ⇒ idle.
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: false,
          wasAuthenticated: false,
          intentionalSignOut: true,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });
});

// ---------------------------------------------------------------------------
// Scenario (c) — never authenticated (login flow, fresh install)
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — scenario (c) « jamais authentifié »", () => {
  it("never authenticated, current state false → idle (let the sign-in flow render)", () => {
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: false,
          wasAuthenticated: false,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });

  it("never authenticated, current state still loading → idle (no overlay)", () => {
    // Cold boot before Convex Auth resolves. Nothing to revoke yet.
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: undefined,
          wasAuthenticated: false,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });
});

// ---------------------------------------------------------------------------
// Normal authenticated state
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — authenticated steady state", () => {
  it("currently authenticated, watcher OK → idle", () => {
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: true,
          wasAuthenticated: true,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });

  it("just signed in (was false, now true) → idle", () => {
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: true,
          wasAuthenticated: false,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });

  it("currently authenticated, lingering intentional flag, watcher OK → idle", () => {
    // Defense in depth: if the intentional flag was left stuck `true` due to a
    // failed sign-out attempt that ultimately succeeded, an authenticated
    // current state must still resolve to idle (no overlay).
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: true,
          wasAuthenticated: true,
          intentionalSignOut: true,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });
});

// ---------------------------------------------------------------------------
// Loading guard during boot
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — loading guard", () => {
  it("auth state still loading AFTER prior authentication, no watcher signal → idle (do not flash overlay)", () => {
    // App backgrounded then foregrounded — `useConvexAuth().isLoading` may
    // briefly resurface while the token is re-checked. We DO NOT show the
    // overlay during a transient loading state; only when we definitively
    // know auth flipped to `false` or the watcher signaled revoked.
    // PRD 20 §13 SLA tolerates up to 5 s.
    expect(
      decideSessionRevoked(
        inputs({
          isAuthenticated: undefined,
          wasAuthenticated: true,
          livenessRevoked: false,
          intentionalSignOut: false,
        }),
      ),
    ).toEqual({ kind: "idle" });
  });
});
