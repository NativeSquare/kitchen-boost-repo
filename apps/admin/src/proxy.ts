import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isAuthRoute = createRouteMatcher([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/otp",
]);
const isProtectedRoute = createRouteMatcher(["/dashboard"]); // TODO : Redirect to /app by default

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isAuthRoute(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/dashboard");
  }
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};