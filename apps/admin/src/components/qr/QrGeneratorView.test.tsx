/**
 * F-QR.3 (#182) — `QrGeneratorView` : the consumer-facing orchestrator that
 * wires `buildQrPdfBlob` (post-jspdf migration of #173) and
 * `generateQrDataUrl` (#167) into a usable surface (format selector +
 * preview + download + regenerate).
 *
 * Why a tree snapshot + per-AC assertions, not RTL?
 * -------------------------------------------------
 * `apps/admin/vitest.config.ts` runs vitest with `environment: "node"` — no
 * jsdom, no `@testing-library/react`. We reuse the same pure React-tree-
 * serializer pattern already used elsewhere in the codebase so the
 * assertions stay within the lean node env.
 *
 * The mounted view builds the PDF synchronously (`buildQrPdfBlob`, jspdf)
 * and exposes it via an object URL — `<iframe src={blobUrl} />` for preview
 * and `<a href={blobUrl} download />` for download. Both depend on the
 * browser `URL.createObjectURL` API; we cannot exercise the async pipeline
 * from vitest-node, so we pin the static surface (the sub-component
 * `QrGeneratorControls`) only. The mounted view is exercised by manual E2E.
 *
 * History — the original version of this test pinned, by source-level regex
 * inspection, that `@react-pdf/renderer` was loaded via `next/dynamic({
 * ssr: false })`. The migration to `jspdf` made both checks obsolete: the
 * PDF lib no longer needs lazy-loading (jspdf is small + browser-only at
 * the API surface anyway), so we dropped that assertion. The companion
 * test `QrPdfDocument.test.ts` now pins the layout planner directly.
 *
 * Acceptance criteria covered (#182):
 *   - AC: « Selector des 3 formats fonctionnel » — assert the three options
 *     (sticker-50mm, a6-card, a4-poster) are present in the rendered tree,
 *     with `sticker-50mm` selected by default.
 *   - AC: « Bouton "Régénérer" présent et cliquable » — assert a button with
 *     a /R[ée]g[ée]n[ée]rer/ accessible name is rendered and not disabled.
 *   - AC: contract typing — the public `QrGeneratorViewProps` type stays the
 *     one declared in the issue body, enforced by a compile-time
 *     `satisfies` check below.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import {
  QrGeneratorControls,
  type QrGeneratorControlsProps,
} from "./QrGeneratorView";
import type { QrGeneratorViewProps } from "./QrGeneratorView";
import type { QrPdfFormat } from "./QrPdfDocument";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as QrPdfDocument.test.tsx (trimmed).
// ---------------------------------------------------------------------------
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
    return {
      type: "ArrayFragment",
      props: {},
      children: node
        .map((c) => serialize(c))
        .filter((c): c is SerializedNode => c !== null),
    };
  }
  if (isReactElement(node)) {
    if (typeof node.type === "function") {
      const fn = node.type as (p: unknown) => ReactNode;
      return serialize(fn(node.props));
    }
    const props = { ...(node.props as Record<string, unknown>) };
    const rawChildren = props.children as ReactNode | undefined;
    delete props.children;
    const children: SerializedNode[] = [];
    if (rawChildren !== undefined) {
      const list = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
      for (const c of list) {
        const s = serialize(c);
        if (s !== null) children.push(s);
      }
    }
    return { type: typeName(node.type), props, children };
  }
  return null;
}

function flatten(n: SerializedNode): SerializedNode[] {
  if (n === null) return [];
  if ("text" in n) return [n];
  return [n, ...n.children.flatMap(flatten)];
}

function allText(n: SerializedNode): string {
  return flatten(n)
    .map((x) => (x && "text" in x ? x.text : null))
    .filter((x): x is string => x !== null)
    .join(" ");
}

function findAllByType(n: SerializedNode, type: string): SerializedNode[] {
  return flatten(n).filter(
    (
      x,
    ): x is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    } => x !== null && "type" in x && x.type === type,
  );
}

// ---------------------------------------------------------------------------
// `QrGeneratorControls` — pure sub-component (selector + regenerate button)
// ---------------------------------------------------------------------------
describe("QrGeneratorControls — F-QR.3 (#182)", () => {
  function render(overrides: Partial<QrGeneratorControlsProps> = {}) {
    const props: QrGeneratorControlsProps = {
      format: "sticker-50mm",
      onFormatChange: () => {},
      onRegenerate: () => {},
      isRegenerating: false,
      ...overrides,
    };
    return serialize(QrGeneratorControls(props));
  }

  it("renders without crashing and returns a non-null tree", () => {
    expect(render()).not.toBeNull();
  });

  it("renders a <select> with the THREE V1 formats (sticker-50mm, a6-card, a4-poster)", () => {
    const tree = render();
    const options = findAllByType(tree, "option");
    const values = options
      .map((o) => (o && "props" in o ? (o.props.value as string) : null))
      .filter((v): v is string => v !== null);
    expect(values).toEqual(["sticker-50mm", "a6-card", "a4-poster"]);
  });

  it("reflects the `format` prop on the <select> `value` attribute", () => {
    const tree = render({ format: "a6-card" });
    const selects = findAllByType(tree, "select");
    expect(selects).toHaveLength(1);
    const [sel] = selects;
    expect((sel as { props: Record<string, unknown> }).props.value).toBe(
      "a6-card",
    );
  });

  it("wires the <select> `onChange` to the `onFormatChange` prop (typed QrPdfFormat)", () => {
    // We don't simulate a DOM event (no jsdom); we assert the handler chain by
    // calling the `onChange` the component installs with a synthetic event
    // object shaped like a React ChangeEvent. This pins the contract: the
    // selector must forward the chosen value as a typed `QrPdfFormat`.
    let received: QrPdfFormat | null = null;
    const tree = render({
      onFormatChange: (f) => {
        received = f;
      },
    });
    const select = findAllByType(tree, "select")[0] as
      | { props: { onChange?: (e: { target: { value: string } }) => void } }
      | undefined;
    expect(select?.props.onChange).toBeTypeOf("function");
    select?.props.onChange?.({ target: { value: "a4-poster" } });
    expect(received).toBe("a4-poster");
  });

  it("renders a « Régénérer » button wired to `onRegenerate`, not disabled by default", () => {
    let clicked = false;
    const tree = render({
      onRegenerate: () => {
        clicked = true;
      },
    });
    const buttons = findAllByType(tree, "button");
    // At least one button labeled "Régénérer" / "Regenerer" (we accept either
    // spelling so a future copy polish doesn't break the test, but the label
    // must surface visibly).
    const text = allText(tree);
    expect(text).toMatch(/R[ée]g[ée]n[ée]rer/);
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    // The regenerate button is the one whose onClick triggers onRegenerate.
    const regen = buttons.find(
      (b) =>
        b !== null &&
        "props" in b &&
        typeof (b.props as { onClick?: unknown }).onClick === "function",
    ) as { props: { onClick: () => void; disabled?: boolean } } | undefined;
    expect(regen).toBeDefined();
    expect(regen?.props.disabled).not.toBe(true);
    regen?.props.onClick();
    expect(clicked).toBe(true);
  });

  it("disables the « Régénérer » button when `isRegenerating` is true (no double-click)", () => {
    const tree = render({ isRegenerating: true });
    const buttons = findAllByType(tree, "button") as Array<{
      props: { onClick?: () => void; disabled?: boolean };
    }>;
    const regen = buttons.find((b) => typeof b.props.onClick === "function");
    expect(regen?.props.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `QrGeneratorView` — module-level contracts (type)
// ---------------------------------------------------------------------------
describe("QrGeneratorView — module contract (#182)", () => {
  it("exposes the public props type promised by the issue body", () => {
    // Compile-time check: a value-shape matching the issue contract must be
    // assignable to QrGeneratorViewProps. If a future refactor renames or
    // removes a prop, `tsc --noEmit` (run as part of `pnpm typecheck`) fails.
    const _propsLike = {
      pwaUrl: "https://lartisan.kitchen-boost.fr",
      restoName: "L'Artisan",
      logoUrl: "https://cdn.example.com/lartisan/logo.png",
      primaryColor: "#1B7A3D",
    } satisfies QrGeneratorViewProps;
    void _propsLike;
    // Runtime sanity: the props type description is exported (just touch it).
    expect(true).toBe(true);
  });
});
