"use client";

/**
 * F-MES-CLIENTS [2/4] (#186) — Route `/t/[tenantId]/mes-clients/`.
 *
 * Second tracer-bullet of F-MES-CLIENTS (the resto KPI-only view, MOAT, PRD
 * 70 §4.4 / Q90-Q2 / ADR 0010). Slice 1 (#181) landed the page skeleton +
 * audit-on-open + empty state; this slice branches
 * `api.lib.customer.kpi.aggregateCustomerKPIs` via `useTenantQuery` (ADR
 * 0014 §4) and renders the 3 segment cards (Actifs / Inactifs / VIP).
 *
 * Responsibilities (issue #186):
 *   1. Mount the audit-on-open wiring from slice 1 — one `logKpiConsultation`
 *      row per visite (PRD 70 §4.4 + PRD 90 §4). Untouched here, see
 *      `audit-on-open.ts`.
 *   2. Bind `aggregateCustomerKPIs` through `useTenantQuery` so the tenantId
 *      from `<TenantProvider/>` is injected automatically (front-side
 *      `withTenant` discipline, ADR 0014 §4) — never a raw `useQuery`.
 *   3. Catch the query's error path (incl. Forbidden / « accès refusé »)
 *      with a route-segment Error Boundary (`./error.tsx`, Next.js App
 *      Router convention) so the React tree never crashes the shell. The
 *      view's `null` branch is reserved for the recoverable error path that
 *      doesn't unmount the route segment.
 *   4. Delegate rendering to the pure `MesClientsView` — keeps the page
 *      thin and the view testable under `environment: "node"` (same split
 *      as `monitoring-view.tsx`).
 *
 * Scope discipline (#186 hard constraint, mirrors #181): this file (and its
 * siblings under `apps/admin/src/app/(app)/t/[tenantId]/mes-clients/`) is
 * the ONLY surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";

import { useAuditOnOpen } from "./audit-on-open";
import { MesClientsView } from "./mes-clients-view";

export default function MesClientsPage() {
  const tenantId = useCurrentTenantId();

  // Audit-on-open (slice 1 #181). The decision logic + StrictMode double-
  // mount suppression live in `useAuditOnOpen` / `shouldFireAudit` — pinned
  // by `audit-on-open.test.ts`. We pass a void-returning wrapper so the
  // hook never sees the mutation's Promise.
  const logKpiConsultation = useMutation(
    api.lib.customer.kpi.logKpiConsultation,
  );
  useAuditOnOpen(tenantId, (id) => {
    void logKpiConsultation({ tenantId: id });
  });

  // Bind aggregateCustomerKPIs through `useTenantQuery` — the hook reads
  // `tenantId` from `<TenantProvider/>` and injects it into args (ADR 0014
  // §4 / #183). Loading is the `undefined` sentinel; a thrown error
  // (Forbidden, network, etc.) propagates up to `./error.tsx` (Next route-
  // segment Error Boundary), so the view's `null` branch is the explicit
  // "we got back nothing usable" fallback when the wrapper page chooses to
  // render the recoverable error inline. Today, `undefined` (loading) and
  // resolved aggregates are the only states the page produces directly —
  // hard errors are taken by the Error Boundary.
  const kpis = useTenantQuery(api.lib.customer.kpi.aggregateCustomerKPIs);

  return <MesClientsView kpis={kpis} />;
}
