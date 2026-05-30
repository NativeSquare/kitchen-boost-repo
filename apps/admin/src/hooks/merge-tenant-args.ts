/**
 * F-SHELL-05 (#183) — pure core of `useTenantQuery` / `useTenantMutation`.
 *
 * Takes the `tenantId` read from the `TenantContext` (F-SHELL-04, #175) and
 * the caller's `args`, returns the args object that the underlying Convex
 * `useQuery` / `useMutation` should receive.
 *
 * Three shapes in, three shapes out — pinned by `merge-tenant-args.test.ts`:
 *
 *   mergeTenantArgs(t, undefined)          → { tenantId: t }
 *   mergeTenantArgs(t, { foo: 1 })          → { tenantId: t, foo: 1 }
 *   mergeTenantArgs(t, "skip")              → "skip"
 *   mergeTenantArgs(t, { tenantId: x, ...}) → { tenantId: t, ... }   ← override
 *
 * The `"skip"` passthrough is the Convex sentinel used by `useQuery`: returning
 * it unchanged lets the caller short-circuit the subscription (e.g. wait for a
 * gate to resolve) while still going through the auto-tenant hook.
 *
 * The override rule (caller's `tenantId` is silently replaced by the context
 * value) is intentional, ADR 0014 §4: "the tenant courant comes from the URL,
 * period". A surface that hand-wrote `tenantId` got the rule wrong; honouring
 * its value would defeat the purpose of the hook.
 *
 * Pure on purpose: no React, no Convex import — keeps `vitest.config.ts`
 * `environment: "node"` and the bundle lean.
 */

import type { Id } from "@packages/backend/convex/_generated/dataModel";

/**
 * The shape `useQuery` expects: either an args object, or the Convex
 * `"skip"` sentinel that opts out of the subscription.
 */
export type TenantQueryArgs<TArgs> = TArgs | "skip";

/**
 * Merge `tenantId` into `args`, with the `"skip"` passthrough preserved.
 *
 * Implementation note: when args is an object, we spread caller props first
 * then write `tenantId` LAST so the URL-derived value wins over a stale value
 * the caller may have hand-written (ADR 0014 §4 invariant).
 */
export function mergeTenantArgs<TArgs extends Record<string, unknown>>(
  tenantId: Id<"tenants">,
  args: TArgs | undefined | "skip",
): (TArgs & { tenantId: Id<"tenants"> }) | "skip" {
  if (args === "skip") return "skip";
  if (args === undefined) {
    return { tenantId } as TArgs & { tenantId: Id<"tenants"> };
  }
  return { ...args, tenantId };
}
