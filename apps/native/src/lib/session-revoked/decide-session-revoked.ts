/**
 * #400 — pure decision function for the « Session révoquée » full-screen
 * overlay (PRD 20 §13 « Révocation session distante » + AC8).
 *
 * The native app subscribes to `useConvexAuth().isAuthenticated` from
 * `@convex-dev/auth/react`. When a session is revoked remotely (KB Admin
 * « Révoquer » bouton from #396 / PR #423 mutation
 * `api.lib.auth.sessions.revokeSession`, or another device on the same chain
 * doing so), the Convex Auth client fails its next refresh and the flag flips
 * from `true` to `false`. The `SessionRevokedGate` component is a thin
 * adapter: it tracks « was the user authenticated before this frame? » in a
 * sticky local ref, marks whether the local sign-out flow caused the
 * transition (the Settings TB-21 logout + the banned-user alert flip a
 * `intentionalSignOut` flag immediately before calling `signOut()`), and
 * delegates the verdict here.
 *
 * Same split convention as `decideForceUpdate` (#394),
 * `decidePushPermissionBanner` (#395), `decideOnboardingStep` (#398),
 * `decideTenantSwitcher` (#399) — keep React, `@convex-dev/auth/react` and
 * Expo out of the function so the matrix is pinned by a fast deterministic
 * vitest suite (Node env, no jsdom, no native mocks).
 *
 * Truth table (cf. PRD 20 §13 + AC8) :
 *
 *  | wasAuth | isAuth     | livenessRev | intentional | verdict | why                                       |
 *  | ------- | ---------- | ----------- | ----------- | ------- | ----------------------------------------- |
 *  | true    | true       | true        | false       | revoked | watcher backend a flippé (le path KBO-AD) |
 *  | true    | true       | true        | true        | idle    | logout volontaire en cours                |
 *  | true    | false      | *           | false       | revoked | refresh JWT a fini par échouer            |
 *  | true    | false      | *           | true        | idle    | logout local volontaire                   |
 *  | true    | true       | false       | *           | idle    | sain (auth + watcher OK)                  |
 *  | true    | undefined  | *           | *           | idle    | transient loading                         |
 *  | false   | *          | *           | *           | idle    | never authenticated                       |
 *
 * Le watcher `livenessRevoked` est la fix du bug E2E identifié par Alex le
 * 2026-06-07 (KBO-AD §D6) : Convex Auth garde le JWT côté client valide
 * jusqu'à expiration TTL (~1h), donc `isAuthenticated` ne flippait pas
 * malgré la suppression backend de la `authSessions` row. La query
 * `isMySessionAlive` est subscribed par le gate ; quand la row disparaît,
 * Convex push `{alive: false}` au client → flip immédiat.
 *
 * The SLA from PRD 20 §13 — « apparition de l'écran révoqué en < 5s après la
 * révocation depuis KB Admin » — is achieved by Convex Auth's own token-
 * refresh interval (< 1 min by default) + the live subscription invalidation
 * cascade (`revokeSession` deletes `authSessions` + cascade
 * `authRefreshTokens`, so the next refresh fails immediately).
 *
 * The 3-second display + redirect (« écran bloquant pendant ~3s → logout
 * local automatique → redirect (auth)/sign-in ») is the adapter's job, not
 * this function's — keeping the decision pure means we can pin every
 * transition without spinning a fake timer or stubbing `signOut`.
 */

export type SessionRevokedInputs = {
  /** `useConvexAuth().isAuthenticated`. `undefined` while a transient loading
   * state is in flight (foreground return, token refresh) — we MUST NOT
   * flash the overlay in that window (AC8 SLA tolerates 5 s). */
  isAuthenticated: boolean | undefined;
  /** Sticky « was authenticated at least once during this app process »
   * tracked by the adapter via `useRef` (mounted once at root, retained
   * across re-renders, reset when the overlay routes us back to sign-in). */
  wasAuthenticated: boolean;
  /** Watcher `api.lib.auth.sessions.isMySessionAlive` subscribed via
   * `useQuery` quand l'utilisateur est auth. `true` quand le backend a
   * confirmé que la row `authSessions` est supprimée (Convex push live).
   * Permet de détecter la révocation AVANT que le JWT n'expire — fix du
   * bug E2E KBO-AD §D6 (2026-06-07).
   *
   * `false` couvre 2 cas honnêtes :
   *  - watcher dit alive: true → tout va bien
   *  - watcher pas encore résolu / non subscribed → on ne signale pas
   *    revoked, l'autre branche `isAuthenticated === false` rattrape. */
  livenessRevoked: boolean;
  /** Flipped to `true` by Settings « Logout » (PRD 20 §10 + #418) and by the
   * banned-user alert in `_layout.tsx` BEFORE calling `signOut()`. Tells the
   * decision « this drop in auth is what the user asked for, not a remote
   * revocation — no error overlay ». Auto-reset by the adapter once the
   * sign-out cleanup completes. */
  intentionalSignOut: boolean;
};

export type SessionRevokedDecision =
  /** No overlay — render the rest of the tree (auth / app / etc.). */
  | { kind: "idle" }
  /** Full-screen « Session révoquée — contactez KB » overlay. The adapter
   * shows it for ~3 s then calls `signOut()` + lets the natural
   * `Stack.Protected guard={!isAuthenticated}` route push the user to
   * `(auth)/sign-in`. */
  | { kind: "revoked" };

/**
 * Decide whether the « Session révoquée » overlay should be shown this
 * frame. Pure: same inputs ⇒ same output, no `Date.now()`, no side effects.
 */
export function decideSessionRevoked(
  inputs: SessionRevokedInputs,
): SessionRevokedDecision {
  // 1. If the user was never authenticated, there is nothing to revoke.
  //    The auth stack handles sign-in naturally.
  if (!inputs.wasAuthenticated) {
    return { kind: "idle" };
  }

  // 2. Was authenticated AND a sign-out is in flight → idle. Le user a demandé.
  //    Guard placé AVANT le watcher pour qu'un logout volontaire ne pop pas
  //    l'overlay quelques ms le temps que la query se résolve.
  if (inputs.intentionalSignOut) {
    return { kind: "idle" };
  }

  // 3. Watcher backend dit révoqué (la fix bug KBO-AD §D6). Pousse l'overlay
  //    AVANT que `isAuthenticated` ne flippe (le JWT côté client est encore
  //    « valide » 1h par défaut Convex Auth — sans ce signal, l'overlay
  //    n'apparaissait jamais en temps réel).
  if (inputs.livenessRevoked) {
    return { kind: "revoked" };
  }

  // 4. Currently authenticated (or auth state still loading on foreground
  //    return) → no overlay. The loading guard is critical: an `undefined`
  //    flash during token refresh must not pop the red error screen.
  if (inputs.isAuthenticated === true || inputs.isAuthenticated === undefined) {
    return { kind: "idle" };
  }

  // 5. Was authenticated, now definitely NOT, not intentional, no watcher
  //    signal → JWT refresh a fini par échouer après TTL. Surface l'overlay.
  return { kind: "revoked" };
}
