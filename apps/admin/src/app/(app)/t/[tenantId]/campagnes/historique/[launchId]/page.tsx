"use client";

/**
 * F-CAMPAGNES [6/7] (#240) — Route
 * `/t/[tenantId]/campagnes/historique/[launchId]`.
 *
 * Thin wiring layer between the Convex tenant-scoped query
 * (`getTenantCampaignLaunch`), the URL segment (`launchId` resolved via
 * `useParams`), and the pure `LaunchDetailView` (loading / not-found / loaded
 * branches). Same shape as the slice-3 `[templateId]/page.tsx` (#205 pattern).
 *
 * Access guard (cross-tenant): inherited transitively from
 *   - the parent `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04),
 *   - the backend `tenantQuery({ allow: ["kb_manager"] })` wrapper on
 *     `getTenantCampaignLaunch` (ADR 0010 — refuses Forbidden if the layout
 *     regresses; cross-tenant fuzz pinned by
 *     `listTenantCampaignLaunches.test.ts`).
 *
 * Scope discipline (#240): only files under
 * `.../campagnes/historique/[launchId]/`. Zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/` beyond the public-query
 * addition under `lib/notifications/campaigns`.
 */

import { useParams } from "next/navigation";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";

import { LaunchDetailView } from "./launch-detail-view";

export default function CampagneHistoriqueDetailPage() {
  const tenantId = useCurrentTenantId();
  const params = useParams<{ launchId: string }>();
  const launchId = params.launchId as Id<"campaignLaunches">;

  // Tri-state contract threaded to the view:
  //   - `undefined` (Convex sentinel) → loading.
  //   - resolved + found              → the launch summary payload.
  //   - resolved + not found          → `null` (stale link, or the launch
  //     belongs to another tenant — the backend returns null in both cases).
  const launch = useTenantQuery(
    api.lib.notifications.campaigns.getTenantCampaignLaunch,
    { launchId },
  );

  return (
    <LaunchDetailView tenantId={tenantId} launchId={launchId} launch={launch} />
  );
}
