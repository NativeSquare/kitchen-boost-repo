import { describe, expect, it } from "vitest";
import { decideSessionRevoked } from "./decide-session-revoked";

/**
 * #400 — `decideSessionRevoked` pinned as a pure function (PRD 20 §13
 * « Révocation session distante » + AC8). The `SessionRevokedGate` component
 * mounted at the root layout is a thin adapter: it observes
 * `useConvexAuth().isAuthenticated`, tracks whether the user was previously
 * authenticated (sticky local ref) and whether the local sign-out flow was
 * the cause of the transition (intentionalSignOut flag flipped by Settings
 * « Logout » + the banned-user alert), then delegates the verdict here.
 *
 * Same split convention as `decideForceUpdate` (#394),
 * `decidePushPermissionBanner` (#395), `decideOnboardingStep` (#398),
 * `decideTenantSwitcher` (#399) — keep React, `@convex-dev/auth/react` and
 * Expo out of the matrix, get a fast deterministic vitest suite (Node env, no
 * jsdom, no native mocks).
 *
 * Three acceptance scenarios from issue #400 + PRD 20 §13 pinned:
 *
 *  (a) « session révoquée à distance » — user was authenticated and the
 *      Convex auth token has just flipped to invalid (KB Admin revoked it
 *      from #396 / PR #423, or another device in the same chain did so).
 *      The transition `wasAuthenticated && !isAuthenticated` happened WITHOUT
 *      a local `signOut()` having been requested → verdict `revoked`. The
 *      adapter shows the full-screen « Session révoquée » overlay for ~3s
 *      then routes to `(auth)/sign-in`. SLA: surface within 5 s of the remote
 *      revocation (PRD 20 §13 + AC8 « apparition de l'écran révoqué en < 5s »).
 *
 *  (b) « logout local volontaire » — Settings TB-21 « Logout » flipped the
 *      intentional flag before calling `signOut()`. `wasAuthenticated &&
 *      !isAuthenticated` still matches but the verdict is `idle` — no error
 *      surface for the user who literally just pressed the button.
 *
 *  (c) « pas encore authentifié / login flow » — no prior auth, current state
 *      may be loading or `false`. Verdict `idle`. The `(auth)` stack handles
 *      sign-in naturally; we do not lock people out before they have even
 *      attempted to sign in.
 *
 *  Plus edge cases the adapter has to handle gracefully — auth state still
 *  resolving (undefined), normal authenticated steady-state, etc.
 */

// ---------------------------------------------------------------------------
// Scenario (a) — remote revocation
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — scenario (a) « session révoquée à distance »", () => {
  it("was authenticated, now NOT, with NO local sign-out request → revoked", () => {
    // The canonical scenario: KB Admin clicks « Révoquer » on the session
    // row (#396 mutation, shared with this story per PR #423). Convex Auth
    // cascade-deletes the refresh tokens, the native client fails its next
    // refresh and `isAuthenticated` flips to false. We must surface the
    // « Session révoquée » overlay before the user gets dumped onto sign-in.
    expect(
      decideSessionRevoked({
        isAuthenticated: false,
        wasAuthenticated: true,
        intentionalSignOut: false,
      }),
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
      decideSessionRevoked({
        isAuthenticated: false,
        wasAuthenticated: true,
        intentionalSignOut: true,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("was NOT authenticated, intentional flag set → idle (cleanup phase, no overlay)", () => {
    // Once the local sign-out goes through, the adapter resets the previous-
    // auth flag and the intentional flag together; both `false` ⇒ idle.
    expect(
      decideSessionRevoked({
        isAuthenticated: false,
        wasAuthenticated: false,
        intentionalSignOut: true,
      }),
    ).toEqual({ kind: "idle" });
  });
});

// ---------------------------------------------------------------------------
// Scenario (c) — never authenticated (login flow, fresh install)
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — scenario (c) « jamais authentifié »", () => {
  it("never authenticated, current state false → idle (let the sign-in flow render)", () => {
    expect(
      decideSessionRevoked({
        isAuthenticated: false,
        wasAuthenticated: false,
        intentionalSignOut: false,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("never authenticated, current state still loading → idle (no overlay)", () => {
    // Cold boot before Convex Auth resolves. Nothing to revoke yet.
    expect(
      decideSessionRevoked({
        isAuthenticated: undefined,
        wasAuthenticated: false,
        intentionalSignOut: false,
      }),
    ).toEqual({ kind: "idle" });
  });
});

// ---------------------------------------------------------------------------
// Normal authenticated state
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — authenticated steady state", () => {
  it("currently authenticated → idle (overlay disposes)", () => {
    expect(
      decideSessionRevoked({
        isAuthenticated: true,
        wasAuthenticated: true,
        intentionalSignOut: false,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("just signed in (was false, now true) → idle", () => {
    expect(
      decideSessionRevoked({
        isAuthenticated: true,
        wasAuthenticated: false,
        intentionalSignOut: false,
      }),
    ).toEqual({ kind: "idle" });
  });

  it("currently authenticated overrides a lingering intentional flag → idle", () => {
    // Defense in depth: if the intentional flag was left stuck `true` due to a
    // failed sign-out attempt that ultimately succeeded, an authenticated
    // current state must still resolve to idle (no overlay).
    expect(
      decideSessionRevoked({
        isAuthenticated: true,
        wasAuthenticated: true,
        intentionalSignOut: true,
      }),
    ).toEqual({ kind: "idle" });
  });
});

// ---------------------------------------------------------------------------
// Loading guard during boot
// ---------------------------------------------------------------------------

describe("#400 decideSessionRevoked — loading guard", () => {
  it("auth state still loading AFTER prior authentication → idle (do not flash overlay)", () => {
    // App backgrounded then foregrounded — `useConvexAuth().isLoading` may
    // briefly resurface while the token is re-checked. We DO NOT show the
    // overlay during a transient loading state; only when we definitively
    // know auth flipped to `false`. PRD 20 §13 SLA tolerates up to 5 s.
    expect(
      decideSessionRevoked({
        isAuthenticated: undefined,
        wasAuthenticated: true,
        intentionalSignOut: false,
      }),
    ).toEqual({ kind: "idle" });
  });
});
