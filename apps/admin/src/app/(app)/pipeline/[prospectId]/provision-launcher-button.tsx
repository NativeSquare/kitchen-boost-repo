"use client";

/**
 * F-WIZARD [2/10] (#266) — `ProvisionLauncherButton`.
 *
 * The user-facing entry point of the provisioning wizard (epic F-WIZARD #143).
 * Mounted on the prospect fiche (`prospect-fiche-view.tsx`), it is the SOLE
 * front door into the wizard route exposed by slice [1/10]
 * (`/pipeline/[prospectId]/provision`). Without it, the wizard is unreachable
 * from the supervision surface.
 *
 * Render branches (matches `decideProvisionLauncher`):
 *
 *   - Closing not yet complete                           → renders `null`
 *     (« Bouton visible seulement quand le prospect est en phase Closing »).
 *   - Closing-complete + no tenantId back-link           → « Lancer le wizard
 *                                                          de provisioning ».
 *   - Closing-complete + tenantId back-link set          → « Reprendre le
 *                                                          wizard ».
 *   - Closing-complete + tenant.status === "active"      → « Ouvrir la vue
 *                                                          resto » (replaces
 *                                                          the wizard button).
 *
 * Email warning: when the prospect has no email and the decision is `launch`
 * or `resume`, the warning « L'email du gérant sera demandé au step 1 »
 * surfaces alongside the button (informational, NOT a block — the step 1
 * form of the wizard captures the email).
 *
 * Why plain `<a>` (not `next/link`)?
 * ---------------------------------
 * Mirrors `prospect-fiche-view.tsx` / `unauthorized-card.tsx`: keeping the
 * anchor as a bare `<a>` lets the React-tree serializer used by the vitest
 * suite (lean `node` env, no jsdom, no Next.js router) inspect the `href`
 * directly. The shadcn `Button asChild` Slot still composes the styling; the
 * navigation behaviour is identical for in-app links (Next.js' link
 * prefetching is the only thing forfeited, and the launcher fires once per
 * fiche visit — not a hot path).
 *
 * Scope discipline (#266 hard constraint): this file (and its sibling
 * decision + tests) is the SOLE surface touched by this story alongside
 * `prospect-fiche-view.tsx` / `page.tsx` (where the button is mounted and
 * the tenant prop is plumbed). Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */
import {
  IconArrowRight,
  IconBuildingStore,
  IconRocket,
} from "@tabler/icons-react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";

import {
  decideProvisionLauncher,
  type TenantStatusSlice,
} from "./provision-launcher.decision";

export type ProvisionLauncherButtonProps = {
  prospect: Doc<"prospects">;
  /**
   * The tenant projection when `prospect.tenantId` is set (Convex tri-state).
   * F-PIPELINE-CRM 09 (#264) — narrowed to a structural minimum
   * (`TenantStatusSlice = { status }`): the live
   * `api.lib.admin.tenants.getTenant` returns a minimal projection (no Stripe
   * ids / SIRET leak), and the launcher only reads `status`. Pre-264 callers
   * passed `undefined` (stub); the `view-tenant` branch fires once the tenant
   * projection is hydrated AND reports `status === "active"`.
   */
  tenant: TenantStatusSlice | null | undefined;
};

/**
 * Verbatim copy from the issue spec (#266 AC6). Centralised here so a
 * future copy change (« step 1 » → « étape 1 », French normalisation, …)
 * happens in one place — the test asserts the substring.
 */
const MISSING_EMAIL_COPY = "L'email du gérant sera demandé au step 1";

export function ProvisionLauncherButton({
  prospect,
  tenant,
}: ProvisionLauncherButtonProps) {
  const decision = decideProvisionLauncher({ prospect, tenant });

  if (decision.kind === "hidden") {
    return null;
  }

  if (decision.kind === "view-tenant") {
    return (
      <Button asChild>
        <a href={decision.href}>
          <IconBuildingStore />
          Ouvrir la vue resto
          <IconArrowRight />
        </a>
      </Button>
    );
  }

  // `launch` or `resume` — same shape (button + optional warning), only
  // the label changes.
  const label =
    decision.kind === "launch"
      ? "Lancer le wizard de provisioning"
      : "Reprendre le wizard";

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <Button asChild>
        <a href={decision.href}>
          <IconRocket />
          {label}
          <IconArrowRight />
        </a>
      </Button>
      {decision.warning === "missing-manager-email" ? (
        <p className="text-muted-foreground text-xs">{MISSING_EMAIL_COPY}</p>
      ) : null}
    </div>
  );
}
