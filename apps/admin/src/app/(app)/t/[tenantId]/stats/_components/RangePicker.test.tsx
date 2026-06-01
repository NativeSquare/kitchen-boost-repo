/**
 * F-STATS-DASHBOARD [3/8] (#253) — `RangePicker` component tests.
 *
 * The picker is a pure presentational toggle with 3 options (7 / 30 / 90 jours).
 * It exposes the selected value via `onChange(value: RangeDays)`. No hook
 * usage, no Convex import — testable under `environment: "node"`.
 *
 * Pins :
 *   - the 3 option labels surface ;
 *   - the selected value is highlighted via `aria-pressed` (or `data-state`)
 *     on the matching button — so a future a11y audit can rely on it.
 *   - clicking a button invokes `onChange` with the right value.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { RangePicker } from "./RangePicker";

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

describe("RangePicker — F-STATS-DASHBOARD [3/8] (#253)", () => {
  it("renders the 3 FR labels 7 / 30 / 90 jours", () => {
    const text = allText(
      serialize(RangePicker({ value: 30, onChange: () => {} })),
    );
    expect(text).toMatch(/7 jours/);
    expect(text).toMatch(/30 jours/);
    expect(text).toMatch(/90 jours/);
  });

  it("marks the current value via data-state='on' (toggle-group convention)", () => {
    const tree = serialize(RangePicker({ value: 30, onChange: () => {} }));
    const buttons = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      } =>
        n !== null &&
        !("text" in n) &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "range-picker-option",
    );
    expect(buttons.length).toBe(3);
    const selected = buttons.find(
      (b) => (b.props as Record<string, unknown>)["data-state"] === "on",
    );
    if (selected === undefined) {
      throw new Error("expected a selected option, found none");
    }
    expect((selected.props as Record<string, unknown>).value).toBe("30");
  });

  it("invokes onChange with the new RangeDays when an option is clicked", () => {
    const onChange = vi.fn();
    const tree = serialize(RangePicker({ value: 30, onChange }));
    const buttons = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      } =>
        n !== null &&
        !("text" in n) &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "range-picker-option",
    );
    const sevenDays = buttons.find(
      (b) => (b.props as Record<string, unknown>).value === "7",
    );
    if (sevenDays === undefined) {
      throw new Error("expected the « 7 jours » option, found none");
    }
    const onClick = (sevenDays.props as Record<string, unknown>).onClick as
      | (() => void)
      | undefined;
    if (typeof onClick !== "function") {
      throw new Error("expected an onClick handler on the option");
    }
    onClick();
    expect(onChange).toHaveBeenCalledWith(7);
  });
});
