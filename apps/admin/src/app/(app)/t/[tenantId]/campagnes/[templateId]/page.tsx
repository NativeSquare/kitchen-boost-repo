"use client";

/**
 * F-CAMPAGNES [3/7] (#205) — Route `/t/[tenantId]/campagnes/[templateId]`.
 *
 * The page is the thin wiring layer between:
 *   - the Convex tenant-scoped query (`listTenantTemplates`, reused from
 *     the picker — no NEW backend query, per the issue body « re-utilise
 *     `listTenantTemplates` ou query unitaire si exposée »),
 *   - the URL segment (`templateId` resolved via `useParams`),
 *   - the pure presentational `TemplateView` (loading / not-found /
 *     loaded branches owned by the view).
 *
 * Why we re-query the FULL list rather than a single-template query:
 *   - The picker already lives on the tenant cache and most users navigate
 *     here from a card click. Calling `listTenantTemplates` again hits
 *     Convex's reactive cache (zero network round-trip in 99 % of cases).
 *   - It avoids adding a NEW backend query for this slice — keeping the
 *     scope STRICT (#205 hard constraint: « JAMAIS dans `packages/backend`
 *     »).
 *   - Single-template resolution = `Array.find` on a small list (the V1
 *     library has ~5-10 entries).
 *
 * Access guard (cross-tenant): inherited transitively from
 *   - the parent `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04) for the
 *     tenant context,
 *   - the backend `tenantQuery({ allow: ["kb_manager"] })` wrapper on
 *     `listTenantTemplates` (ADR 0010 — refuses Forbidden if the layout
 *     regresses; cross-tenant fuzz already pinned by
 *     `listTenantTemplates.test.ts`).
 *
 * Scope discipline (#205): only this file under
 * `.../campagnes/[templateId]/`. Zero touch to `apps/web`, `apps/native`,
 * or `packages/backend/convex/`.
 */

import { useParams } from "next/navigation";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantMutation, useTenantQuery } from "@/hooks";

import { TemplateView } from "./template-view";

export default function CampagneTemplatePage() {
  const tenantId = useCurrentTenantId();
  const params = useParams<{ templateId: string }>();
  const templateId = params.templateId as Id<"notificationTemplates">;

  // Re-use the picker query (slice [1/7]). Convex de-dupes identical
  // tenant queries across the cache, so this is a free read once the
  // picker has been visited; first-load still pays one query.
  const templates = useTenantQuery(
    api.lib.notifications.campaigns.listTenantTemplates,
  );

  // F-CAMPAGNES [5/7] (#228) — `sendTenantCampaign` mutation, threaded
  // down through the view to `VariablesForm` as the `onSend` seam. The
  // tenant-scoped wrapper auto-injects `tenantId` (ADR 0014 §4 / #183);
  // the form forwards `{templateId, variables}` only. The backend wrapper
  // (`tenantMutation({ allow: ["kb_manager"] })`) enforces the role +
  // cross-tenant isolation (ADR 0010) — a `staff` actor or a foreign
  // `tenantId` surface as Forbidden / NOT_FOUND, both of which fall on
  // the generic error branch of `classifySendError`.
  const sendCampaign = useTenantMutation(
    api.lib.notifications.campaigns.sendTenantCampaign,
  );

  // Tri-state contract threaded to the view:
  //   - `undefined` (Convex sentinel) → loading.
  //   - resolved + found              → the template payload.
  //   - resolved + not found          → `null` (the picker is stale or the
  //     template was deactivated server-side; the view surfaces a
  //     « Template introuvable » with a back link).
  const template =
    templates === undefined
      ? undefined
      : (templates.find((t) => t.id === templateId) ?? null);

  return (
    <TemplateView
      tenantId={tenantId}
      templateId={templateId}
      template={template}
      onSend={sendCampaign}
    />
  );
}
