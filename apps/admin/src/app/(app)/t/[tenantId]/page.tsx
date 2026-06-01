"use client";

/**
 * F-STATS-DASHBOARD (#252) — tenant home `/t/[tenantId]/page.tsx`.
 *
 * Renders the 4 KPI cards du JOUR (CA, nb commandes, panier moyen, commandes
 * en cours) for the gérant restaurateur. Thin wiring layer between the Convex
 * tenant-scoped query `dailyKpis` (lib/stats/, livré DANS cette story) and the
 * pure `DashboardView` (loading / empty / populated / error branches).
 *
 * The previous version of this file (#176) redirected `/t/[tenantId]` →
 * `/t/[tenantId]/menu` because the dashboard didn't exist yet. This story
 * replaces the redirect with the real home — pinned by `page.test.ts` (« does
 * NOT redirect anywhere »).
 *
 * Access guard (cross-tenant): inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175). The backend wrapper
 * (`tenantQuery({ allow: ["kb_manager", "staff"] })` on `dailyKpis`) is the
 * hard isolation barrier (ADR 0010 — refuses Forbidden even if the layout
 * regresses; cross-tenant fuzz shipped by `dailyKpis.test.ts`).
 *
 * Error branch wiring: `useTenantQuery` itself does NOT expose a query error
 * — Convex surfaces query errors by re-throwing during render (the layout's
 * ErrorBoundary catches them then). We therefore do NOT pass `null` for an
 * error here ; we only pass the tri-state Convex sentinel (`undefined`
 * loading / object resolved). The DashboardView's `null` (error) branch is a
 * defensive surface kept available for a future hook upgrade (or a manual
 * caller from a route segment that owns its own error boundary).
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantQuery } from "@/hooks";

import { DashboardView } from "./dashboard-view";

export default function TenantDashboardPage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by the
  // chrome-less `/t/[tenantId]/layout.tsx`) and injects it into args (ADR
  // 0014 §4 / F-SHELL-05 #183). Convex sentinel : `undefined` = loading,
  // resolved = `{ caTotal, nbCommandes, panierMoyen, commandesEnCours }`.
  const kpis = useTenantQuery(api.lib.stats.dailyKpis.dailyKpis);

  return <DashboardView kpis={kpis} />;
}
