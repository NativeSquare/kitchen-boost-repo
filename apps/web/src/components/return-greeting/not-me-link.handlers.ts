/**
 * PWA-S12 (#464) — Pure handlers + config for `<NotMeLink>`.
 *
 * The React component (`not-me-link.tsx`) is a thin `"use client"` shell that
 * wires Convex's `useAuthActions().signOut`, a `fetch` to `/api/signout`, and
 * `window.location.reload` into the handlers exposed here. The branching
 * logic lives in this module so vitest can pin it under `environment: "node"`
 * — same architectural split as `apps/admin/src/components/app/
 * no-tenant-empty-state.handlers.ts` (the F-SHELL-03 pattern).
 *
 * Acceptance criteria of issue #464 pinned here :
 *   - « Click "Ce n'est pas moi →" → clear cookie + page reload → form vide
 *     + bandeau absent ».
 *
 * Ordering : `signOut` (localStorage tokens) → `postSignout` (HttpOnly
 * cookies) → `reload` (visible disown). Inverting any step leaves a window
 * where the next render still sees a stale session (Q3 « JAMAIS flash
 * "Bonjour ..." après disown »).
 *
 * Resilience : each side-effect step swallows its own errors. The `reload`
 * is the user-visible promise of « ça s'est passé » — it MUST happen, even
 * when both client + server clears partially fail (the worst case leaves
 * the HttpOnly cookie until its 365d TTL, an acceptable degradation vs
 * leaving the user stranded on a « Bonjour Sophie » page with a broken
 * disown link).
 *
 * The tenant cookie (`__Host-kb_tenant`) is INTENTIONALLY untouched (Q3
 * cohabitation rule : « 2 cookies indépendants, aucune fusion ») — the
 * tenant resolution survives the disown action, the route handler at
 * `/api/signout` only touches the Convex Auth cookies.
 */

/** Canonical POST path the component fetches to clear server-side cookies. */
export const SIGNOUT_API_PATH = "/api/signout";

export type NotMeHandlerDeps = {
  /** Convex Auth's `signOut` action (clears the localStorage tokens — the
   * client cache the SDK reads first). Returns a Promise. */
  signOut: () => Promise<unknown>;
  /** POST to the `/api/signout` route handler — wipes the HttpOnly
   * `__Host-…convexAuthJWT…` cookies the RSC reads via
   * `convexAuthNextjsToken()`. */
  postSignout: () => Promise<unknown>;
  /** Hard reload of the current page (typically
   * `() => window.location.reload()`). Called LAST so the next render
   * reflects the cleared session. */
  reload: () => void;
};

export type NotMeHandlers = {
  /** Click handler for the « Ce n'est pas moi → » link. */
  handleNotMe: () => Promise<void>;
};

/**
 * Build the click handler for `<NotMeLink>`. Pure function — no React, no
 * Convex client, no `window`. The component layer injects the real
 * `signOut` + fetch + reload.
 *
 * Each side-effect is awaited and its rejection is caught — the chain
 * always reaches `reload()` so the user always sees a fresh page after a
 * click (per Q3 disown UX promise).
 */
export function makeNotMeHandlers(deps: NotMeHandlerDeps): NotMeHandlers {
  return {
    async handleNotMe() {
      try {
        await deps.signOut();
      } catch {
        // Swallow: localStorage clear may throw in private mode / quota
        // exhausted. The server cookie clear + the reload still happen.
      }
      try {
        await deps.postSignout();
      } catch {
        // Swallow: the POST can fail offline. Degrade to client-only
        // disown — the localStorage clear above already removed the
        // cached tokens.
      }
      deps.reload();
    },
  };
}
