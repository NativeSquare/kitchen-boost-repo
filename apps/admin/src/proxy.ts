import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

/**
 * Next.js 16 middleware (named `proxy.ts` per the Next 16 convention — replaces
 * the older `middleware.ts` filename, see `.next/dev/server/middleware.js`
 * which still imports from `apps/admin/src/proxy.ts`).
 *
 * Scope of this middleware: ONE thing only — bounce already-authenticated
 * visitors away from the public auth pages (a logged-in user landing on
 * `/login` should not see the form, they should go home). Authorization (who
 * can enter what) is owned by `SessionGuard` in React (ADR 0014 §3) because
 * it needs `getSession` (`{ isAdmin, tenants }`) which the middleware can't
 * easily call — and the real isolation barrier is backend anyway
 * (`tenantQuery` / `kbAdminQuery`, ADR 0010).
 *
 * History note: the scaffold shipped a TODO `isProtectedRoute(["/dashboard"])`
 * branch that redirected un-authenticated callers from `/dashboard` to
 * `/login`, AND made every successful login bounce to `/dashboard`. That route
 * never existed in this app (the TODO comment was « Redirect to /app by
 * default » — never done). With the home now being the role-aware
 * `(app)/page.tsx` (ADR 0014 cleanup), we just bounce to `/` and let the home
 * + SessionGuard pick the right destination.
 *
 * The `/signup` and `/verify-email` entries are dropped from `isAuthRoute`
 * because the admin shell is invitation-only (no `/signup` page, ADR 0014 §3
 * — every account is bootstrapped through `/accept-invite?token=...`).
 */
const isAuthRoute = createRouteMatcher([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/otp",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // Logged-in visitor lands on a public auth page → bounce home. The home
  // (`apps/admin/src/app/(app)/page.tsx`) reads the session and redirects to
  // the right surface per role (admin → /monitoring, manager → /t/<id>/menu);
  // we don't try to pick the destination here because the middleware doesn't
  // have access to the session payload — only to "is there a session at all".
  if (isAuthRoute(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/");
  }
});

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
