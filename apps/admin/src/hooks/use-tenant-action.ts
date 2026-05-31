"use client";

/**
 * F-COMMANDES-REFUND (#243) — `useTenantAction`, twin of `useTenantMutation`
 * for Convex actions. Same invariant (ADR 0014 §4): the `tenantId` from the
 * URL is injected automatically, screens cannot "forget" it.
 *
 * Wiring:
 *   const trigger = useTenantAction(api.lib.stripe.refund.refundOrder);
 *   await trigger({ orderId });
 *     → action({ tenantId: <fromContext>, orderId })
 *
 * Why a dedicated hook (rather than reusing `useTenantMutation` or calling
 * raw `useAction`):
 *   - `useTenantMutation` wraps `useMutation` only — the underlying Convex
 *     primitives are distinct (mutations open a transaction, actions don't);
 *     a `tenantAction` like `refundOrder` (Stripe HTTP call) is registered as
 *     an ACTION on the backend and Convex's `useMutation` would refuse the
 *     reference at type level.
 *   - Calling raw `useAction(api...)` from a page would force the caller to
 *     hand-thread the `tenantId` arg from the URL (or from `useCurrentTenantId
 *     ()`) — exactly the boilerplate ADR 0014 §4 forbids; one missed call site
 *     leaks the wrong tenant's id into a Stripe refund.
 *
 * Type contract: identical to `useTenantMutation` — the trigger fn accepts the
 * action's `_args` MINUS `tenantId`; the return type is preserved as
 * `Promise<R>`.
 */

import { useAction } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { mergeTenantArgs, type PublicTenantArgs } from "./merge-tenant-args";

/** Match Convex's `OptionalRestArgs` ergonomics for zero-public-arg actions. */
type ArgsTuple<A extends FunctionReference<"action">> =
  keyof PublicTenantArgs<A> extends never ? [] : [args: PublicTenantArgs<A>];

type Trigger<A extends FunctionReference<"action">> = (
  ...rest: ArgsTuple<A>
) => Promise<FunctionReturnType<A>>;

export function useTenantAction<A extends FunctionReference<"action">>(
  action: A,
): Trigger<A> {
  const tenantId = useCurrentTenantId();
  const inner = useAction(action);

  // Same memoisation discipline as `useTenantMutation`: Convex's `useAction`
  // already returns a stable `ReactAction` reference, and `tenantId` rarely
  // changes (only on tenant switch). Keeping this hook free of `useCallback`
  // also lets the node-env vitest suite exercise the logic without a React
  // renderer (mirrors `use-tenant-mutation.test.ts`).
  const trigger: Trigger<A> = (...rest: ArgsTuple<A>) => {
    const args = rest[0];
    const merged = mergeTenantArgs(
      tenantId,
      args as Record<string, unknown> | undefined,
    ) as A["_args"];
    return inner(merged as Parameters<typeof inner>[0]);
  };
  return trigger;
}
