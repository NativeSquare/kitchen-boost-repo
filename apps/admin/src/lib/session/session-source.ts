"use client";

/**
 * `useSessionSource` — thin bridge between Convex's `useQuery` and the
 * session reducer. Owns the ONE place that knows about
 * `api.lib.auth.getSession.getSession`.
 *
 * History:
 *   - F-SHELL-01 (issue #159) landed this file as a STUB returning `undefined`
 *     while authenticated, because the backend query wasn't merged yet. The
 *     stub had a "SWAP-IN PLAN (when #162 merges)" embedded in its comment.
 *   - #162 (B-AUTH-1 getSession skeleton) and #171 (B-AUTH-2 getSession join
 *     userTenants + tenants) both merged later in the same loop — but no
 *     story explicitly wired the front to consume them, so the stub stayed.
 *     Result: every `useSession()` call across the shell returned `loading`
 *     forever once authenticated, and every page under `(app)` hung at the
 *     SessionLoader spinner. Discovered manually during E2E-A1 validation.
 *
 * This file now performs the swap: it calls `api.lib.auth.getSession.getSession`
 * gated on `useConvexAuth().isAuthenticated`, and lets the reducer map the
 * three observable shapes (`undefined` / `Error` / `SessionData`) to the
 * three session states.
 *
 * Backend contract (PRD 70 D1, ADR 0014 §3): the query throws
 * `Not authenticated` for unauth callers — we never let it reach that branch
 * because we pass `"skip"` when `isAuthenticated === false`. For an
 * authenticated KB Admin it returns `{ isAdmin: true, tenants: [] }`; for an
 * authenticated KB Manager / staff it returns `{ isAdmin: false, tenants:
 * [...] }` with one entry per active `userTenants` row joined with the
 * tenant's display fields.
 */
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { SessionSource } from "./reducer";

export function useSessionSource(): SessionSource {
  const { isAuthenticated, isLoading } = useConvexAuth();

  // Always call the hook (rules of hooks). `"skip"` short-circuits the
  // network request when the caller isn't authenticated, so the backend's
  // `Not authenticated` throw never fires for legitimately-anonymous visitors.
  const data = useQuery(
    api.lib.auth.getSession.getSession,
    isAuthenticated ? {} : "skip",
  );

  // Convex Auth still verifying the session cookie → still loading.
  if (isLoading) return undefined;

  // No session at all → surface a typed Error so the reducer maps to
  // `unauthenticated`. The shell SessionGuard then drives the redirect.
  if (!isAuthenticated) {
    return new Error("not_authenticated");
  }

  // Authenticated. Query may still be in flight (`undefined`) or resolved
  // (`SessionData`). The reducer maps `undefined` → `loading` and the
  // payload → `ready`.
  return data;
}
