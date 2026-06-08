/**
 * F-SHELL-03 — Pure handlers + config for `NoTenantEmptyState`.
 *
 * The React component itself (`no-tenant-empty-state.tsx`) is a thin `"use
 * client"` shell that wires Convex's `useAuthActions().signOut` and Next's
 * router into the handlers exposed here. The branching logic lives in this
 * module so we can pin it with vitest under `environment: "node"` (the repo
 * has no jsdom/RTL install — same pattern as `session-guard.decision.test`).
 *
 * Exports:
 *   - `SUPPORT_MAILTO_HREF` — canonical mailto for the « Contacter le support »
 *     CTA. Centralised so the address is configured in one place and trivially
 *     overridable from a test or a future env var without touching the
 *     component tree.
 *   - `makeNoTenantHandlers({ signOut, navigate })` — factory returning the
 *     handlers the component binds to its buttons. Pure (no React, no Convex
 *     import) — `signOut` and `navigate` are injected.
 *
 * Acceptance ties to issue #169:
 *   - « Bouton "Se déconnecter" appelle `signOut` et redirige vers `/login` »
 *     → `handleSignOut` awaits `signOut()` then calls `navigate("/login")`.
 *   - « CTA "Contacter le support" ouvre `mailto:support@kitchen-boost.com` »
 *     → `SUPPORT_MAILTO_HREF` is the literal `mailto:` href the component
 *     applies to the anchor / asChild link.
 */

/** Canonical href for the "Contacter le support" CTA. */
export const SUPPORT_MAILTO_HREF = "mailto:support@kitchen-boost.com";

/** Path the user is redirected to after sign-out. */
export const SIGN_OUT_REDIRECT_PATH = "/login";

export type NoTenantHandlerDeps = {
  /** Convex Auth's `signOut` action. Returns a Promise — we await it before
   * navigating so the post-redirect render no longer sees a stale session. */
  signOut: () => Promise<unknown>;
  /** Router push (e.g. Next's `router.push`). Called after sign-out resolves. */
  navigate: (path: string) => void;
};

export type NoTenantHandlers = {
  /** Click handler for the « Se déconnecter » button. */
  handleSignOut: () => Promise<void>;
};

/**
 * Build the click handlers for `NoTenantEmptyState`. Pure function — no React,
 * no Convex client. The component layer injects the real `signOut` + router.
 */
export function makeNoTenantHandlers(
  deps: NoTenantHandlerDeps,
): NoTenantHandlers {
  return {
    async handleSignOut() {
      await deps.signOut();
      deps.navigate(SIGN_OUT_REDIRECT_PATH);
    },
  };
}
