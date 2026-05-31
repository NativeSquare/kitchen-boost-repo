"use client";

/**
 * F-CAMPAGNES [1/7] (#179) + [2/7] (#188) — Route
 * `/t/[tenantId]/campagnes/`.
 *
 * Slice 1 (#179) wired the tracer-bullet end-to-end (route + tenant query
 * + brute list). Slice 2 (#188) introduces the `TemplatePicker` /
 * `TemplateCard` shadcn surfaces. The page is still the thin wiring layer
 * between the Convex hook and the presentational shell:
 *
 *   route tenant-scopée
 *     → query Convex tenant-scopée (listTenantTemplates)
 *       → tenantId injected via useCurrentTenantId
 *         → rendered through CampagnesView → TemplatePicker → TemplateCard
 *
 * Responsibilities:
 *   1. Bind `api.lib.notifications.campaigns.listTenantTemplates` through
 *      `useTenantQuery` so the tenantId from `<TenantProvider/>` (mounted
 *      by the chrome-less `/t/[tenantId]` layout, F-SHELL-04 #175) is
 *      injected automatically — never a raw `useQuery` (front-side
 *      `withTenant` discipline, ADR 0014 §4 / F-SHELL-05 #183).
 *   2. Read the current `tenantId` via `useCurrentTenantId()` and forward
 *      it to `CampagnesView` — `TemplateCard` needs it to build per-card
 *      hrefs `/t/[tenantId]/campagnes/[templateId]` (slice 2, #188). We
 *      thread it as a prop rather than calling the hook deep inside the
 *      view so the view stays a pure function callable from its node-env
 *      unit test.
 *   3. Delegate rendering to the pure `CampagnesView` — keeps the page
 *      thin and the view testable under `environment: "node"` (same split
 *      as `mes-clients/page.tsx` and `parametres/page.tsx`).
 *
 * Access guard (cross-tenant): inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04). The backend wrapper
 * (`tenantQuery({ allow: ["kb_manager"] })` on `listTenantTemplates`) is
 * the hard isolation barrier (ADR 0010 — refuses Forbidden even if the
 * layout regresses; cross-tenant fuzz already shipped by the slice that
 * landed the query, B-CAMPAIGN-TEMPLATES-03 #170).
 *
 * Scope discipline (#188 hard constraint — explicit in the issue body):
 * this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";

import { CampagnesView } from "./campagnes-view";

export default function CampagnesPage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by
  // the chrome-less `/t/[tenantId]` layout) and injects it into args (ADR
  // 0014 §4 / #183). `undefined` is the loading sentinel; a successful
  // read returns `TenantTemplateSummary[]` (possibly empty).
  const templates = useTenantQuery(
    api.lib.notifications.campaigns.listTenantTemplates,
  );
  // Same tenantId as the one injected into the query — `useTenantQuery`
  // reads it from the same context. We re-read it here ONLY to forward it
  // into the picker so per-card hrefs can be built without re-running the
  // hook deep inside the view (which would break its pure-function
  // testability).
  const tenantId = useCurrentTenantId();

  return <CampagnesView tenantId={tenantId} templates={templates} />;
}
