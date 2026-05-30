import { ConvexError, type Infer } from "convex/values";
import type { tenantStatus } from "../../table/tenants";

/**
 * B-TENANT-LIFECYCLE [2/4] — the PURE tenant lifecycle state machine (PRD 70
 * §3.6 / §4.8, Multi-Tenant CONTEXT). Mirrors the contract `lifecycle.ts`
 * pattern exactly.
 *
 * The lifecycle is the SINGLE source of truth for which tenant status
 * transitions are legal; the upcoming `tenant.updateSettings` (D5) and
 * `tenant.activate` (D6) mutations defer to `assertLegalTenantTransition` so an
 * illegal move (e.g. `disabled → active`, `active → pending`) can never be
 * persisted. NO status outside the schema's `tenantStatus` union is introduced.
 *
 * V1 matrix (strict — comments name the future widening so the intent is
 * traceable; the V1 surface is `pending → active` only):
 *  - `pending → active`     : the KB Admin activates the tenant (D6).
 *  - `active`               : TERMINAL in V1. V2 will add `→ suspended`.
 *  - `suspended`            : TERMINAL in V1. V2 will add `→ active`, `→ disabled`.
 *  - `disabled`             : TERMINAL in V1 (final state — no rehabilitation).
 */

export type TenantStatus = Infer<typeof tenantStatus>;

/**
 * The allowed outgoing transitions per tenant status. `active`, `suspended` and
 * `disabled` are TERMINAL in V1 (empty arrays). Mirrors the contract /
 * `ordersStore` transition-map pattern.
 */
export const TENANT_STATUS_TRANSITIONS: Record<TenantStatus, TenantStatus[]> = {
  pending: ["active"],
  active: [], // V1 strict — V2 will add ["suspended"]
  suspended: [], // V1 — V2 will add ["active", "disabled"]
  disabled: [], // V1 terminal
};

/** Whether `from → to` is a legal tenant lifecycle transition. Pure — no DB. */
export function isLegalTenantTransition(
  from: TenantStatus,
  to: TenantStatus,
): boolean {
  return TENANT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Throw `INVALID_STATE` unless `from → to` is a legal transition. Centralises
 * the lifecycle guard so a skip-ahead, a backward step, a terminal exit, or a
 * self-loop is rejected, never silently applied (mirrors
 * `assertLegalContractTransition`).
 */
export function assertLegalTenantTransition(
  from: TenantStatus,
  to: TenantStatus,
): void {
  if (!isLegalTenantTransition(from, to)) {
    throw new ConvexError({
      code: "INVALID_STATE",
      message: `Illegal tenant transition "${from}" → "${to}".`,
    });
  }
}
