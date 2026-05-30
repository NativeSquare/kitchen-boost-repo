/**
 * F-QR.3 (#182) — `QrGeneratorView` : the consumer-facing orchestrator of the
 * F-QR chain. Wires the `generateQrDataUrl` helper (#167) and the
 * `QrPdfDocument` (#173) into a usable surface: format selector, PDF preview,
 * download button, regenerate button.
 *
 * Consumed by
 * -----------
 * - the standalone page `/t/[tenantId]/qr` (#142.4, future story) — KB Manager
 *   navigates here to grab the printable PDF on demand;
 * - **and** the step 6 of the F-WIZARD onboarding flow (PRD 70 §3.6 + §4.7) —
 *   same UI, same module, no duplication.
 *
 * Architecture choices (locked by the issue body, do NOT re-litigate)
 * ------------------------------------------------------------------
 * 1. **100 % front.** Zero backend round-trip — the caller passes the already-
 *    known `pwaUrl` (resolved upstream from the tenant query, via
 *    `tenantPwaUrl()` of #167). PRD 70 §4.7, acté 2026-05-29.
 * 2. **`next/dynamic({ ssr: false })`** for the heavy PDF primitives. The
 *    `@react-pdf/renderer` bundle is ~500 KB; importing it statically would
 *    inflate every shell page that doesn't even render PDFs. By lazy-loading
 *    `PDFViewer`, `PDFDownloadLink`, and `QrPdfDocument` itself, the shell
 *    pays nothing until the user actually opens this view. Issue body
 *    explicit + PRD §4.7 Implementation Decisions.
 * 3. **Three formats only V1** — `sticker-50mm`, `a6-card`, `a4-poster`
 *    (mirror of `QrPdfFormat` from #173). Default `sticker-50mm` (the
 *    primary terrain artefact = sticker dans le sac Uber Eats).
 * 4. **Pure controls split out** in `QrGeneratorControls` so the format
 *    selector + Regenerate button are testable under the lean
 *    `environment: "node"` vitest config without jsdom or RTL.
 *
 * Behaviour
 * ---------
 * - On mount and whenever `pwaUrl` changes, the component regenerates the
 *   `qrDataUrl` via `generateQrDataUrl()` and stores it in state.
 * - "Régénérer" forces a refresh (useful if the caller upgraded `pwaUrl`
 *   in-place — e.g. after a `customDomain` swap from the Paramètres page —
 *   without remounting the view). It bumps an internal `regenKey` counter
 *   that is read by the effect's dependency list.
 * - While the QR data URL is being computed, the preview / download surface
 *   shows a lean inline placeholder rather than mounting the PDF runtime
 *   (which would otherwise try to render with an empty `qrDataUrl`).
 *
 * Out of scope (V1)
 * -----------------
 * - Custom number of stickers per A4 sheet (default 12, locked in #173).
 * - Custom accroche text — locked to `Scannez pour commander direct chez
 *   <restoName>` in #173.
 * - Server-side rendering of the PDF — explicitly rejected in the parent
 *   epic (#142).
 */
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

import { generateQrDataUrl } from "@/lib/qr-data-url";
import { cn } from "@/lib/utils";

import type { QrPdfDocumentProps, QrPdfFormat } from "./QrPdfDocument";

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
// Dynamic imports — heavy PDF runtime stays out of the shell bundle
// ---------------------------------------------------------------------------
// `@react-pdf/renderer` weighs ~500 KB and only makes sense in the browser
// (it relies on DOM + canvas-like primitives behind PDFViewer). We pin
// `ssr: false` so Next never tries to render it server-side.
//
// We also dynamic-load `QrPdfDocument` itself: it statically imports the
// heavy renderer (see `QrPdfDocument.tsx`), so any module that re-exports it
// would pull the same weight. Lazy-loading its module keeps the shell lean.
//
// We type the dynamic components explicitly so consumers + tests keep
// inference (instead of `ComponentType<unknown>`).
type PDFViewerProps = {
  children: React.ReactNode;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
  showToolbar?: boolean;
  className?: string;
};

type PDFDownloadLinkProps = {
  document: React.ReactElement;
  fileName?: string;
  children: React.ReactNode | ((p: { loading: boolean }) => React.ReactNode);
  className?: string;
};

const PDFViewer = dynamic<PDFViewerProps>(
  async () => {
    const mod = await import("@react-pdf/renderer");
    return mod.PDFViewer as unknown as ComponentType<PDFViewerProps>;
  },
  { ssr: false },
);

const PDFDownloadLink = dynamic<PDFDownloadLinkProps>(
  async () => {
    const mod = await import("@react-pdf/renderer");
    return mod.PDFDownloadLink as unknown as ComponentType<PDFDownloadLinkProps>;
  },
  { ssr: false },
);

const QrPdfDocumentLazy = dynamic<QrPdfDocumentProps>(
  async () => {
    const mod = await import("./QrPdfDocument");
    return mod.QrPdfDocument as unknown as ComponentType<QrPdfDocumentProps>;
  },
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Stable display labels for the 3 V1 formats. Localised FR (KB Manager =
 * French restaurateur). Kept here (not in the sub-component) so the
 * canonical list is one source of truth.
 */
const FORMAT_OPTIONS: ReadonlyArray<{ value: QrPdfFormat; label: string }> = [
  { value: "sticker-50mm", label: "Sticker rond 50 mm (planche A4)" },
  { value: "a6-card", label: "Carte A6" },
  { value: "a4-poster", label: "Affiche A4" },
];

/** Default format on mount — the primary terrain artefact (sticker dans le sac). */
const DEFAULT_FORMAT: QrPdfFormat = "sticker-50mm";

/**
 * Build a deterministic, filesystem-friendly base filename for the PDF
 * download. We don't sanitise heavily — the OS download UI will accept
 * accented characters fine and we want the file to be recognisable by the
 * restaurateur, not opaque.
 */
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
 * harness (lean `environment: "node"` vitest, no DOM) without exercising
 * the dynamic PDF runtime.
 */
export type QrGeneratorControlsProps = {
  format: QrPdfFormat;
  onFormatChange: (next: QrPdfFormat) => void;
  onRegenerate: () => void;
  /** When `true`, the Regenerate button is disabled (prevents double-clicks). */
  isRegenerating: boolean;
};

/**
 * Format selector + Regenerate button. Pure presentational, no side effects.
 * Uses a native `<select>` (not the Radix `Select` wrapper) because:
 *   1. The 3-option case doesn't justify a Radix portal / popper.
 *   2. The native control is fully accessible by default and works under
 *      the lean vitest env (no jsdom needed).
 *   3. It keeps the tree shallow enough to assert via the React-tree
 *      serializer in `QrGeneratorView.test.tsx`.
 */
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
/**
 * Main exported component. See file header for the full contract.
 */
export function QrGeneratorView(props: QrGeneratorViewProps) {
  const { pwaUrl, restoName, logoUrl, primaryColor } = props;

  const [format, setFormat] = useState<QrPdfFormat>(DEFAULT_FORMAT);
  const [regenKey, setRegenKey] = useState(0);
  // We coalesce the async QR-generation outcome into one piece of state so the
  // effect makes a SINGLE `setState` call per resolution — which avoids the
  // `react-hooks/set-state-in-effect` lint warning that fires when an effect
  // body itself sets state synchronously (it would do so to flip a spinner
  // ON, then again to flip it OFF in the .then). Instead, we encode both the
  // in-flight + resolved states in `qrState`, keyed by the trigger pair
  // (`pwaUrl`, `regenKey`). The "in-flight" state is derived purely:
  // `qrState.key !== currentKey ⇒ regenerating`.
  type QrState =
    | { kind: "idle" }
    | { kind: "ready"; key: string; dataUrl: string }
    | { kind: "error"; key: string };
  const [qrState, setQrState] = useState<QrState>({ kind: "idle" });

  const currentKey = `${pwaUrl}#${regenKey}`;

  // (Re)generate the QR data URL whenever `pwaUrl` changes OR the user
  // explicitly hits "Régénérer" (regenKey++). We intentionally don't depend
  // on `format` here — the data URL encodes the same `pwaUrl` regardless of
  // the layout chosen; the layout only affects how the PDF lays the QR out.
  //
  // The effect body has ZERO synchronous setState calls — only the async
  // resolution callbacks set state, which is the recommended shape for
  // effects synchronising with an external async source (the QR lib).
  useEffect(() => {
    let cancelled = false;
    generateQrDataUrl(pwaUrl, { margin: 1, width: 512 })
      .then((url) => {
        if (!cancelled) {
          setQrState({ kind: "ready", key: currentKey, dataUrl: url });
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Even on error, clear the spinner — the empty preview surface
          // makes the failure visible without crashing the shell. A proper
          // error toast lives at the page level (#142.4).
          setQrState({ kind: "error", key: currentKey });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pwaUrl, regenKey, currentKey]);

  const qrDataUrl =
    qrState.kind === "ready" && qrState.key === currentKey
      ? qrState.dataUrl
      : null;
  // We're "regenerating" until the latest trigger resolves (either ready or
  // error for the current key). Derived state — no extra setState dance.
  const isRegenerating = qrState.kind === "idle" || qrState.key !== currentKey;

  const handleRegenerate = useCallback(() => {
    setRegenKey((k) => k + 1);
  }, []);

  const fileName = useMemo(
    () => buildPdfFileName(restoName, format),
    [restoName, format],
  );

  // The document element we pass to PDFViewer + PDFDownloadLink. Memoised
  // so changing the format doesn't rebuild the QR (the data URL is reused).
  // We can't render the PDF runtime until `qrDataUrl` is known, so we gate
  // both surfaces on that.
  const pdfDocument = useMemo(() => {
    if (!qrDataUrl) return null;
    const docProps: QrPdfDocumentProps = {
      pwaUrl,
      qrDataUrl,
      restoName,
      logoUrl,
      primaryColor,
      format,
    };
    return <QrPdfDocumentLazy {...docProps} />;
  }, [qrDataUrl, pwaUrl, restoName, logoUrl, primaryColor, format]);

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
          {pdfDocument ? (
            <PDFViewer width="100%" height="100%" showToolbar={false}>
              {pdfDocument}
            </PDFViewer>
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              Génération du QR code…
            </div>
          )}
        </div>
        <div>
          {pdfDocument ? (
            <PDFDownloadLink
              document={pdfDocument}
              fileName={fileName}
              className={cn(
                "bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-xs outline-none",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              )}
            >
              {({ loading }) =>
                loading ? "Préparation du PDF…" : "Télécharger PDF"
              }
            </PDFDownloadLink>
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
