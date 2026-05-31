/**
 * F-CAMPAGNES [3/7] (#205) — `TemplateView`, the pure presentational shell
 * of the per-template campaign route (parent EPIC #145, ADR 0006 / PRD 80
 * §4).
 *
 * Owns three branches keyed on the resolved template payload:
 *   - `template === undefined` → loading skeleton (Convex's loading
 *     sentinel + the upstream `Array.find` not yet resolved). FR copy
 *     bound to the shadcn `<Skeleton/>` primitive.
 *   - `template === null`      → resolved-not-found (the templateId in the
 *     URL no longer matches any active template for this tenant). FR
 *     « Template introuvable » + a back link to the picker so the gérant
 *     isn't stuck.
 *   - else                     → loaded — page title + `<VariablesForm/>`.
 *
 * Same testability split as `CampagnesView` ↔ `page.tsx`: the view is a
 * pure function callable from the node-env unit test
 * (`template-view.test.tsx`), the page (`page.tsx`) handles the Convex
 * hook + URL segment + resolution lookup, then threads the payload here.
 *
 * Scope (#205 hard constraint): only this folder under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/[templateId]/`. Zero
 * touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import Link from "next/link";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Skeleton } from "@/components/ui/skeleton";

import { VariablesForm } from "./_components/VariablesForm";

export type TemplateViewProps = {
  /** Current tenant — forwarded into `VariablesForm` (parity with the
   *  picker's per-card hrefs) AND used by the not-found branch to build
   *  the « Retour aux campagnes » link back to the picker. */
  tenantId: Id<"tenants">;
  /** TemplateId from the URL segment — surfaced on the not-found branch
   *  so the gérant sees WHICH id is missing (helpful when sharing a
   *  stale URL with KB support). */
  templateId: Id<"notificationTemplates">;
  /**
   * Resolved template payload:
   *   - `undefined` → still loading (Convex `useQuery` sentinel + lookup
   *     not yet resolved).
   *   - `null`      → resolved, templateId not found in the tenant's
   *     active library — the gérant clicked a stale link or the template
   *     was deactivated after the picker render.
   *   - `TenantTemplateSummary` → loaded.
   */
  template: TenantTemplateSummary | null | undefined;
};

export function TemplateView({
  tenantId,
  templateId,
  template,
}: TemplateViewProps) {
  if (template === undefined) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <Skeleton className="h-8 w-1/2" />
        </div>
        <div className="px-4 lg:px-6">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (template === null) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Template introuvable</h1>
        </div>
        <div className="px-4 lg:px-6">
          <p className="text-muted-foreground text-sm">
            Le template <code className="font-mono text-xs">{templateId}</code>{" "}
            n&apos;est plus disponible pour ce restaurant. Il a peut-être été
            désactivé. Reviens à la liste des campagnes ou contacte le support
            KitchenBoost.
          </p>
          <div className="mt-4">
            <Link
              href={`/t/${tenantId}/campagnes`}
              className="text-sm font-medium text-[#1B7A3D] underline-offset-4 hover:underline"
            >
              Retour aux campagnes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <div className="flex flex-col gap-1">
          <Link
            href={`/t/${tenantId}/campagnes`}
            className="text-muted-foreground text-xs hover:underline"
          >
            ← Campagnes
          </Link>
          <h1 className="text-2xl font-bold">{template.label}</h1>
          <p className="text-muted-foreground text-sm">{template.body}</p>
        </div>
      </div>
      <div className="px-4 lg:px-6">
        <VariablesForm tenantId={tenantId} template={template} />
      </div>
    </div>
  );
}
