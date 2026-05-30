"use client";

/**
 * F-PARAMETRES-01 (#193) — Route `/t/[tenantId]/parametres/`.
 *
 * First tracer-bullet of EPIC F-PARAMETRES #148 (« Form tenant.updateSettings
 * + horaires serviceHours »): mounts the page skeleton with 4 placeholder
 * section cards (Identité visuelle / Coordonnées / Modes acceptés / Horaires
 * de service) and the read-only « Zone livraison Uber Direct » informational
 * block. The per-section editors (logo upload, color picker, address/phone
 * form, accepted-modes toggles, service-hours grid) land in slices
 * F-PARAMETRES-02..05.
 *
 * Responsibilities (issue #193):
 *   1. Bind ONE tenant-scoped read — `api.lib.menu.serviceHours.get` —
 *      through `useTenantQuery` so the tenantId from `<TenantProvider/>` is
 *      injected automatically (front-side `withTenant` discipline, ADR 0014
 *      §4 / #183), never a raw `useQuery` (would bypass tenantId injection
 *      and either fail at runtime or leak the wrong tenant's data, ADR 0010).
 *      This is the source of truth for the future « Horaires de service »
 *      editor (F-PARAMETRES-05). The other three sections (Identité visuelle,
 *      Coordonnées, Modes acceptés) read tenant-row fields (`branding`,
 *      `address`, `phone`, `acceptedModes`) for which no kb_manager
 *      `tenantQuery` is exposed today — those queries land alongside their
 *      editors in F-PARAMETRES-02..04 (out of scope of this slice).
 *   2. Delegate rendering to the pure `ParametresView` — keeps the page thin
 *      and the view testable under `environment: "node"` (same split as
 *      `menu/page.tsx` / `mes-clients/page.tsx`).
 *   3. NO mutation called (issue body « pas de mutation à ce stade »). The
 *      `useMutation` import is deliberately absent; mutations land in
 *      F-PARAMETRES-02..05.
 *
 * Access guard: inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04, #175) — a KB Manager who
 * tries to reach a tenant they don't own is redirected by `decideTenantGate`
 * before this page ever renders; a KB Admin reaching a non-existent
 * `tenantId` gets a clean 404. The backend `tenantQuery` wrapper of
 * `serviceHours.get` is the hard isolation barrier (ADR 0010 — even if a
 * future regression bypassed the layout, the wrapper would refuse Forbidden).
 *
 * Scope discipline (#193 hard constraint, mirrors menu/page.tsx and
 * mes-clients/page.tsx): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/parametres/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`,
 * `packages/backend/convex/`, or the shared admin sidebar.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantQuery } from "@/hooks";

import { ParametresView } from "./parametres-view";

export default function ParametresPage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by
  // the chrome-less `/t/[tenantId]` layout) and injects it into args (ADR
  // 0014 §4 / #183). `undefined` is the loading sentinel; a successful read
  // returns `{ windows: ServiceWindow[] }` (possibly empty).
  const serviceHours = useTenantQuery(api.lib.menu.serviceHours.get);

  return <ParametresView serviceHours={serviceHours} />;
}
