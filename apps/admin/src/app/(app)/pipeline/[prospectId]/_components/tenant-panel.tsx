"use client";

/**
 * F-PIPELINE-CRM 09 (#264) — `TenantPanel`.
 *
 * Pure presentational panel surfaced on the supervision fiche
 * (`/pipeline/[prospectId]`) ONLY when `prospect.tenantId` is set (back-link
 * posted by the provisioning wizard). Mirrors the issue spec's matrix:
 *
 *   - no `prospect.tenantId`                          → NOT rendered at all
 *                                                       (no placeholder, no
 *                                                       layout shift).
 *   - `tenantId` present + tenant `undefined`         → skeleton (Convex
 *                                                       in-flight).
 *   - `tenantId` present + tenant `null`              → « Tenant introuvable
 *                                                       (id: …) » degraded
 *                                                       UX + `console.warn`
 *                                                       (cas dégradé).
 *   - `tenantId` present + tenant hydrated            → slug + nom + statut
 *                                                       (badge) + bouton
 *                                                       « Ouvrir la vue resto »
 *                                                       (href `/t/<id>`).
 *
 * Why plain `<a>` (not `next/link`)?
 * ---------------------------------
 * Same rationale as `provision-launcher-button.tsx` / `prospect-fiche-view.tsx`:
 * the lean `node` vitest env (no jsdom, no Next.js router) inspects the `href`
 * directly through the React-tree serializer. The button keeps the shadcn
 * `Button asChild` styling; navigation behaviour is identical for in-app
 * links (only prefetching is forfeited, and this is a one-shot navigation).
 *
 * Scope discipline (#264 hard constraint): the React file lives under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/_components/` only. The
 * backend `getTenant` kbAdminQuery (`lib/admin/tenants.ts`) is the minimal
 * companion extension wired in `page.tsx`. Zero touch to `apps/web` or
 * `apps/native`.
 */
import { IconArrowRight, IconBuildingStore } from "@tabler/icons-react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * The shape returned by `api.lib.admin.tenants.getTenant` — kept narrow to
 * mirror the backend projection (no Stripe ids, no SIRET). Importing this
 * type from the backend would couple the React tree to Convex's generated
 * API; the projection is small enough to mirror by hand here.
 */
export type TenantPanelTenant = {
  _id: Id<"tenants">;
  slug: string;
  name: string;
  status: "active" | "pending" | "suspended" | "disabled";
};

export type TenantPanelProps = {
  prospect: Doc<"prospects">;
  /**
   * Convex tri-state for the tenant query result:
   *  - `undefined` → in-flight (or back-link absent and query skipped — same
   *    shape, same surface — but in that case the panel is not rendered at
   *    all because `prospect.tenantId` is undefined).
   *  - `null`      → resolved-but-no-row (degraded UX).
   *  - hydrated    → render.
   */
  tenant: TenantPanelTenant | null | undefined;
};

/**
 * Human-readable French labels for the `tenants.status` enum, mirroring the
 * canonical lifecycle (`convex/table/tenants.ts` `tenantStatus`). Co-located
 * because no other surface needs to render a tenant lifecycle badge today.
 */
const STATUS_LABEL: Record<TenantPanelTenant["status"], string> = {
  active: "Actif",
  pending: "En attente",
  suspended: "Suspendu",
  disabled: "Désactivé",
};

const STATUS_VARIANT: Record<
  TenantPanelTenant["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  active: "default",
  pending: "secondary",
  suspended: "outline",
  disabled: "destructive",
};

function buildTenantOperationalHref(tenantId: Id<"tenants">): string {
  // Mirrors `provision-launcher.decision.ts` `buildTenantOperationalHref` +
  // `tenant-switcher.tsx`. The bare `/t/<id>` segment redirects to the
  // tenant's default sub-route (`/menu` today).
  return `/t/${tenantId as unknown as string}`;
}

export function TenantPanel({ prospect, tenant }: TenantPanelProps) {
  const tenantId = prospect.tenantId;
  // Guard #1 — issue AC: « Panneau Tenant rendu uniquement quand
  // `prospect.tenantId` est défini ». Return null = no layout shift, no
  // empty placeholder.
  if (tenantId === undefined) return null;

  // Guard #2 — in-flight. The Convex `useQuery` tri-state returns `undefined`
  // until the row is hydrated; render a small skeleton to reserve the panel
  // shape.
  if (tenant === undefined) {
    return (
      <Card data-slot="tenant-panel-skeleton">
        <CardHeader>
          <CardTitle>Tenant</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          <span>Chargement du tenant…</span>
        </CardContent>
      </Card>
    );
  }

  // Guard #3 — degraded UX: the back-link points at a row that no longer
  // exists. The issue spec asks for a `console.warn` so operators see the
  // anomaly when DevTools is open; the UI surface stays calm.
  if (tenant === null) {
    // eslint-disable-next-line no-console -- intentional ops trace per issue spec
    console.warn(
      `[TenantPanel] tenant introuvable pour prospect ${prospect._id as unknown as string} (tenantId: ${tenantId as unknown as string})`,
    );
    return (
      <Card data-slot="tenant-panel-not-found">
        <CardHeader>
          <CardTitle>Tenant</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Tenant introuvable (id: {tenantId as unknown as string}).
        </CardContent>
      </Card>
    );
  }

  // Happy path — hydrated tenant. Surface slug + name + status badge + the
  // « Ouvrir la vue resto » CTA (impersonation V1 = navigation, ADR 0014 §6).
  return (
    <Card data-slot="tenant-panel-content">
      <CardHeader>
        <CardTitle>Tenant</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{tenant.name}</span>
            <Badge variant={STATUS_VARIANT[tenant.status]}>
              {STATUS_LABEL[tenant.status]}
            </Badge>
          </div>
          <span
            className="text-xs text-muted-foreground"
            data-slot="tenant-panel-slug"
          >
            {tenant.slug}
          </span>
        </div>
        <Button asChild>
          <a
            data-slot="tenant-panel-open-link"
            href={buildTenantOperationalHref(tenant._id)}
          >
            <IconBuildingStore />
            Ouvrir la vue resto
            <IconArrowRight />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
