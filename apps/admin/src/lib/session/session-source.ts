"use client";

/**
 * `useSessionSource` — thin bridge between Convex's `useQuery` and the
 * session reducer. Owns the ONE place that knows about `api.auth.getSession`.
 *
 * STUB STATE (this PR — F-SHELL-01, issue #159):
 * The backend query `api.auth.getSession` (story #162, D1 of PRD 70) is not
 * merged yet. Per the F-SHELL-01 issue: "Si `getSession` n'est pas encore
 * mergée backend, mocker la query côté front avec un stub typé — l'objectif
 * est que le contexte/hook soient câblés et testables."
 *
 * The stub keys off Convex Auth's `useConvexAuth()` (already wired in the
 * shell): unauth → `unauthenticated` source (typed Error); auth → `loading`
 * until backend D1 ships. This is intentionally conservative: nothing
 * downstream falsely sees a fake `ready` session with fabricated tenant
 * data, so no shell surface accidentally renders against a lie.
 *
 * SWAP-IN PLAN (when #162 merges):
 *   const data = useQuery(
 *     api.auth.getSession,
 *     isAuthenticated ? {} : "skip",
 *   );
 *   if (!isAuthenticated) return new Error("not_authenticated");
 *   return data; // undefined | SessionData; thrown errors caught by boundary
 *
 * The reducer + provider + hook + (app) layout wiring all keep working
 * unchanged — that's the point of isolating this bridge.
 */
import { useConvexAuth } from "convex/react";
import type { SessionSource } from "./reducer";

export function useSessionSource(): SessionSource {
  const { isAuthenticated, isLoading } = useConvexAuth();

  // Convex Auth still verifying the session cookie → still loading.
  if (isLoading) return undefined;

  // No session at all → the future `getSession` would also throw
  // `not_authenticated`. Surface that uniformly via an Error instance so the
  // reducer maps to `unauthenticated`.
  if (!isAuthenticated) {
    return new Error("not_authenticated");
  }

  // Authenticated but backend D1 not yet shipped: report `loading` rather
  // than fabricating a `ready` session. The shell's later garde tracer-
  // bullets will read this and render their loading skeleton — never a
  // ghost dashboard with empty `tenants`.
  return undefined;
}
