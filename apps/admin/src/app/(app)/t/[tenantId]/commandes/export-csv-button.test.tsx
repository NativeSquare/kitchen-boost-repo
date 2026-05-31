/**
 * F-COMMANDES-CSV-EXPORT (#244) — `ExportCsvButton`, the small controlled
 * button mounted in the page header that triggers the CSV download.
 *
 * Fully controlled (no internal state, no `useState`):
 *  - `onClick` fires when the gérant clicks the button — the page owns the
 *    handler (it knows the filtered orders + the tenant slug).
 *  - `disabled` is set by the page when there are no orders to export
 *    (`orders === undefined` or `orders.length === 0`) — clicking a disabled
 *    button does nothing (the page would otherwise emit an empty-data CSV
 *    that's confusing for the comptable).
 *
 * Why a dedicated component (not inline `<button>` in `commandes-view.tsx`):
 *  - The button + its disabled / label / data-slot contract are pinned by
 *    this file independent of the view's data branches.
 *  - Reusable from a hypothetical future surface (V2 keyboard shortcut, V2
 *    scheduled email).
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { ExportCsvButton } from "./export-csv-button";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as sibling view tests.
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
      try {
        return serialize(fn(node.props));
      } catch {
        return { type: typeName(node.type), props: {}, children: [] };
      }
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

function findBySlot(n: SerializedNode, slot: string): SerializedNode[] {
  return flatten(n).filter(
    (x) => x !== null && !("text" in x) && x.props["data-slot"] === slot,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ExportCsvButton — F-COMMANDES-CSV-EXPORT (#244)", () => {
  it("renders a button with the « Exporter CSV » label", () => {
    const tree = serialize(
      ExportCsvButton({ onClick: () => {}, disabled: false }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Exporter CSV/);
  });

  it("carries the `export-csv-button` data-slot so the view test can find it", () => {
    const tree = serialize(
      ExportCsvButton({ onClick: () => {}, disabled: false }),
    );
    const found = findBySlot(tree, "export-csv-button");
    expect(found.length).toBeGreaterThan(0);
  });

  it("calls `onClick` when the underlying button is activated", () => {
    const onClick = vi.fn();
    const tree = serialize(ExportCsvButton({ onClick, disabled: false }));
    const node = findBySlot(tree, "export-csv-button")[0];
    if (!node || "text" in node) throw new Error("button missing in tree");
    const click = node.props.onClick as (() => void) | undefined;
    expect(typeof click).toBe("function");
    click?.();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders disabled when `disabled` is true (no orders to export)", () => {
    const tree = serialize(
      ExportCsvButton({ onClick: () => {}, disabled: true }),
    );
    const node = findBySlot(tree, "export-csv-button")[0];
    if (!node || "text" in node) throw new Error("button missing");
    expect(node.props.disabled).toBe(true);
  });
});
