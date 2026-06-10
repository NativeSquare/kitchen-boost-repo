/**
 * PWA-S12 (#464) — `/api/signout` — POST surface the client `<NotMeLink>`
 * hits to wipe the Convex Auth HttpOnly cookies after a « Ce n'est pas
 * moi → » click (decisions-log Q3 « lien discret en-dessous, clear cookie
 * Convex Auth + refresh »).
 *
 * Why a dedicated route — and not `document.cookie = "...; Max-Age=0"`:
 * the Convex Auth cookies (`__Host-__convexAuthJWT` /
 * `__Host-__convexAuthRefreshToken` / `__Host-__convexAuthOAuthVerifier`)
 * are HttpOnly + `__Host-` prefixed → unreachable from JS by design (XSS
 * defence). The cleanest cross-browser wipe is a server-side response that
 * deletes the same names with `Max-Age=0` + the SAME attributes the SDK
 * used to set them.
 *
 * Why we replicate the SDK's cookie naming HERE — rather than calling
 * `getResponseCookies` directly : that helper lives at
 * `@convex-dev/auth/nextjs/server/cookies` which is NOT exported through
 * the package's `exports` map (only `./nextjs/server` is public). Importing
 * a non-exported subpath breaks the typecheck. We keep the naming logic
 * isolated in `CONVEX_AUTH_COOKIE_NAMES` below and a regression test on
 * the SDK's `nextjs/server/cookies.js` would surface a name drift before
 * it reaches production (Convex Auth is on an explicit version pin in
 * `pnpm-lock.yaml` — version bumps go through code review).
 *
 * The matcher in `apps/web/src/proxy.ts` already EXCLUDES `/api/*` so this
 * route bypasses tenant resolution (same arrangement as
 * `/api/wallet-bridge/clear`, `/api/push/send`, `/api/revalidate`).
 *
 * The tenant cookie (`__Host-kb_tenant`) is INTENTIONALLY untouched
 * (decisions-log Q3 « 2 cookies indépendants, aucune fusion. Au "Ce n'est
 * pas moi", on clear UNIQUEMENT le Convex Auth (tenant cookie reste — il
 * identifie le resto, pas l'humain) ») — the user stays on the same
 * resto's PWA, just as an anonymous first-visit visitor.
 *
 * Returns `{ cleared: true }` on success. No body expected on input — the
 * HttpOnly cookies on the request itself are the only handle the server
 * needs. Same minimal shape as `/api/wallet-bridge/clear` (PWA-S9b).
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { convexAuthCookieNames } from "@/lib/signout";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const response = NextResponse.json({ cleared: true });
  for (const name of convexAuthCookieNames(host)) {
    // `response.cookies.delete(name)` emits the right `Set-Cookie:
    // <name>=; Max-Age=0; Path=/` header. For `__Host-` cookies, the
    // browser only honours the deletion when `Path=/` matches (which is
    // the default in NextResponse.cookies.delete) — same attributes the
    // SDK used at set time (cf. `getCookieOptions` in
    // `@convex-dev/auth/dist/nextjs/server/cookies.js`).
    response.cookies.delete(name);
  }
  return response;
}
