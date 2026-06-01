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
 * Falls back to the bootstrap sub-domain `<slug>.kitchen-boost.fr` via the
 * existing `tenantPwaUrl` helper.
 *
 * The standalone wizard step 6 (`step6-qr-form.tsx`) still mounts the legacy
 * `QrGeneratorView` (PDF pipeline) — that path is unaffected. This page no
 * longer depends on `QrGeneratorView`.
 */

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import QRCode from "qrcode";
import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";
import { useSession } from "@/lib/session";
import { tenantPwaUrl } from "@/lib/tenant-url";

/**
 * Build the SVG QR code for the given URL. Black on white, zero margin (the
 * design tool will add the bleed). `qrcode`'s `toString({type:'svg'})`
 * returns a standalone `<svg>` document we can drop straight into the DOM
 * or into a `data:image/svg+xml` href.
 */
async function buildQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 0,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

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

  // Compute the encoded URL only when we have a stable slug. We pre-compute
  // it (rather than guarding inside the effect) so the JSX preview can show
  // it under the QR as plain text.
  const pwaUrl = slug !== null ? tenantPwaUrl({ slug, customDomain }) : null;

  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    // While `pwaUrl` is null (session still resolving) we skip the build
    // entirely — the page early-returns below for the null branch, so a
    // stale `svg` value is never rendered. Avoids a synchronous setState
    // inside the effect body (react-hooks/set-state-in-effect).
    if (pwaUrl === null) return;
    let cancelled = false;
    buildQrSvg(pwaUrl)
      .then((next) => {
        if (!cancelled) setSvg(next);
      })
      .catch(() => {
        // Silent : the disabled-button branch already covers the "no svg"
        // UX, and the only realistic failure here is a malformed input URL
        // (which we control via `tenantPwaUrl`).
      });
    return () => {
      cancelled = true;
    };
  }, [pwaUrl]);

  // Loading sentinels — keep the page mute until we have all inputs.
  if (session.status !== "ready") return null;
  if (isAdmin && adminTenantDoc === undefined) return null;
  if (!isAdmin && settings === undefined) return null;
  if (slug === null || pwaUrl === null) return null;

  const fileName = `qr-${slug}.svg`;
  const downloadHref =
    svg !== null ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-2 px-4 lg:px-6">
        <h1 className="text-2xl font-bold">QR code</h1>
        <p className="text-muted-foreground text-sm">
          Importez ce SVG dans Canva, Figma ou Illustrator pour l&apos;intégrer
          dans votre support visuel (sticker, affiche, packaging&hellip;).
        </p>
      </div>
      <div className="flex flex-col items-center gap-4 px-4 lg:px-6">
        <div
          data-slot="qr-preview"
          className="border-input bg-white flex h-[340px] w-[340px] items-center justify-center overflow-hidden rounded-md border p-4"
        >
          {svg !== null ? (
            // `qrcode` returns a fully self-contained <svg> document — safe
            // to inline (no script, no external refs). We render it via
            // dangerouslySetInnerHTML because constructing a React tree
            // from the SVG string would lose nothing and gain nothing.
            <div
              className="h-full w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <span className="text-muted-foreground text-sm">
              Génération du QR code&hellip;
            </span>
          )}
        </div>
        <code
          data-slot="qr-url"
          className="text-muted-foreground bg-muted/40 max-w-full break-all rounded px-2 py-1 text-xs"
        >
          {pwaUrl}
        </code>
        {downloadHref !== null ? (
          <a
            href={downloadHref}
            download={fileName}
            data-slot="qr-download"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-xs outline-none focus-visible:ring-[3px]"
          >
            Télécharger SVG
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="bg-primary/60 text-primary-foreground inline-flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium opacity-60 shadow-xs"
          >
            Télécharger SVG
          </button>
        )}
      </div>
    </div>
  );
}
