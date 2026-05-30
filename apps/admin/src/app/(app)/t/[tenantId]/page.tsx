"use client";

/**
 * Tenant root — redirects `/t/[tenantId]` → `/t/[tenantId]/menu`.
 *
 * The tenant operational space has FOUR live sub-routes today (`/menu`,
 * `/mes-clients`, `/parametres`, `/qr`) and no canonical "tenant home" yet
 * (the per-resto dashboard is a separate epic in the backlog). Without a
 * page at the bare `/t/[tenantId]` segment, Next.js returns a 404 — which
 * is what the user hit when picking a resto from the supervision switcher
 * (the switcher's `buildSwitchTarget` deliberately drops the supervision
 * path and lands on `/t/<id>` so the actor gets the *default* tenant view
 * rather than carry over a non-applicable URL — `/monitoring` → `/t/<id>`,
 * NOT `/t/<id>/monitoring`).
 *
 * Default landing: `/menu`. Same target as `(app)/page.tsx` picks for a
 * KB Manager (`/t/<firstTenant>/menu`), so the chrome (sidebar active item)
 * and the URL agree regardless of where the user came from.
 *
 * Mounted UNDER the chrome-less `[tenantId]/layout.tsx`, so the tenant
 * gate has already validated access (KB Admin root override, KB Manager
 * owns it, or UnauthorizedCard / notFound). The redirect therefore only
 * runs for authorised actors — no leak across the gate.
 *
 * When a real tenant home page lands, replace the redirect with the actual
 * page content. Contract stays: every navigation to `/t/<id>` resolves to a
 * usable surface, no 404.
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

export default function TenantRootPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId;

  React.useEffect(() => {
    if (!tenantId) return;
    router.replace(`/t/${tenantId}/menu`);
  }, [tenantId, router]);

  // Brief spinner while the effect schedules the navigation. Matches the
  // tenant layout's wait visual so the user never sees a flash of empty
  // content.
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
