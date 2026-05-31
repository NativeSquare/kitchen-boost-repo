"use client";

/**
 * F-CAMPAGNES [1/7] (#179) — Route `/t/[tenantId]/campagnes/`.
 *
 * First tracer-bullet of the resto campaign UI (parent EPIC #145, PRD 80 §4 +
 * ADR 0006). Wires the chain end-to-end:
 *
 *   route tenant-scopée → query Convex tenant-scopée (listTenantTemplates) → rendu liste
 *
 * Issue body verbatim: « prouver que la route existe sous
 * (app)/t/[tenantId]/campagnes/, que `useTenantQuery` route bien la query au
 * bon tenant, et que `listTenantTemplates` retourne bien scope:"tenant" +
 * active:true pour ce tenant. Les slices suivantes habillent. »
 *
 * Responsibilities (#179):
 *   1. Bind `api.lib.notifications.campaigns.listTenantTemplates` through
 *      `useTenantQuery` so the tenantId from `<TenantProvider/>` (mounted by
 *      the chrome-less `/t/[tenantId]` layout, F-SHELL-04 #175) is injected
 *      automatically — never a raw `useQuery` (front-side `withTenant`
 *      discipline, ADR 0014 §4 / F-SHELL-05 #183).
 *   2. Delegate rendering to the pure `CampagnesView` — keeps the page thin
 *      and the view testable under `environment: "node"` (same split as
 *      `mes-clients/page.tsx` and `parametres/page.tsx`).
 *
 * Access guard (cross-tenant): inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04). The backend wrapper
 * (`tenantQuery({ allow: ["kb_manager"] })` on `listTenantTemplates`) is the
 * hard isolation barrier (ADR 0010 — refuses Forbidden even if the layout
 * regresses; cross-tenant fuzz already shipped by the slice that landed the
 * query, B-CAMPAIGN-TEMPLATES-03 #170).
 *
 * Scope discipline (#179 hard constraint — explicit in the issue body): this
 * file (and its siblings under `apps/admin/src/app/(app)/t/[tenantId]/campagnes/`)
 * is the ONLY surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantQuery } from "@/hooks";

import { CampagnesView } from "./campagnes-view";

export default function CampagnesPage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by
  // the chrome-less `/t/[tenantId]` layout) and injects it into args (ADR
  // 0014 §4 / #183). `undefined` is the loading sentinel; a successful read
  // returns `TenantTemplateSummary[]` (possibly empty).
  const templates = useTenantQuery(
    api.lib.notifications.campaigns.listTenantTemplates,
  );

  return <CampagnesView templates={templates} />;
}
