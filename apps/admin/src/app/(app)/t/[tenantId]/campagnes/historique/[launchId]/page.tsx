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
 * Shape guard (URL safety): the `[launchId]` segment is user-controlled (URL
 * editing, stale share links, v0 bookmark formats…). If it does NOT have the
 * shape of a Convex doc id we MUST NOT forward it to `useTenantQuery` — the
 * `v.id("campaignLaunches")` validator throws `ArgumentValidationError` and
 * crashes the React tree. Instead we pass `"skip"` to the hook and feed the
 * view `launch={null}`, which renders the SAME "Lancement introuvable" branch
 * we already show for a valid-but-stale launchId (cross-tenant case pinned by
 * MC18 step 2). See `lib/convex/is-likely-convex-id.ts`.
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
import { isLikelyConvexId } from "@/lib/convex/is-likely-convex-id";

import { LaunchDetailView } from "./launch-detail-view";

export default function CampagneHistoriqueDetailPage() {
  const tenantId = useCurrentTenantId();
  const params = useParams<{ launchId: string }>();
  const rawLaunchId = params.launchId;

  // URL-safety guard (see file header). When the segment doesn't look like a
  // Convex doc id we skip the query entirely — the cast below would feed an
  // invalid string straight into `v.id("campaignLaunches")` and throw at the
  // call site otherwise.
  const launchIdLooksValid = isLikelyConvexId(rawLaunchId);
  const launchId = rawLaunchId as Id<"campaignLaunches">;

  // Tri-state contract threaded to the view:
  //   - `undefined` (Convex sentinel) → loading.
  //   - resolved + found              → the launch summary payload.
  //   - resolved + not found          → `null` (stale link, or the launch
  //     belongs to another tenant — the backend returns null in both cases;
  //     a syntactically invalid id short-circuits to `null` here too, so the
  //     UI is identical across all three "not found" causes).
  const launchFromQuery = useTenantQuery(
    api.lib.notifications.campaigns.getTenantCampaignLaunch,
    launchIdLooksValid ? { launchId } : "skip",
  );
  const launch = launchIdLooksValid ? launchFromQuery : null;

  return (
    <LaunchDetailView tenantId={tenantId} launchId={launchId} launch={launch} />
  );
}
