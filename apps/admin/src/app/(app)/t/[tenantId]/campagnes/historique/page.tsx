"use client";

/**
 * F-CAMPAGNES [6/7] (#240) — Route
 * `/t/[tenantId]/campagnes/historique/`.
 *
 * Thin wiring layer between the Convex tenant-scoped query
 * (`listTenantCampaignLaunches`, public addition of this slice) and the pure
 * presentational `CampaignHistoryList`. Same shape as the slice-1 `campagnes/`
 * page (#179 pattern).
 *
 * Access guard (cross-tenant): inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175). The backend wrapper
 * (`tenantQuery({ allow: ["kb_manager"] })` on `listTenantCampaignLaunches`)
 * is the hard isolation barrier (ADR 0010 — refuses Forbidden even if the
 * layout regresses; cross-tenant fuzz shipped by
 * `listTenantCampaignLaunches.test.ts`).
 *
 * Scope discipline (#240): only files under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/historique/`. Zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/` beyond the public
 * query addition under `lib/notifications/campaigns`.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";

import { CampaignHistoryList } from "./_components/CampaignHistoryList";

export default function CampagneHistoriquePage() {
  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by the
  // chrome-less `/t/[tenantId]` layout) and injects it into args (ADR 0014 §4
  // / #183). `undefined` is the loading sentinel; a successful read returns
  // `CampaignLaunchSummary[]` (possibly empty).
  const launches = useTenantQuery(
    api.lib.notifications.campaigns.listTenantCampaignLaunches,
  );
  // Same tenantId as the one injected into the query — `useTenantQuery` reads
  // it from the same context. We re-read it here ONLY to forward it into the
  // list so per-row hrefs can be built without re-running the hook deep inside
  // the view (parity with the slice-1/2 campagnes page).
  const tenantId = useCurrentTenantId();

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Historique des campagnes</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Les lancements passés et leurs compteurs agrégés. Aucune liste de
          destinataires nominative — uniquement les counts serveur (MOAT).
        </p>
      </div>
      <div className="px-4 lg:px-6">
        <CampaignHistoryList tenantId={tenantId} launches={launches} />
      </div>
    </div>
  );
}
