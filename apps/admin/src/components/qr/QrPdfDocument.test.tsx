/**
 * F-QR.2 — `QrPdfDocument` snapshot tests for the 3 V1 printable formats
 * (sticker 50mm, A6 carte, A4 affiche), each with and without `logoUrl`.
 *
 * Why a tree snapshot, not a rendered-PDF snapshot?
 * ------------------------------------------------
 * The component is **pure presentational** glue around `@react-pdf/renderer`
 * primitives (`<Document>`, `<Page>`, `<View>`, `<Text>`, `<Image>`). It has
 * NO side effects, NO I/O — the caller pre-builds `qrDataUrl` via
 * `generateQrDataUrl` (#167). So the contract we want to pin is the *shape of
 * the React tree it produces*: which primitives, in which order, with which
 * props (sizes, branding accents, accroche text, URL en clair).
 *
 * Rendering the actual PDF in vitest would require either jsdom + a heavy
 * browser bundle of @react-pdf, or piping through Node's pdfkit fork — both
 * orthogonal to what we want to assert (V1 = layouts correct, branding
 * applied, accroche/URL where the PRD says, NOT visual pixel-perfection).
 *
 * The serializer below walks the React element tree (no DOM, no test
 * renderer needed) and emits a normalised structure that `toMatchSnapshot`
 * pins. This stays compatible with the project's `environment: "node"`
 * vitest config and the existing pattern of unit-testing React decision
 * functions without RTL (`session-guard.decision.test.ts`).
 *
 * Acceptance criteria covered (issue #173) — each is a discrete assertion
 * below, in addition to the snapshot, so a regression names the failing rule:
 *   - 3 layouts gérés via prop `format`
 *   - Branding : `logoUrl` rendu si fourni, `primaryColor` utilisée en accents
 *   - Accroche présente sur A6 et A4, absente sur sticker-50mm
 *   - URL en clair présente sur A6 et A4
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { QrPdfDocument, type QrPdfDocumentProps } from "./QrPdfDocument";

// ---------------------------------------------------------------------------
// Minimal React-tree serializer
// ---------------------------------------------------------------------------
// We can't use `react-test-renderer` (not installed, deprecated for React 19)
// and we don't want jsdom in this lean unit-test env. So we walk the React
// element tree ourselves and emit a JSON-able shape, normalising the `type`
// to a stable string (class display name, function name, or the string tag)
// so a snapshot is meaningful — e.g. `@react-pdf` `<Page>` shows up as
// `"Page"`, not as an opaque class reference whose `.toString()` changes
// between versions.
type SerializedNode =
  | { type: string; props: Record<string, unknown>; children: SerializedNode[] }
  | { text: string }
  | null;

function isReactElement(node: unknown): node is ReactElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node
  );
}

function typeName(t: unknown): string {
  if (typeof t === "string") return t;
  if (typeof t === "function") {
    return (
      (t as { displayName?: string; name?: string }).displayName ??
      (t as { name?: string }).name ??
      "Anonymous"
    );
  }
  if (typeof t === "object" && t !== null) {
    const obj = t as { displayName?: string; name?: string };
    return obj.displayName ?? obj.name ?? "Component";
  }
  return String(t);
}

function serialize(node: ReactNode): SerializedNode {
  if (node === null || node === undefined || node === false || node === true) {
    return null;
  }
  if (typeof node === "string" || typeof node === "number") {
    return { text: String(node) };
  }
  if (Array.isArray(node)) {
    // Arrays are spread by React; we still want one stable serialised list,
    // so wrap them in a synthetic "Fragment-array" marker.
    return {
      type: "ArrayFragment",
      props: {},
      children: node
        .map((c) => serialize(c))
        .filter((c): c is SerializedNode => c !== null),
    };
  }
  if (isReactElement(node)) {
    const props = { ...(node.props as Record<string, unknown>) };
    const rawChildren = props.children as ReactNode | undefined;
    delete props.children;
    const children: SerializedNode[] = [];
    if (rawChildren !== undefined) {
      const childList = Array.isArray(rawChildren)
        ? rawChildren
        : [rawChildren];
      for (const c of childList) {
        const s = serialize(c);
        if (s !== null) children.push(s);
      }
    }
    return { type: typeName(node.type), props, children };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
// `qrDataUrl` is a stable placeholder — we don't generate a real QR here, the
// caller's responsibility per the component's contract. Keeping it short keeps
// snapshots readable.
const QR = "data:image/png;base64,QR_PLACEHOLDER";
const PWA = "https://lartisan.kitchen-boost.fr";
const NAME = "L'Artisan";
const LOGO = "https://cdn.example.com/lartisan/logo.png";
const COLOR = "#1B7A3D"; // KitchenBoost vert foncé

function render(props: QrPdfDocumentProps): SerializedNode {
  // Calling the component as a plain function returns its React element tree
  // synchronously (no hooks involved — pure presentational). This is exactly
  // what `@react-pdf/renderer` would later consume; we just snapshot the tree
  // before it hits the renderer.
  return serialize(QrPdfDocument(props));
}

// Helpers to introspect the serialised tree without depending on the snapshot
// format — these power the per-AC assertions.
function flatten(n: SerializedNode): SerializedNode[] {
  if (n === null) return [];
  if ("text" in n) return [n];
  return [n, ...n.children.flatMap(flatten)];
}

function texts(n: SerializedNode): string[] {
  return flatten(n)
    .map((x) => (x && "text" in x ? x.text : null))
    .filter((x): x is string => x !== null);
}

function countByType(n: SerializedNode, type: string): number {
  return flatten(n).filter((x) => x && "type" in x && x.type === type).length;
}

function imageSources(n: SerializedNode): string[] {
  return flatten(n)
    .filter((x) => x && "type" in x && x.type === "Image")
    .map((x) =>
      x && "type" in x ? ((x.props as { src?: string }).src ?? "") : "",
    );
}

// ---------------------------------------------------------------------------
// Per-format acceptance assertions + snapshot
// ---------------------------------------------------------------------------
describe("QrPdfDocument — sticker-50mm", () => {
  const baseProps: QrPdfDocumentProps = {
    pwaUrl: PWA,
    qrDataUrl: QR,
    restoName: NAME,
    primaryColor: COLOR,
    format: "sticker-50mm",
  };

  it("matches snapshot without logoUrl", () => {
    expect(render(baseProps)).toMatchSnapshot();
  });

  it("matches snapshot with logoUrl (sticker ignores logo by design — too small)", () => {
    // PRD §4.7: sticker 50 mm is too small to carry brand assets readably.
    // The snapshot pins that today's behaviour is "ignore logo" — if we ever
    // change that, the snapshot will flag it and a human must re-decide.
    expect(render({ ...baseProps, logoUrl: LOGO })).toMatchSnapshot();
  });

  it("renders a 3×4 grid of 12 identical QR codes on a single A4 page", () => {
    // PRD §4.7: « planche A4 portrait, 12 QR identiques en grille 3×4 ».
    const tree = render(baseProps);
    // Exactly one Page.
    expect(countByType(tree, "Page")).toBe(1);
    // 12 <Image> elements, all wired to the same QR data URL.
    const srcs = imageSources(tree);
    expect(srcs).toHaveLength(12);
    expect(new Set(srcs)).toEqual(new Set([QR]));
  });

  it("does NOT render the accroche on the sticker layout (PRD §4.7 — trop petit)", () => {
    const tree = render(baseProps);
    const all = texts(tree).join(" ");
    expect(all).not.toMatch(/Scannez pour commander/i);
    expect(all).not.toContain(NAME);
  });

  it("does NOT render the URL en clair on the sticker layout (trop petit)", () => {
    const tree = render(baseProps);
    expect(texts(tree).join(" ")).not.toContain(PWA);
  });
});

describe("QrPdfDocument — a6-card", () => {
  const baseProps: QrPdfDocumentProps = {
    pwaUrl: PWA,
    qrDataUrl: QR,
    restoName: NAME,
    primaryColor: COLOR,
    format: "a6-card",
  };

  it("matches snapshot without logoUrl", () => {
    expect(render(baseProps)).toMatchSnapshot();
  });

  it("matches snapshot with logoUrl", () => {
    expect(render({ ...baseProps, logoUrl: LOGO })).toMatchSnapshot();
  });

  it("renders the accroche with the restaurant name (PRD §4.7)", () => {
    const tree = render(baseProps);
    const all = texts(tree).join(" ");
    expect(all).toMatch(/Scannez pour commander direct chez/i);
    expect(all).toContain(NAME);
  });

  it("renders the PWA URL en clair (fallback texte)", () => {
    expect(texts(render(baseProps)).join(" ")).toContain(PWA);
  });

  it("renders the logo Image when logoUrl is provided, omits it otherwise", () => {
    expect(imageSources(render(baseProps))).toEqual([QR]); // QR only
    expect(imageSources(render({ ...baseProps, logoUrl: LOGO }))).toEqual(
      expect.arrayContaining([QR, LOGO]),
    );
  });

  it("applies primaryColor as an accent (somewhere in the tree props)", () => {
    // The exact element wearing the colour is a layout detail (bandeau, text
    // colour, divider). We assert that the colour string surfaces *somewhere*
    // — the snapshot pins *where*. This guards against a refactor silently
    // dropping branding while keeping the test layout-implementation-agnostic.
    const tree = render(baseProps);
    const json = JSON.stringify(tree);
    expect(json).toContain(COLOR);
  });
});

describe("QrPdfDocument — a4-poster", () => {
  const baseProps: QrPdfDocumentProps = {
    pwaUrl: PWA,
    qrDataUrl: QR,
    restoName: NAME,
    primaryColor: COLOR,
    format: "a4-poster",
  };

  it("matches snapshot without logoUrl", () => {
    expect(render(baseProps)).toMatchSnapshot();
  });

  it("matches snapshot with logoUrl", () => {
    expect(render({ ...baseProps, logoUrl: LOGO })).toMatchSnapshot();
  });

  it("renders the accroche with the restaurant name (PRD §4.7)", () => {
    const tree = render(baseProps);
    const all = texts(tree).join(" ");
    expect(all).toMatch(/Scannez pour commander direct chez/i);
    expect(all).toContain(NAME);
  });

  it("renders the PWA URL en clair (fallback texte)", () => {
    expect(texts(render(baseProps)).join(" ")).toContain(PWA);
  });

  it("renders the logo Image when logoUrl is provided, omits it otherwise", () => {
    expect(imageSources(render(baseProps))).toEqual([QR]);
    expect(imageSources(render({ ...baseProps, logoUrl: LOGO }))).toEqual(
      expect.arrayContaining([QR, LOGO]),
    );
  });

  it("applies primaryColor as an accent bandeau (somewhere in the tree props)", () => {
    const tree = render({ ...baseProps });
    expect(JSON.stringify(tree)).toContain(COLOR);
  });
});

describe("QrPdfDocument — branding fallbacks", () => {
  it("renders without primaryColor (no branding accent) without crashing", () => {
    const tree = render({
      pwaUrl: PWA,
      qrDataUrl: QR,
      restoName: NAME,
      format: "a4-poster",
    });
    // QR still there even without branding.
    expect(imageSources(tree)).toContain(QR);
  });
});
