"use client";

/**
 * F-SHELL-05 (#183) — `useTenantQuery`, the front-side equivalent of the
 * backend `no-untenanted-query` discipline (ADR 0014 §4).
 *
 * Reads the `tenantId` from `TenantContext` (F-SHELL-04, #175) and INJECTS it
 * into the args before delegating to Convex's `useQuery` — so every surface
 * mounted under `/t/[tenantId]/...` can call a `tenantQuery` without
 * remembering to thread the tenant through by hand.
 *
 * Wiring:
 *   useTenantQuery(api.x.y)          → useQuery(api.x.y, { tenantId })
 *   useTenantQuery(api.x.y, { foo }) → useQuery(api.x.y, { tenantId, foo })
 *   useTenantQuery(api.x.y, "skip")  → useQuery(api.x.y, "skip")
 *
 * Outside `<TenantProvider/>` the hook re-throws the explicit
 * `useCurrentTenantId()` error mentioning `/t/[tenantId]/...`. That makes
 * "I rendered a tenant surface without the layout" a loud, immediate failure
 * rather than a silent bad call to the backend (which would also refuse, but
 * with a less actionable error — ADR 0010).
 *
 * Type contract:
 *   - The query is typed as a `FunctionReference<"query">` whose `_args`
 *     INCLUDES `tenantId`.
 *   - The public signature accepts `_args` MINUS `tenantId` (or `"skip"`).
 *   - The return type is preserved from the underlying `useQuery`
 *     (`R | undefined`, where `undefined` is the loading sentinel).
 */

import { useQuery } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { mergeTenantArgs, type PublicTenantArgs } from "./merge-tenant-args";

/**
 * If the public args object has no remaining required keys, allow omitting
 * the `args` parameter entirely (matches Convex's own `OptionalRestArgs`
 * ergonomics for zero-arg queries).
 */
type ArgsTuple<Q extends FunctionReference<"query">> =
  keyof PublicTenantArgs<Q> extends never
    ? [args?: PublicTenantArgs<Q> | "skip"]
    : [args: PublicTenantArgs<Q> | "skip"];

export function useTenantQuery<Q extends FunctionReference<"query">>(
  query: Q,
  ...rest: ArgsTuple<Q>
): FunctionReturnType<Q> | undefined {
  const tenantId = useCurrentTenantId();
  const args = rest[0];
  // The cast is the explicit handshake between the public-facing typing
  // (which hides `tenantId`) and the real Convex args shape (which has it).
  // `mergeTenantArgs` is the only place that writes it.
  const merged = mergeTenantArgs(
    tenantId,
    args as Record<string, unknown> | undefined | "skip",
  ) as Q["_args"] | "skip";
  // Convex's useQuery overload distinguishes `"skip"` from a real args object
  // — we forward whatever we produced (either is valid here).
  return useQuery(query, merged as Parameters<typeof useQuery<Q>>[1]) as
    | FunctionReturnType<Q>
    | undefined;
}

// Re-export the branded id alias so consumers can spell the tenant type
// without reaching into the backend package directly.
export type TenantId = Id<"tenants">;
