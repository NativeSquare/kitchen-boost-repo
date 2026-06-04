/**
 * PWA-S1 (#449) — `tenant-resolver` module API.
 *
 * The PWA edge middleware (`apps/web/src/proxy.ts`) consumes:
 *  - `decideTenantResolution(input)` → pure decision (verdict).
 *  - The IO adapters (Convex `fetchQuery`, cookie set/clear, rewrite/error
 *    response) are wired by the middleware itself — splitting "decide" from
 *    "perform" lets vitest pin every branch in node env.
 *
 * Types are re-exported so the middleware (and any future RSC reading the
 * resolved tenant from a header) shares ONE source of truth for the verdict
 * shape (`TenantResolutionVerdict`) + the minimal projection
 * (`ResolvedTenant`).
 */
export {
  decideTenantResolution,
  type ResolvedTenant,
  type TenantResolutionInput,
  type TenantResolutionVerdict,
} from "./decide-tenant-resolution";
