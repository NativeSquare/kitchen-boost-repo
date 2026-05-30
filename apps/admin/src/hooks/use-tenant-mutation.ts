"use client";

/**
 * F-SHELL-05 (#183) — `useTenantMutation`, twin of `useTenantQuery` for
 * Convex mutations. Same invariant (ADR 0014 §4): the `tenantId` from the URL
 * is injected automatically, screens cannot "forget" it.
 *
 * Wiring:
 *   const trigger = useTenantMutation(api.x.update);
 *   await trigger({ name: "alpha" });
 *     → mutation({ tenantId: <fromContext>, name: "alpha" })
 *
 * The merge happens at CALL TIME (inside the returned trigger), against the
 * `tenantId` read once per render via `useCurrentTenantId()` (React rules of
 * hooks require `useContext` at the top). On a tenant switch
 * `<TenantProvider/>` re-renders, the hook re-instantiates, and the trigger
 * closes over the fresh `tenantId` — so callers cached the trigger in a
 * `useCallback` deps array still pick up the right tenant on the next render.
 *
 * Outside `<TenantProvider/>`, the throw raised by `useCurrentTenantId()`
 * fires at render time with the explicit `/t/[tenantId]/...` message
 * established by F-SHELL-04 (#175) — a loud, immediate failure that points
 * straight at the missing layout.
 *
 * Type contract: the trigger fn accepts the mutation's `_args` MINUS
 * `tenantId`; the return type is preserved as `Promise<R>`.
 */

import { useMutation } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { mergeTenantArgs, type PublicTenantArgs } from "./merge-tenant-args";

/** Match Convex's `OptionalRestArgs` ergonomics for zero-public-arg mutations. */
type ArgsTuple<M extends FunctionReference<"mutation">> =
  keyof PublicTenantArgs<M> extends never ? [] : [args: PublicTenantArgs<M>];

type Trigger<M extends FunctionReference<"mutation">> = (
  ...rest: ArgsTuple<M>
) => Promise<FunctionReturnType<M>>;

export function useTenantMutation<M extends FunctionReference<"mutation">>(
  mutation: M,
): Trigger<M> {
  const tenantId = useCurrentTenantId();
  const inner = useMutation(mutation);

  // We deliberately do NOT memoize via `useCallback`: Convex's `useMutation`
  // already returns a stable `ReactMutation` reference, and `tenantId` rarely
  // changes (only on tenant switch, which triggers a layout re-render anyway
  // — the trigger gets re-created with the fresh value). Keeping this hook
  // free of React.useCallback also lets the node-env vitest suite exercise
  // the logic without a React renderer.
  const trigger: Trigger<M> = (...rest: ArgsTuple<M>) => {
    const args = rest[0];
    const merged = mergeTenantArgs(
      tenantId,
      args as Record<string, unknown> | undefined,
    ) as M["_args"];
    // The Convex `ReactMutation` callable accepts `...OptionalRestArgs<M>`,
    // i.e. either `()` if args is EmptyObject or `(args)` otherwise. Casting
    // through `Parameters<typeof inner>` lets us call it uniformly without
    // re-deriving Convex's overload.
    return inner(merged as Parameters<typeof inner>[0]);
  };
  return trigger;
}
