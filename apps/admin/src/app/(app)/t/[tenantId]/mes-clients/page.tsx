"use client";

/**
 * F-MES-CLIENTS [1/4] (#181) — Route `/t/[tenantId]/mes-clients/`.
 *
 * First tracer-bullet of F-MES-CLIENTS (the resto KPI-only view, MOAT, PRD 70
 * §4.4 / Q90-Q2). This Slice 1/4 = page skeleton + audit-on-open + empty
 * state. The KPI tiles + reachability + return-rate tiles land in Slices 2-4
 * once `api.lib.customer.kpi.aggregateCustomerKPIs` is branched.
 *
 * Responsibilities (issue #181):
 *   1. Mount a static empty-state surface (no loading skeleton — there's
 *      nothing to load yet, the issue explicitly forbids a loading infini).
 *   2. Call `api.lib.customer.kpi.logKpiConsultation` exactly ONCE on entry
 *      to the view (PRD 70 §4.4 + PRD 90 §4 — 1 row per visite). Re-fires on
 *      tenant switch, suppresses StrictMode double-mount (see
 *      `audit-on-open.ts`).
 *
 * tenantId source: `useCurrentTenantId()` from `<TenantProvider/>` (F-SHELL-04
 * landed via #175 — `t/[tenantId]/layout.tsx`). The issue allows a fallback to
 * `useParams()` if F-SHELL hadn't landed — it has, so we use the sanctioned
 * hook (single source of truth, branded `Id<"tenants">`).
 *
 * Scope discipline (issue #181 hard constraint): this file (and its siblings
 * `audit-on-open.ts` / `empty-state.tsx`) live under
 * `apps/admin/src/app/(app)/t/[tenantId]/mes-clients/` ONLY. Zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import { useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useAuditOnOpen } from "./audit-on-open";
import { MesClientsEmptyState } from "./empty-state";

export default function MesClientsPage() {
  const tenantId = useCurrentTenantId();
  const logKpiConsultation = useMutation(
    api.lib.customer.kpi.logKpiConsultation,
  );

  // One audit row per visite (mount + every tenant switch); the StrictMode
  // double-mount is absorbed by the ref inside `useAuditOnOpen`. We pass a
  // void-returning wrapper so the hook never sees the mutation's Promise (and
  // so React doesn't get confused by an effect "returning" a thenable).
  useAuditOnOpen(tenantId, (id) => {
    void logKpiConsultation({ tenantId: id });
  });

  // Slice 1/4 = empty state only. Slices 2-4 will replace this with KPI tiles
  // wired to `aggregateCustomerKPIs` once that query is consumed here.
  return <MesClientsEmptyState />;
}
