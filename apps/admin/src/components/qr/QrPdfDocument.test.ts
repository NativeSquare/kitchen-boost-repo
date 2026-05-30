/**
 * F-QR.2 — `QrPdfDocument` (jspdf rewrite) — tests of the layout planner +
 * smoke check on the runtime.
 *
 * Strategy
 * --------
 * The plan side (`planQrPdfLayout`) is 100 % pure: input → flat list of
 * primitives (images, text, rects, sticker cell outlines), no I/O. We pin
 * every PRD §4.7 rule against the plan rather than the binary PDF — this
 * keeps assertions readable and lets a regression name the failing rule
 * (e.g. "missing accroche on A6") instead of "snapshot diff at byte 2871".
 *
 * The runtime side (`buildQrPdfBlob`) is one thin smoke test: assert that
 * calling jsPDF through our wrapper produces a non-empty `application/pdf`
 * `Blob` whose first 8 bytes start with the PDF magic `%PDF-`. Validates the
 * full code path end-to-end without parsing the document.
 *
 * Why not pin the actual PDF bytes? jsPDF stamps a timestamp in the trailer
 * by default — the bytes change per run, so a byte-level snapshot would be
 * flaky. The plan + header check together give us layout correctness AND
 * "runtime did fire" without flakes.
 */
import { describe, expect, it } from "vitest";
import {
  accrocheFor,
  buildQrPdfBlob,
  planQrPdfLayout,
  type QrPdfBuildOptions,
  type QrPdfLayoutPlan,
  type PdfElement,
} from "./QrPdfDocument";

// ---------------------------------------------------------------------------
// Fixtures + plan helpers
// ---------------------------------------------------------------------------

// A 1×1 transparent PNG, sufficient for jsPDF.addImage() — keeps the test
// independent from the real QR data and from the `qrcode` lib's output.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const PWA = "https://lartisan.kitchen-boost.fr";
const NAME = "L'Artisan";
const LOGO = "https://cdn.example.com/lartisan/logo.png";
const COLOR = "#1B7A3D";

function baseOpts(format: QrPdfBuildOptions["format"]): QrPdfBuildOptions {
  return {
    pwaUrl: PWA,
    qrDataUrl: TINY_PNG_DATA_URL,
    restoName: NAME,
    primaryColor: COLOR,
    format,
  };
}

/** Type-narrowing helpers — keep assertions readable without `as`. */
function isImage(el: PdfElement): el is Extract<PdfElement, { kind: "image" }> {
  return el.kind === "image";
}
function isText(el: PdfElement): el is Extract<PdfElement, { kind: "text" }> {
  return el.kind === "text";
}
function isRect(el: PdfElement): el is Extract<PdfElement, { kind: "rect" }> {
  return el.kind === "rect";
}

function imagesIn(plan: QrPdfLayoutPlan): string[] {
  return plan.elements.filter(isImage).map((e) => e.src);
}
function textsIn(plan: QrPdfLayoutPlan): string[] {
  return plan.elements.filter(isText).map((e) => e.text);
}
function colorsIn(plan: QrPdfLayoutPlan): string[] {
  return [
    ...plan.elements.filter(isRect).map((e) => e.fill),
    ...plan.elements.filter(isText).map((e) => e.color),
  ];
}

// ---------------------------------------------------------------------------
// sticker-50mm — 12-QR grid, no copy
// ---------------------------------------------------------------------------

describe("planQrPdfLayout — sticker-50mm", () => {
  it("targets A4 portrait", () => {
    const p = planQrPdfLayout(baseOpts("sticker-50mm"));
    expect(p.page).toEqual({ size: "a4", orientation: "portrait" });
  });

  it("renders exactly 12 QR images (3×4 grid, all the same source)", () => {
    const p = planQrPdfLayout(baseOpts("sticker-50mm"));
    const srcs = imagesIn(p);
    expect(srcs).toHaveLength(12);
    expect(new Set(srcs)).toEqual(new Set([TINY_PNG_DATA_URL]));
  });

  it("emits exactly 12 round cell outlines (one per sticker) — visual cut guide", () => {
    const p = planQrPdfLayout(baseOpts("sticker-50mm"));
    const outlines = p.elements.filter((e) => e.kind === "stickerCellOutline");
    expect(outlines).toHaveLength(12);
  });

  it("does NOT include the accroche or the restaurant name (sticker trop petit — PRD §4.7)", () => {
    const p = planQrPdfLayout(baseOpts("sticker-50mm"));
    const allText = textsIn(p).join(" ");
    expect(allText).not.toMatch(/Scannez pour commander/i);
    expect(allText).not.toContain(NAME);
  });

  it("does NOT include the PWA URL en clair (sticker trop petit)", () => {
    const p = planQrPdfLayout(baseOpts("sticker-50mm"));
    expect(textsIn(p).join(" ")).not.toContain(PWA);
  });

  it("ignores logoUrl when provided (sticker layout is logo-free by design)", () => {
    const p = planQrPdfLayout({ ...baseOpts("sticker-50mm"), logoUrl: LOGO });
    const srcs = imagesIn(p);
    expect(srcs).not.toContain(LOGO);
    expect(srcs).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// a6-card
// ---------------------------------------------------------------------------

describe("planQrPdfLayout — a6-card", () => {
  it("targets A6 portrait", () => {
    const p = planQrPdfLayout(baseOpts("a6-card"));
    expect(p.page).toEqual({ size: "a6", orientation: "portrait" });
  });

  it("renders the accroche with the restaurant name (PRD §4.7)", () => {
    const p = planQrPdfLayout(baseOpts("a6-card"));
    const allText = textsIn(p).join(" ");
    expect(allText).toContain(accrocheFor(NAME));
    expect(allText).toContain(NAME);
  });

  it("renders the PWA URL en clair (fallback texte)", () => {
    const p = planQrPdfLayout(baseOpts("a6-card"));
    expect(textsIn(p).join(" ")).toContain(PWA);
  });

  it("renders exactly one QR image, plus the logo when logoUrl is provided", () => {
    const noLogo = planQrPdfLayout(baseOpts("a6-card"));
    expect(imagesIn(noLogo)).toEqual([TINY_PNG_DATA_URL]);

    const withLogo = planQrPdfLayout({ ...baseOpts("a6-card"), logoUrl: LOGO });
    const sources = imagesIn(withLogo);
    expect(sources).toContain(TINY_PNG_DATA_URL);
    expect(sources).toContain(LOGO);
    expect(sources).toHaveLength(2);
  });

  it("applies primaryColor as an accent (surfaces somewhere in rect/text)", () => {
    const p = planQrPdfLayout(baseOpts("a6-card"));
    expect(colorsIn(p)).toContain(COLOR);
  });

  it("falls back to the default ink when primaryColor is absent", () => {
    const { primaryColor: _omit, ...rest } = baseOpts("a6-card");
    void _omit;
    const p = planQrPdfLayout(rest);
    // Default ink is the project's neutral noir (#111111). Test through the
    // accent rect (always emitted in A6) — it must be SOME color, not
    // throwing, and not the unrelated test colour.
    expect(colorsIn(p)).toContain("#111111");
    expect(colorsIn(p)).not.toContain(COLOR);
  });
});

// ---------------------------------------------------------------------------
// a4-poster
// ---------------------------------------------------------------------------

describe("planQrPdfLayout — a4-poster", () => {
  it("targets A4 portrait", () => {
    const p = planQrPdfLayout(baseOpts("a4-poster"));
    expect(p.page).toEqual({ size: "a4", orientation: "portrait" });
  });

  it("renders the accroche with the restaurant name (PRD §4.7)", () => {
    const p = planQrPdfLayout(baseOpts("a4-poster"));
    const allText = textsIn(p).join(" ");
    expect(allText).toContain(accrocheFor(NAME));
  });

  it("renders the PWA URL en clair (fallback texte)", () => {
    const p = planQrPdfLayout(baseOpts("a4-poster"));
    expect(textsIn(p).join(" ")).toContain(PWA);
  });

  it("renders the QR image alone, then the logo too when logoUrl is provided", () => {
    const noLogo = planQrPdfLayout(baseOpts("a4-poster"));
    expect(imagesIn(noLogo)).toEqual([TINY_PNG_DATA_URL]);

    const withLogo = planQrPdfLayout({
      ...baseOpts("a4-poster"),
      logoUrl: LOGO,
    });
    expect(imagesIn(withLogo)).toEqual(
      expect.arrayContaining([TINY_PNG_DATA_URL, LOGO]),
    );
  });

  it("applies primaryColor as the bandeau colour (surfaces in a rect.fill)", () => {
    const p = planQrPdfLayout(baseOpts("a4-poster"));
    const rectFills = p.elements.filter(isRect).map((e) => e.fill);
    expect(rectFills).toContain(COLOR);
  });
});

// ---------------------------------------------------------------------------
// Runtime smoke — buildQrPdfBlob actually produces a PDF Blob
// ---------------------------------------------------------------------------

describe("buildQrPdfBlob — runtime smoke (vitest node env)", () => {
  it("returns an application/pdf Blob whose magic bytes start with %PDF-", async () => {
    // Smallest format (A6, 1 QR + 1 accroche + 1 URL) — fastest to build,
    // exercises the full code path (image, text, rect).
    const blob = buildQrPdfBlob(baseOpts("a6-card"));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/pdf");
    const buf = await blob.arrayBuffer();
    const head = new TextDecoder().decode(buf.slice(0, 5));
    expect(head).toBe("%PDF-");
  });

  it("builds all three formats without throwing", () => {
    expect(() => buildQrPdfBlob(baseOpts("sticker-50mm"))).not.toThrow();
    expect(() => buildQrPdfBlob(baseOpts("a6-card"))).not.toThrow();
    expect(() => buildQrPdfBlob(baseOpts("a4-poster"))).not.toThrow();
  });
});
