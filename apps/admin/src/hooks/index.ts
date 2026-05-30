/**
 * Public module API for `apps/admin/src/hooks/` — the front-side equivalent of
 * a `convex/lib/<feature>/index.ts` barrel. Each F-SHELL hook is a thin
 * wrapper over a Convex primitive that enforces an invariant from ADR 0014.
 *
 * F-SHELL-05 (#183) — `useTenantQuery` / `useTenantMutation`: auto-inject the
 * current `tenantId` from `TenantContext` (F-SHELL-04, #175) into every
 * `tenantQuery` / `tenantMutation` call. Front equivalent of the backend
 * `no-untenanted-query` discipline.
 */
export { useTenantQuery } from "./use-tenant-query";
export { useTenantMutation } from "./use-tenant-mutation";
export { mergeTenantArgs, type TenantQueryArgs } from "./merge-tenant-args";
