"use client";

/**
 * `/t/[tenantId]/qr` — minimal SVG-only export.
 *
 * Product decision (2026-06-01) : KB does NOT own the design surface for the
 * QR sticker / poster. The restaurateur integrates the QR into their own
 * visuel via Canva / Figma / Illustrator. We therefore ship the QR itself
 * and nothing else :
 *
 *   - one single export format: SVG (vector, opens natively in every design
 *     tool, infinite zoom, no resolution issues);
 *   - black on white only (max contrast = max scan reliability — a pastel
 *     brand colour can kill the QR);
 *   - no surrounding chrome (no title overlay, no accroche, no logo, no
 *     format variants A4 / A6 / sticker rond, no PDF pipeline);
 *   - filename `qr-<slug>.svg`.
 *
 * The page reads `customDomain` via the manager-accessible
 * `api.lib.admin.tenantSettings.getSettings` (added 2026-06-01 for
 * B-PARAMETRES-04) so the encoded URL respects the configured custom domain.
 * Falls back to the bootstrap sub-domain `<slug>.kitchen-boost.com` via the
 * existing `tenantPwaUrl` helper.
 *
 * The preview + download UI is delegated to the shared
 * `<QrDownloadCard slug pwaUrl />` component, which is ALSO mounted by the
 * wizard step 6 (`step6-qr-form.tsx`, simplification 2026-06-02). Keeping the
 * UI in one component guarantees the two surfaces stay visually identical.
 */

import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

import { QrDownloadCard } from "@/components/qr/QrDownloadCard";
import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";
import { useSession } from "@/lib/session";
import { tenantPwaUrl } from "@/lib/tenant-url";

export default function QrPage() {
  const tenantId = useCurrentTenantId();
  const session = useSession();

  const sessionTenant =
    session.status === "ready"
      ? (session.session.tenants.find((t) => t.tenantId === tenantId) ?? null)
      : null;

  const isAdmin =
    session.status === "ready" && session.session.isAdmin === true;

  // KB Admin path : reuse the existing root-only primitive (same one the
  // F-SHELL-04 layout uses for tenant existence probe — incidental Stripe
  // naming, returns the full `Doc<"tenants">`).
  const adminTenantDoc = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    isAdmin ? { tenantId } : "skip",
  );

  // KB Manager path : read customDomain via the manager-accessible query
  // (the session payload doesn't carry customDomain).
  const settings = useTenantQuery(
    api.lib.admin.tenantSettings.getSettings,
    isAdmin ? "skip" : {},
  );

  const slug = adminTenantDoc?.slug ?? sessionTenant?.slug ?? null;
  const customDomain: string | undefined =
    adminTenantDoc?.customDomain ?? settings?.customDomain ?? undefined;

  // Compute the encoded URL only when we have a stable slug.
  const pwaUrl = slug !== null ? tenantPwaUrl({ slug, customDomain }) : null;

  // Loading sentinels — keep the page mute until we have all inputs.
  if (session.status !== "ready") return null;
  if (isAdmin && adminTenantDoc === undefined) return null;
  if (!isAdmin && settings === undefined) return null;
  if (slug === null || pwaUrl === null) return null;

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-2 px-4 lg:px-6">
        <h1 className="text-2xl font-bold">QR code</h1>
        <p className="text-muted-foreground text-sm">
          Importez ce SVG dans Canva, Figma ou Illustrator pour l&apos;intégrer
          dans votre support visuel (sticker, affiche, packaging&hellip;).
        </p>
      </div>
      <div className="px-4 lg:px-6">
        <QrDownloadCard pwaUrl={pwaUrl} slug={slug} />
      </div>
    </div>
  );
}
