/**
 * F-CAMPAGNES [2/7] (#188) — `TemplateCard`, the per-template shadcn card of
 * the campaigns picker (parent EPIC #145, PRD 80 §4 + ADR 0006).
 *
 * Surfaces (issue body verbatim):
 *   - **nom du template** (label) — the user-visible anchor.
 *   - **canal porté** (badges Push + E-mail) — the V1 tenant marketing
 *     cascade is `Web Push > Wallet > Email` (`marketingCascade.ts:
 *     TENANT_CASCADE`). All tenant templates go through the SAME cascade,
 *     so the card surfaces both labels — "Push" (covers web+wallet push)
 *     and "E-mail" (deterministic fallback). KB accent palette: Push uses
 *     vert foncé `#1B7A3D`, E-mail uses jaune/or `#E5A100` (CLAUDE.md DA).
 *   - **aperçu court** du body — first ~80 chars + ellipsis. The picker is
 *     a recognition surface, not a reading surface (the dedicated template
 *     route, slice 3, owns the full preview + variable form).
 *
 * Active vs inactive — issue body: « Indicateur visuel pour l'état
 * `active=false` (carte grisée, disabled) ». The backend's current
 * `listTenantTemplates` projection drops the `active` flag (it filters to
 * `active===true` already, so all received cards are active). The
 * COMPONENT still accepts `active` (defaulting to `true`) so:
 *   - it cleanly supports a future projection that re-exposes the flag
 *     without any backend coupling change (we'd just pass it through);
 *   - the inactive rendering — disabled (no anchor, no click) + visible
 *     « Inactif » marker + greyed look — is contract-pinned today.
 *
 * Navigation (active only) — issue body: « Clic = navigation vers
 * `/t/[tenantId]/campagnes/[templateId]` ». We use `next/link` (declarative
 * `<a>`, prefetchable, no `useRouter` ceremony, trivially pin-able from a
 * node-env test that walks the React tree). The route itself is created in
 * slice 3 (#192 — F-CAMPAGNES [3/7]); per the issue body, this slice
 * « peut renvoyer 404 à ce stade ».
 *
 * Scope (#188 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/_components/`. Zero touch
 * to `apps/web`, `apps/native`, or `packages/backend/convex/`. No new
 * primitive — only the already-scaffolded shadcn `Card` + `Badge`.
 *
 * MOAT / isolation: this is a pure presentational card. NO recipient
 * identity, NO query, NO mutation — isolation is owned by the
 * `listTenantTemplates` `tenantQuery({ allow: ["kb_manager"] })` wrapper
 * upstream (cross-tenant fuzz already pinned by
 * `packages/backend/convex/lib/notifications/campaigns.test.ts`).
 */

import Link from "next/link";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Length of the body preview, in chars. Chosen so a 3-column grid stays
 *  visually balanced on a medium viewport while still showing enough of
 *  the message for the gérant to recognise it. */
const PREVIEW_MAX_CHARS = 80;

/** Truncate the body for the at-a-glance preview. Adds a single ellipsis
 *  (`…`, U+2026) when the body is longer than the threshold; never mutates
 *  the original `body` (only used for display). */
function previewOf(body: string): string {
  if (body.length <= PREVIEW_MAX_CHARS) return body;
  return `${body.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…`;
}

export type TemplateCardProps = {
  /** Current tenant — built into the per-card `<a href>` so navigation
   *  stays on the right `/t/[tenantId]/...` route. The page (which has the
   *  tenantId via `useCurrentTenantId`) forwards it through the
   *  `TemplatePicker`. */
  tenantId: Id<"tenants">;
  /** The pre-validated template (backend projection from
   *  `listTenantTemplates`). */
  template: TenantTemplateSummary;
  /** Active state — issue body: « état actif/inactif visible ».
   *  Defaults to `true` because the current backend projection only
   *  returns active templates; the prop exists so a future projection
   *  re-exposing the flag plugs in without any component change. An
   *  inactive card is NOT clickable and surfaces a visible « Inactif »
   *  marker. */
  active?: boolean;
};

export function TemplateCard({
  tenantId,
  template,
  active = true,
}: TemplateCardProps) {
  const preview = previewOf(template.body);
  const href = `/t/${tenantId}/campagnes/${template.id}`;

  const body = (
    <Card
      data-slot="template-card"
      className={cn(
        "h-full transition-shadow",
        active
          ? "hover:border-[#1B7A3D] hover:shadow-md"
          : "opacity-60 grayscale",
      )}
      aria-disabled={active ? undefined : true}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="truncate">{template.label}</span>
          {active ? null : (
            <Badge
              variant="secondary"
              data-slot="template-card-inactive-badge"
              className="shrink-0"
            >
              Inactif
            </Badge>
          )}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            data-slot="template-card-channel-push"
            className="bg-[#1B7A3D] text-white hover:bg-[#1B7A3D]"
          >
            Push
          </Badge>
          <Badge
            data-slot="template-card-channel-email"
            className="bg-[#E5A100] text-black hover:bg-[#E5A100]"
          >
            E-mail
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground line-clamp-3 text-sm">{preview}</p>
      </CardContent>
    </Card>
  );

  if (!active) {
    // Disabled state — issue body: « carte grisée, disabled ». No anchor,
    // no click target. The body itself stays rendered so the gérant sees
    // WHY they can't click (the « Inactif » badge + greyed visual).
    return <div data-slot="template-card-disabled">{body}</div>;
  }

  return (
    <Link
      href={href}
      data-slot="template-card-link"
      className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#1B7A3D]"
      aria-label={`Ouvrir le template ${template.label}`}
    >
      {body}
    </Link>
  );
}
