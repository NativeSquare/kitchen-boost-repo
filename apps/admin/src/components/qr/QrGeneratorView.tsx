/**
 * F-QR.3 (#182) — `QrGeneratorView` : the consumer-facing orchestrator of the
 * F-QR chain. Wires `generateQrDataUrl` (#167) and `buildQrPdfBlob` (#173,
 * post-jspdf migration) into a usable surface: format selector, PDF preview,
 * download button, regenerate button.
 *
 * Consumed by
 * -----------
 * - the standalone page `/t/[tenantId]/qr` (#198) — KB Manager grabs the
 *   printable PDF on demand;
 * - **and** the step 6 of the F-WIZARD onboarding flow (PRD 70 §3.6 + §4.7) —
 *   same UI, same module, no duplication.
 *
 * Architecture choices
 * --------------------
 * 1. **100 % front.** Zero backend round-trip — the caller passes the already-
 *    known `pwaUrl` (resolved upstream via `tenantPwaUrl()`). PRD 70 §4.7.
 * 2. **`jspdf` (no React reconciler embedded)**. The original tracer-bullet
 *    used `@react-pdf/renderer`, whose embedded reconciler shipped pre-bundled
 *    against an older React and started crashing under React 19.2+ with
 *    `su is not a function` (upstream issue diegomura/react-pdf#3223, open
 *    since Oct 2024). `jspdf` is imperative, React-agnostic, ~150 KB, and
 *    plays no game with React internals. The migration kept the public
 *    `QrGeneratorViewProps` contract unchanged.
 * 3. **Blob → object URL** is the only browser interface we use:
 *    - preview = `<iframe src={blobUrl} />`
 *    - download = `<a href={blobUrl} download={fileName} />`
 *    Both are stable, work in every modern browser, and don't depend on any
 *    framework's lazy loading. The blob URL is revoked when the next blob
 *    supersedes it (and on unmount) to avoid leaking object refs.
 * 4. **Three formats only V1** — `sticker-50mm`, `a6-card`, `a4-poster`.
 *    Default `sticker-50mm` (the primary terrain artefact).
 * 5. **Pure controls split out** in `QrGeneratorControls` so the format
 *    selector + Regenerate button are testable under the lean
 *    `environment: "node"` vitest config without jsdom or RTL.
 *
 * Behaviour
 * ---------
 * - On mount and whenever `pwaUrl` / `format` / branding props change, the
 *   component regenerates the QR data URL (async), then rebuilds the PDF
 *   blob (sync), then refreshes the object URL the preview/download consume.
 * - "Régénérer" forces a refresh (useful if `pwaUrl` changed in place — e.g.
 *   after a `customDomain` swap from Paramètres — without remounting). It
 *   bumps an internal `regenKey` counter wired into the effect deps.
 * - While the QR is being computed, the preview shows a lean inline
 *   placeholder rather than mounting a stale blob.
 *
 * Out of scope (V1)
 * -----------------
 * - Custom number of stickers per A4 sheet (locked to 12).
 * - Custom accroche text — locked to `Scannez pour commander direct chez
 *   <restoName>` in #173.
 * - Server-side rendering of the PDF — explicitly rejected in parent epic
 *   (#142).
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { generateQrDataUrl } from "@/lib/qr-data-url";
import { cn } from "@/lib/utils";

import type { QrPdfBuildOptions, QrPdfFormat } from "./QrPdfDocument";
import { buildQrPdfBlob } from "./QrPdfDocument";

// ---------------------------------------------------------------------------
// Public props (frozen by the issue body — DO NOT widen without product input)
// ---------------------------------------------------------------------------

/**
 * Public contract of `QrGeneratorView`. Matches the shape declared in issue
 * #182 verbatim — used by the standalone page AND by the F-WIZARD step 6.
 */
export type QrGeneratorViewProps = {
  /** PWA URL the QR encodes (e.g. `https://lartisan.kitchen-boost.fr`). */
  pwaUrl: string;
  /** Display name of the restaurant — surfaces in the accroche + PDF title. */
  restoName: string;
  /** Optional brand logo URL. Rendered on A6 / A4 layouts, ignored on sticker. */
  logoUrl?: string;
  /** Optional brand primary colour (hex `#RRGGBB`). Used as accent on A6 / A4. */
  primaryColor?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stable display labels for the 3 V1 formats. Localised FR (KB Manager =
 * French restaurateur).
 */
const FORMAT_OPTIONS: ReadonlyArray<{ value: QrPdfFormat; label: string }> = [
  { value: "sticker-50mm", label: "Sticker rond 50 mm (planche A4)" },
  { value: "a6-card", label: "Carte A6" },
  { value: "a4-poster", label: "Affiche A4" },
];

const DEFAULT_FORMAT: QrPdfFormat = "sticker-50mm";

/** Build a filesystem-friendly base filename for the PDF download. */
function buildPdfFileName(restoName: string, format: QrPdfFormat): string {
  const slug = restoName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `qr-${slug || "tenant"}-${format}.pdf`;
}

// ---------------------------------------------------------------------------
// `QrGeneratorControls` — pure, headless-friendly sub-component
// ---------------------------------------------------------------------------

/**
 * Props for the pure controls sub-component. Kept separate from
 * `QrGeneratorViewProps` because this sub-component is reused by the test
 * harness (lean `environment: "node"` vitest, no DOM).
 */
export type QrGeneratorControlsProps = {
  format: QrPdfFormat;
  onFormatChange: (next: QrPdfFormat) => void;
  onRegenerate: () => void;
  /** When `true`, the Regenerate button is disabled (prevents double-clicks). */
  isRegenerating: boolean;
};

export function QrGeneratorControls(props: QrGeneratorControlsProps) {
  const { format, onFormatChange, onRegenerate, isRegenerating } = props;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="qr-format"
          className="text-muted-foreground text-xs font-medium"
        >
          Format d&apos;impression
        </label>
        <select
          id="qr-format"
          value={format}
          onChange={(e) => onFormatChange(e.target.value as QrPdfFormat)}
          className={cn(
            "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs outline-none",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          )}
        >
          {FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={isRegenerating}
        className={cn(
          "border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium shadow-xs outline-none",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        aria-label="Régénérer le QR code"
      >
        {isRegenerating ? "Régénération…" : "Régénérer"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// `QrGeneratorView` — the orchestrator
// ---------------------------------------------------------------------------

export function QrGeneratorView(props: QrGeneratorViewProps) {
  const { pwaUrl, restoName, logoUrl, primaryColor } = props;

  const [format, setFormat] = useState<QrPdfFormat>(DEFAULT_FORMAT);
  const [regenKey, setRegenKey] = useState(0);

  // Coalesced async state for the QR-then-PDF pipeline. `key` ties a
  // resolved blob URL to the exact triggers it was built from, so we can
  // tell "regenerating" purely from `state.key !== currentKey`.
  type PdfState =
    | { kind: "idle" }
    | { kind: "ready"; key: string; blobUrl: string }
    | { kind: "error"; key: string };
  const [state, setState] = useState<PdfState>({ kind: "idle" });

  // Track the most recent blob URL so we can revoke it when a new one
  // supersedes it (and on unmount) — otherwise the browser leaks the
  // underlying PDF bytes for the lifetime of the page.
  const blobUrlRef = useRef<string | null>(null);

  // The trigger pair — bumping `regenKey` or changing any input invalidates
  // the previous blob.
  const currentKey = `${pwaUrl}#${format}#${logoUrl ?? ""}#${primaryColor ?? ""}#${regenKey}`;

  // Async pipeline: generate QR PNG data URL → build PDF Blob → wrap in
  // object URL. We commit ONE setState per resolution; the in-flight state
  // is derived (no spinner-toggle dance).
  useEffect(() => {
    let cancelled = false;
    let producedUrl: string | null = null;
    generateQrDataUrl(pwaUrl, { margin: 1, width: 512 })
      .then((qrDataUrl) => {
        if (cancelled) return;
        const opts: QrPdfBuildOptions = {
          pwaUrl,
          qrDataUrl,
          restoName,
          logoUrl,
          primaryColor,
          format,
        };
        const blob = buildQrPdfBlob(opts);
        const url = URL.createObjectURL(blob);
        producedUrl = url;
        // Revoke the previous URL only after the new one is ready, so the
        // preview iframe never points at a freed object.
        if (blobUrlRef.current !== null) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = url;
        setState({ kind: "ready", key: currentKey, blobUrl: url });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: "error", key: currentKey });
      });
    return () => {
      cancelled = true;
      // If the effect re-fires before its async pipeline resolves, the URL
      // it eventually produces would never be reached by the UI — revoke it
      // to avoid the leak. The ref still points to the *committed* URL
      // (handled by the next render's revoke path above).
      if (producedUrl !== null && blobUrlRef.current !== producedUrl) {
        URL.revokeObjectURL(producedUrl);
      }
    };
  }, [pwaUrl, format, logoUrl, primaryColor, regenKey, currentKey, restoName]);

  // Final cleanup on unmount — release whatever URL we hold so the browser
  // can reclaim the PDF bytes.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current !== null) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const blobUrl =
    state.kind === "ready" && state.key === currentKey ? state.blobUrl : null;
  const isRegenerating = state.kind === "idle" || state.key !== currentKey;

  const handleRegenerate = useCallback(() => {
    setRegenKey((k) => k + 1);
  }, []);

  const fileName = useMemo(
    () => buildPdfFileName(restoName, format),
    [restoName, format],
  );

  return (
    <div className="flex flex-col gap-4">
      <QrGeneratorControls
        format={format}
        onFormatChange={setFormat}
        onRegenerate={handleRegenerate}
        isRegenerating={isRegenerating}
      />
      <div className="flex flex-col gap-3">
        <div className="border-input bg-muted/30 h-[600px] w-full overflow-hidden rounded-md border">
          {blobUrl !== null ? (
            <iframe
              src={blobUrl}
              title={`QR ${restoName} (${format})`}
              className="h-full w-full"
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {state.kind === "error"
                ? "Erreur lors de la génération du PDF."
                : "Génération du QR code…"}
            </div>
          )}
        </div>
        <div>
          {blobUrl !== null ? (
            <a
              href={blobUrl}
              download={fileName}
              className={cn(
                "bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-xs outline-none",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              )}
            >
              Télécharger PDF
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="bg-primary/60 text-primary-foreground inline-flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium opacity-60 shadow-xs"
            >
              Télécharger PDF
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
