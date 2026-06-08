"use client";

/**
 * `QrDownloadCard` — shared SVG-only QR export surface used by:
 *
 *   - the standalone Manager page `/t/[tenantId]/qr` (#198, simplified
 *     2026-06-01) — KB Manager grabs the QR on demand;
 *   - the wizard step 6 `step6-qr-form.tsx` (#272, simplified 2026-06-02) —
 *     KB Admin grabs the QR during onboarding.
 *
 * Product decision (2026-06-01, extended to the wizard 2026-06-02) : KB does
 * NOT own the design surface for the QR sticker / poster. The restaurateur
 * integrates the QR into their own visuel via Canva / Figma / Illustrator. We
 * therefore ship the QR itself and nothing else :
 *
 *   - one single export format: SVG (vector, opens natively in every design
 *     tool, infinite zoom, no resolution issues);
 *   - black on white only (max contrast = max scan reliability — a pastel
 *     brand colour can kill the QR);
 *   - no surrounding chrome (no title overlay, no accroche, no logo, no
 *     format variants A4 / A6 / sticker rond, no PDF pipeline);
 *   - filename `qr-<slug>.svg`.
 *
 * Why a shared component (and not a copy-paste in each surface) : the two
 * surfaces (page + wizard step) MUST stay visually identical — if a future
 * tweak changes the preview size, the label, or the data-url encoding, it
 * applies to both at once. Same discipline as the rest of the menu / pipeline
 * editors that share leaf components between the standalone page and the
 * wizard step (Step4BrandingForm → branding-editor, Step5MenuForm → menu
 * editors, etc.).
 *
 * The card OWNS the async SVG build (`qrcode` lib) and its lifecycle (cancel
 * on unmount, regenerate on `pwaUrl` change). The caller passes the
 * already-resolved `pwaUrl` + `slug` ; the URL recomposition (via
 * `tenantPwaUrl({ slug, customDomain })`) stays at the call site so each
 * surface controls its own seed source (kbAdminQuery in the wizard, session
 * + manager-accessible query on the standalone page).
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export type QrDownloadCardProps = {
  /** PWA URL the QR encodes (e.g. `https://lartisan.kitchen-boost.com`). */
  pwaUrl: string;
  /**
   * Tenant slug, used to build the download filename `qr-<slug>.svg`. Kept
   * explicit (rather than derived from `pwaUrl`) so a custom-domain tenant
   * still gets a stable, slug-keyed filename.
   */
  slug: string;
};

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

export function QrDownloadCard({ pwaUrl, slug }: QrDownloadCardProps) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildQrSvg(pwaUrl)
      .then((next) => {
        if (!cancelled) setSvg(next);
      })
      .catch(() => {
        // Silent : the disabled-button branch already covers the "no svg"
        // UX, and the only realistic failure here is a malformed input URL
        // (which the caller controls via `tenantPwaUrl`).
      });
    return () => {
      cancelled = true;
    };
  }, [pwaUrl]);

  const fileName = `qr-${slug}.svg`;
  const downloadHref =
    svg !== null ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;

  return (
    <div className="flex flex-col items-center gap-4">
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
          data-slot="qr-download"
          className="bg-primary/60 text-primary-foreground inline-flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium opacity-60 shadow-xs"
        >
          Télécharger SVG
        </button>
      )}
    </div>
  );
}
