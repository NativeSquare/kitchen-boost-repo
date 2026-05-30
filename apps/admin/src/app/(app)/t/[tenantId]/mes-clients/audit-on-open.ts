/**
 * F-MES-CLIENTS [1/4] (#181) — audit-on-open of the "Mes clients" KPI view.
 *
 * The route MUST emit ONE `api.lib.customer.kpi.logKpiConsultation` row per
 * visite (PRD 70 §4.4 + PRD 90 §4: « le front appelle `logKpiConsultation` une
 * fois à l'ouverture de la vue — 1 enregistrement / visite, pas par re-render »
 * — detection scraping + RGPD trace).
 *
 * The challenge: React 19 + Next App Router run in StrictMode in dev, which
 * intentionally MOUNTS twice. A naïve `useEffect(() => mutate(), [])` would
 * emit two audit rows per dev visite (and zero protection in prod if the
 * dependency array ever changes). The remedy is a `useRef` carrying the LAST
 * tenantId we already audited; the audit only fires when `current` differs.
 *
 * The decision is extracted into the pure `shouldFireAudit` so vitest can pin
 * the contract under `environment: "node"` without jsdom / RTL (same split as
 * `decideTenantGate`, `decideSessionGate`, `readTenantIdOrThrow`).
 *
 * `useAuditOnOpen` is the thin React shell: it wires `shouldFireAudit` to a
 * `useRef` and a `useEffect`, and triggers the provided `fire` callback when
 * the rule says so. The route page passes in `useMutation(...logKpiConsultation)`
 * as `fire`; this hook does NOT import Convex itself so it stays trivially
 * testable + decoupled from the mutation transport.
 */
import { useEffect, useRef } from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

export type ShouldFireAuditResult = {
  /** Whether the audit mutation must be called this pass. */
  fire: boolean;
  /** The new value to write back into the `useRef`. */
  nextRef: Id<"tenants"> | undefined;
};

/**
 * Pure decision: should the page fire the audit mutation, given the last
 * tenantId we already audited (`prevSentTenantId`) and the current one
 * (`currentTenantId`).
 *
 * Rules:
 *  - undefined current → never fire (defensive; the route only mounts under a
 *    valid `/t/[tenantId]` segment, but the helper stays total).
 *  - prev === current  → already audited this visite, no-op (suppresses both
 *    StrictMode double-mount AND any re-render unrelated to the tenantId).
 *  - prev !== current  → fresh visite (mount OR tenant switch) → fire, and
 *    advance the ref to the new tenantId.
 */
export function shouldFireAudit(
  prevSentTenantId: Id<"tenants"> | undefined,
  currentTenantId: Id<"tenants"> | undefined,
): ShouldFireAuditResult {
  if (currentTenantId === undefined) {
    return { fire: false, nextRef: prevSentTenantId };
  }
  if (prevSentTenantId === currentTenantId) {
    return { fire: false, nextRef: prevSentTenantId };
  }
  return { fire: true, nextRef: currentTenantId };
}

/**
 * React hook — fires `fire(tenantId)` exactly once per visite of the current
 * `tenantId` (mount, tenant switch). The ref persists across React 19 / Next
 * App Router StrictMode double-mounts so the second pass is a no-op.
 *
 * The hook intentionally takes `fire` as a callback (rather than importing
 * `useMutation` directly) so:
 *   1. It has no Convex dependency → testable from the lean node env without
 *      mocking the Convex client.
 *   2. The page can stay in charge of the mutation reference (one source of
 *      truth for which Convex function gets audited).
 *
 * Dependency array is `[tenantId]` ONLY — never on `fire` (the mutation
 * reference is stable across renders in Convex's `useMutation`, but adding it
 * to the deps array would be defensive-programming masquerading as correctness
 * and could resurrect double-fires if Convex ever returned an unstable ref).
 */
export function useAuditOnOpen(
  tenantId: Id<"tenants"> | undefined,
  fire: (tenantId: Id<"tenants">) => void,
): void {
  const lastSentRef = useRef<Id<"tenants"> | undefined>(undefined);
  useEffect(() => {
    const { fire: shouldFire, nextRef } = shouldFireAudit(
      lastSentRef.current,
      tenantId,
    );
    if (shouldFire && tenantId !== undefined) {
      lastSentRef.current = nextRef;
      fire(tenantId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see jsdoc.
  }, [tenantId]);
}
