/**
 * PWA-S12 (#464) — Pure helper used by `/api/signout/route.ts` to compute
 * the exact Convex Auth cookie names to delete on a « Ce n'est pas moi → »
 * click.
 *
 * The naming mirrors `@convex-dev/auth/dist/nextjs/server/cookies.js` —
 * which uses `__Host-` prefix on production hosts and a bare name on
 * localhost (Safari refuses `Secure` cookies on `http://localhost`, so the
 * SDK skips the `__Host-` prefix there).
 *
 * Extracted into a pure module so vitest can pin the naming + the host
 * detection in node env without booting a Next request. If the SDK ever
 * broadens its localhost regex or renames its cookies, the pin test fails
 * by construction — surfacing the drift at code-review time rather than
 * silently leaking stale cookies after a deploy.
 */

/**
 * Base names of the three Convex Auth cookies (without the `__Host-` prefix).
 * Source : `@convex-dev/auth/dist/nextjs/server/cookies.js` — the SDK
 * concatenates `prefix + baseName` to compute the actual cookie name.
 */
export const CONVEX_AUTH_COOKIE_BASE_NAMES = [
  "__convexAuthJWT",
  "__convexAuthRefreshToken",
  "__convexAuthOAuthVerifier",
] as const;

/**
 * Replicate the SDK's `isLocalHost` regex exactly :
 * `/(localhost|127\.0\.0\.1):\d+/`. The port suffix is required (the SDK
 * does not match a bare `localhost` without an explicit port).
 */
export function isLocalHost(host: string | null): boolean {
  return /(localhost|127\.0\.0\.1):\d+/.test(host ?? "");
}

/**
 * Compute the three Convex Auth cookie names to delete for a given request
 * host. Returns the bare names on localhost, the `__Host-`-prefixed names
 * everywhere else.
 */
export function convexAuthCookieNames(host: string | null): string[] {
  const prefix = isLocalHost(host) ? "" : "__Host-";
  return CONVEX_AUTH_COOKIE_BASE_NAMES.map((name) => `${prefix}${name}`);
}
