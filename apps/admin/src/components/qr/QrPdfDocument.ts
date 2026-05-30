/**
 * F-QR.2 — `QrPdfDocument` : build a printable PDF of the restaurateur's QR
 * code, for the 3 V1 formats (sticker 50 mm, A6 carte, A4 affiche).
 *
 * Why this is a `.ts` (no JSX) + `jspdf`
 * --------------------------------------
 * The original tracer-bullet (PR #298) used `@react-pdf/renderer` — a React-
 * declarative PDF lib. It shipped its own embedded `react-reconciler` and
 * stopped working with React 19.2+: `su is not a function` /
 * `Fu is not a function` thrown from `reconciler-33.js` / `reconciler-31.js`,
 * tracked upstream in [diegomura/react-pdf#3223](https://github.com/diegomura/react-pdf/issues/3223)
 * + #2756 + #2912 — open since Oct 2024, still unfixed at 4.5.1.
 *
 * Replaced with `jspdf` (~150 KB, zero React dependency, imperative API).
 * Same public contract for callers (3 layouts, same accroche, same accents) —
 * only the runtime changed.
 *
 * Architecture
 * ------------
 * The module exposes two functions:
 *
 *   - `planQrPdfLayout(opts) → QrPdfLayoutPlan` (PURE)
 *     Maps the `(format, branding, content)` triple to a flat list of
 *     drawing primitives (`PdfElement[]`) on a `PageSize`. No I/O, no jsPDF
 *     dependency. The whole layout intelligence (sticker 3×4 grid, A6
 *     accent bar + accroche + URL en clair, A4 bandeau + big QR) is here,
 *     so the test suite pins every layout rule without ever touching the
 *     PDF runtime.
 *
 *   - `buildQrPdfBlob(opts) → Blob` (SIDE-EFFECTING)
 *     Calls `planQrPdfLayout`, then walks the plan and dispatches to jsPDF
 *     primitives (`addImage`, `text`, `setFillColor`, `rect`, …). Returns
 *     a PDF `Blob` ready for `URL.createObjectURL` or an anchor download.
 *     Kept thin on purpose: anything testable lives in the plan.
 *
 * Layouts V1 (acted PRD §4.7)
 * ---------------------------
 *  - **sticker-50mm** : A4 portrait, 12 stickers ronds 50 mm en grille 3×4.
 *    Pas d'accroche, pas d'URL en clair, pas de logo : trop petit pour
 *    rester lisible si on charge plus.
 *  - **a6-card** : A6 portrait (cartonnette à glisser dans le sac). Accent
 *    bar haut + (logo si fourni) + accroche + QR centré + URL en clair pied.
 *  - **a4-poster** : A4 portrait (affiche caisse / vitrine). Bandeau coloré
 *    en tête (+ logo blanc dessus si fourni) + accroche grand format + QR
 *    grand format + URL en clair pied.
 *
 * Tailles en points (1 pt = 1/72 inch — unité native PDF). Pas de conversion
 * px → mm → pt qui poserait des arrondis bizarres.
 */

import jsPDF from "jspdf";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type QrPdfFormat = "sticker-50mm" | "a6-card" | "a4-poster";

/** Build-time input. Same shape that callers (QrGeneratorView + the wizard
 *  step 6) used to pass to the old `<QrPdfDocument {...} />` component, minus
 *  any React-renderer ceremony. */
export type QrPdfBuildOptions = {
  /** PWA URL the QR encodes — also displayed as fallback text on A6/A4. */
  pwaUrl: string;
  /** Pre-generated `data:image/png;base64,...` (cf. `generateQrDataUrl` #167). */
  qrDataUrl: string;
  /** Restaurant display name, surfaced in the accroche. */
  restoName: string;
  /** Optional logo URL. Rendered on A6/A4 if provided, ignored on sticker. */
  logoUrl?: string;
  /** Hex `#RRGGBB`. Used for accent bar/bandeau and accroche colour. */
  primaryColor?: string;
  /** Layout choice. */
  format: QrPdfFormat;
};

// ---------------------------------------------------------------------------
// Plan (pure layout description, no I/O)
// ---------------------------------------------------------------------------

/** Page envelope returned by the plan — the runtime maps it to
 *  `new jsPDF({ format, orientation, unit: "pt" })`. */
export type QrPdfPageDescriptor = {
  size: "a4" | "a6";
  orientation: "portrait";
};

/** One drawing primitive emitted by the plan. The runtime knows how to
 *  dispatch each kind to the corresponding jsPDF call. */
export type PdfElement =
  | {
      kind: "image";
      src: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | {
      kind: "text";
      text: string;
      x: number;
      y: number;
      fontSize: number;
      color: string;
      align: "left" | "center";
      bold: boolean;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill: string;
    }
  | {
      // Round dashed cutting outline for the sticker layout — printed as a
      // visual guide, not a real die-cut path.
      kind: "stickerCellOutline";
      x: number;
      y: number;
      diameter: number;
    };

export type QrPdfLayoutPlan = {
  format: QrPdfFormat;
  page: QrPdfPageDescriptor;
  elements: PdfElement[];
};

// ---------------------------------------------------------------------------
// Design constants
// ---------------------------------------------------------------------------

/** Neutral ink when the tenant has no `primaryColor` yet. Charte KitchenBoost
 *  noir (#111111), cf. CLAUDE.md > Direction artistique. */
const DEFAULT_INK = "#111111";

/** 50 mm in points (1 mm ≈ 2.834 pt). The round sticker is inscribed in a
 *  50 mm square = ~141.7 pt. */
const STICKER_SIDE_PT = 141.73;

/** Standard ~10 mm margin used on A4 / A6 layouts. */
const PAGE_MARGIN_PT = 28.35;

/** A4 / A6 dimensions in points (jsPDF default page metrics — explicit here
 *  so the plan stays independent from the runtime). */
const PAGE_WIDTH = { a4: 595.28, a6: 297.64 } as const;
const PAGE_HEIGHT = { a4: 841.89, a6: 419.53 } as const;

/** Locked V1 accroche copy (PRD §4.7). */
export function accrocheFor(restoName: string): string {
  return `Scannez pour commander direct chez ${restoName}`;
}

// ---------------------------------------------------------------------------
// Plan builders — one per format
// ---------------------------------------------------------------------------

function planSticker(opts: QrPdfBuildOptions): QrPdfLayoutPlan {
  // 12 stickers ronds 50 mm en grille 3 × 4 sur A4 portrait. The grid is
  // computed to centre evenly in the printable area (margins symmetric).
  const cols = 3;
  const rows = 4;
  const usableW = PAGE_WIDTH.a4 - 2 * PAGE_MARGIN_PT;
  const usableH = PAGE_HEIGHT.a4 - 2 * PAGE_MARGIN_PT;
  // Even horizontal gap between cells (and same against the inside margins).
  const gapX = (usableW - cols * STICKER_SIDE_PT) / (cols + 1);
  const gapY = (usableH - rows * STICKER_SIDE_PT) / (rows + 1);
  // The QR fills the cell minus 12 pt padding (~4 mm visual breathing room
  // inside the round dashed cut guide).
  const qrInset = 12;
  const elements: PdfElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellX = PAGE_MARGIN_PT + gapX + c * (STICKER_SIDE_PT + gapX);
      const cellY = PAGE_MARGIN_PT + gapY + r * (STICKER_SIDE_PT + gapY);
      elements.push({
        kind: "stickerCellOutline",
        x: cellX,
        y: cellY,
        diameter: STICKER_SIDE_PT,
      });
      elements.push({
        kind: "image",
        src: opts.qrDataUrl,
        x: cellX + qrInset,
        y: cellY + qrInset,
        w: STICKER_SIDE_PT - 2 * qrInset,
        h: STICKER_SIDE_PT - 2 * qrInset,
      });
    }
  }
  return {
    format: "sticker-50mm",
    page: { size: "a4", orientation: "portrait" },
    elements,
  };
}

function planA6(opts: QrPdfBuildOptions): QrPdfLayoutPlan {
  const accent = opts.primaryColor ?? DEFAULT_INK;
  const pageW = PAGE_WIDTH.a6;
  // y-cursor walks down the page, similar to a column flexbox top-down.
  let y = PAGE_MARGIN_PT;
  const elements: PdfElement[] = [];

  // Accent bar (4 pt high, full inner width).
  const accentH = 4;
  elements.push({
    kind: "rect",
    x: PAGE_MARGIN_PT,
    y,
    w: pageW - 2 * PAGE_MARGIN_PT,
    h: accentH,
    fill: accent,
  });
  y += accentH + 12;

  // Optional logo (height ~36 pt, centred).
  if (opts.logoUrl !== undefined) {
    const logoH = 36;
    const logoW = 60; // fixed aspect window; user logos vary, the lib will
    // scale-fit inside this box (jsPDF preserves aspect with these params).
    elements.push({
      kind: "image",
      src: opts.logoUrl,
      x: (pageW - logoW) / 2,
      y,
      w: logoW,
      h: logoH,
    });
    y += logoH + 8;
  }

  // Accroche (centred, bold, accent colour, 12 pt).
  const accrocheText = accrocheFor(opts.restoName);
  elements.push({
    kind: "text",
    text: accrocheText,
    x: pageW / 2,
    y: y + 12, // baseline offset for the 12 pt size
    fontSize: 12,
    color: accent,
    align: "center",
    bold: true,
  });
  y += 24;

  // QR centred (180 pt = ~63 mm — large enough to scan from 0.5 m).
  const qrSize = 180;
  elements.push({
    kind: "image",
    src: opts.qrDataUrl,
    x: (pageW - qrSize) / 2,
    y,
    w: qrSize,
    h: qrSize,
  });
  y += qrSize + 12;

  // URL en clair (centred, smaller).
  elements.push({
    kind: "text",
    text: opts.pwaUrl,
    x: pageW / 2,
    y: y + 9,
    fontSize: 9,
    color: DEFAULT_INK,
    align: "center",
    bold: false,
  });

  return {
    format: "a6-card",
    page: { size: "a6", orientation: "portrait" },
    elements,
  };
}

function planA4(opts: QrPdfBuildOptions): QrPdfLayoutPlan {
  const accent = opts.primaryColor ?? DEFAULT_INK;
  const pageW = PAGE_WIDTH.a4;
  const sideMargin = PAGE_MARGIN_PT * 2;
  const elements: PdfElement[] = [];

  // Bandeau coloré pleine largeur en tête (80 pt high, no top margin so it
  // hugs the edge — strong visual anchor).
  const bandeauH = 80;
  elements.push({
    kind: "rect",
    x: 0,
    y: 0,
    w: pageW,
    h: bandeauH,
    fill: accent,
  });

  // Optional logo centred ON the bandeau (56 pt high).
  if (opts.logoUrl !== undefined) {
    const logoH = 56;
    const logoW = 120;
    elements.push({
      kind: "image",
      src: opts.logoUrl,
      x: (pageW - logoW) / 2,
      y: (bandeauH - logoH) / 2,
      w: logoW,
      h: logoH,
    });
  }

  // y starts below the bandeau + breathing room.
  let y = bandeauH + 24;

  // Accroche (centred, bold, 24 pt, accent colour).
  elements.push({
    kind: "text",
    text: accrocheFor(opts.restoName),
    x: pageW / 2,
    y: y + 24,
    fontSize: 24,
    color: accent,
    align: "center",
    bold: true,
  });
  y += 48;

  // Big QR (360 pt = ~127 mm — readable from across the room).
  const qrSize = 360;
  elements.push({
    kind: "image",
    src: opts.qrDataUrl,
    x: (pageW - qrSize) / 2,
    y,
    w: qrSize,
    h: qrSize,
  });
  y += qrSize + 24;

  // URL en clair (14 pt, centred).
  elements.push({
    kind: "text",
    text: opts.pwaUrl,
    x: pageW / 2,
    y: y + 14,
    fontSize: 14,
    color: DEFAULT_INK,
    align: "center",
    bold: false,
  });

  // sideMargin is referenced for symmetry of the layout intent but the
  // current A4 plan uses page-relative anchors only; keep the binding alive
  // so future text blocks can quote it without recomputing.
  void sideMargin;

  return {
    format: "a4-poster",
    page: { size: "a4", orientation: "portrait" },
    elements,
  };
}

/**
 * Pure layout planner. Returns the full draw list for the requested format
 * — no I/O, no jsPDF dependency. The test suite asserts every PRD §4.7 rule
 * directly on this output (number of QR images, presence of accroche/URL,
 * primary colour applied, etc.) without ever touching the PDF runtime.
 */
export function planQrPdfLayout(opts: QrPdfBuildOptions): QrPdfLayoutPlan {
  switch (opts.format) {
    case "sticker-50mm":
      return planSticker(opts);
    case "a6-card":
      return planA6(opts);
    case "a4-poster":
      return planA4(opts);
  }
}

// ---------------------------------------------------------------------------
// Runtime — walk the plan, emit jsPDF calls, return a Blob
// ---------------------------------------------------------------------------

/** Parse a `#RRGGBB` hex into the `[r, g, b]` triple jsPDF takes. Tolerant
 *  to short `#RGB` form, returns black on garbage rather than throwing — a
 *  malformed branding colour should not break the export. */
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().replace(/^#/, "");
  const expanded =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return [17, 17, 17]; // DEFAULT_INK
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Build a printable PDF Blob from the V1 build options. Internally:
 *   1. plans the layout (pure),
 *   2. instantiates `new jsPDF({ unit: "pt", format, orientation })`,
 *   3. dispatches each `PdfElement` to the corresponding jsPDF primitive,
 *   4. returns `doc.output("blob")` — a real `application/pdf` Blob ready
 *      for `URL.createObjectURL` (preview iframe) or an anchor `download`.
 *
 * Note: jsPDF text baseline anchors are bottom-left by default. The plan
 * stores text `y` as the baseline coordinate, so the runtime passes it
 * straight through with no further adjustment.
 */
export function buildQrPdfBlob(opts: QrPdfBuildOptions): Blob {
  const plan = planQrPdfLayout(opts);
  const doc = new jsPDF({
    unit: "pt",
    format: plan.page.size,
    orientation: plan.page.orientation,
  });
  for (const el of plan.elements) {
    switch (el.kind) {
      case "image":
        // jsPDF infers PNG from the data URL prefix; the format flag is a
        // hint only. We pass "PNG" explicitly because `qrcode` always emits
        // PNG and that's stable across plan revisions.
        doc.addImage(el.src, "PNG", el.x, el.y, el.w, el.h);
        break;
      case "text": {
        const [r, g, b] = hexToRgb(el.color);
        doc.setTextColor(r, g, b);
        doc.setFontSize(el.fontSize);
        // jsPDF font-weight: "bold" toggles the bold variant of the default
        // Helvetica face; "normal" reverts. Avoids loading a custom font.
        doc.setFont("helvetica", el.bold ? "bold" : "normal");
        doc.text(el.text, el.x, el.y, { align: el.align });
        break;
      }
      case "rect": {
        const [r, g, b] = hexToRgb(el.fill);
        doc.setFillColor(r, g, b);
        doc.rect(el.x, el.y, el.w, el.h, "F");
        break;
      }
      case "stickerCellOutline": {
        // Light grey dashed circle for the visual cut guide. Cosmetic only.
        doc.setDrawColor(204, 204, 204);
        doc.setLineWidth(0.5);
        // Dashed pattern: 4 pt on / 4 pt off — readable but unobtrusive.
        doc.setLineDashPattern([4, 4], 0);
        const radius = el.diameter / 2;
        doc.circle(el.x + radius, el.y + radius, radius, "S");
        // Reset dash so the next draw call doesn't inherit it.
        doc.setLineDashPattern([], 0);
        break;
      }
    }
  }
  return doc.output("blob");
}
