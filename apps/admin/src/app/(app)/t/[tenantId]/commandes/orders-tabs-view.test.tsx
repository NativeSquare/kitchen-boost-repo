/**
 * #415 — `OrdersTabsView` test contract.
 *
 * Fully-controlled component (no internal state — same discipline as
 * `OrdersFilters`). It renders:
 *  - 4 tab pills (« Toutes » / « Livrées / Collectées » / « Refusées » /
 *    « Manquées »); the active one carries `data-active="true"`.
 *  - An order id search input that fires `onSearchChange` on every
 *    keystroke.
 *
 * AC pinned here (#415):
 *  - 4 tabs render with their copy and their `data-slot` markers.
 *  - The active tab is `data-active="true"`; the others are `"false"`.
 *  - Clicking a tab fires `onTabChange(<key>)`.
 *  - The search input reflects `value` and fires `onSearchChange` on
 *    every change with the new string.
 *  - The placeholder copy mentions « ID commande » (so the gérant
 *    understands they search by id, NOT name — MOAT discipline).
 *
 * Same React-tree-serializer pattern as `orders-filters.test.tsx`,
 * `commandes-view.test.tsx`. `apps/admin/vitest.config.ts` runs in
 * `environment: "node"` (no jsdom, no RTL).
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { OrdersTabsView } from "./orders-tabs-view";
import { ORDER_TABS, type OrderTabKey } from "./orders-tabs";

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as sibling view tests.
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
  return flatten(n).filter((x) => {
    if (x === null || "text" in x) return false;
    return x.props["data-slot"] === slot;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OrdersTabsView — tab pills", () => {
  it("renders one pill per ORDER_TABS entry (4 total)", () => {
    const tree = serialize(
      OrdersTabsView({
        tab: "all",
        onTabChange: () => {},
        search: "",
        onSearchChange: () => {},
      }),
    );
    for (const t of ORDER_TABS) {
      const pills = findBySlot(tree, `orders-tab-${t.key}`);
      expect(pills.length).toBe(1);
    }
  });

  it("surfaces the literal label of every tab (PRD 20 §8 vocabulary)", () => {
    const tree = serialize(
      OrdersTabsView({
        tab: "all",
        onTabChange: () => {},
        search: "",
        onSearchChange: () => {},
      }),
    );
    const text = allText(tree);
    for (const t of ORDER_TABS) {
      expect(text).toContain(t.label);
    }
    // The load-bearing word from #415 — the « Manquées » tab is the whole
    // point of this story (vs the generic « refusée » bucket).
    expect(text).toContain("Manquées");
  });

  it('marks the active tab `data-active="true"` and the others `"false"`', () => {
    const tree = serialize(
      OrdersTabsView({
        tab: "missed",
        onTabChange: () => {},
        search: "",
        onSearchChange: () => {},
      }),
    );
    for (const t of ORDER_TABS) {
      const [pill] = findBySlot(tree, `orders-tab-${t.key}`);
      if (pill === undefined || pill === null || "text" in pill) {
        throw new Error(`tab ${t.key} missing`);
      }
      expect(pill.props["data-active"]).toBe(
        t.key === "missed" ? "true" : "false",
      );
    }
  });

  it("invokes `onTabChange` with the clicked tab key", () => {
    const onTabChange = vi.fn();
    const tree = serialize(
      OrdersTabsView({
        tab: "all",
        onTabChange,
        search: "",
        onSearchChange: () => {},
      }),
    );
    const tab: OrderTabKey = "missed";
    const [pill] = findBySlot(tree, `orders-tab-${tab}`);
    if (pill === undefined || pill === null || "text" in pill) {
      throw new Error("Manquées tab missing");
    }
    (pill.props["onClick"] as () => void)();
    expect(onTabChange).toHaveBeenCalledWith("missed");
  });
});

describe("OrdersTabsView — order id search input", () => {
  it("renders the input with the controlled value and an explicit aria-label / placeholder", () => {
    const tree = serialize(
      OrdersTabsView({
        tab: "all",
        onTabChange: () => {},
        search: "orders_xyz",
        onSearchChange: () => {},
      }),
    );
    const [input] = findBySlot(tree, "orders-search-input");
    if (input === undefined || input === null || "text" in input) {
      throw new Error("search input missing");
    }
    expect(input.props["value"]).toBe("orders_xyz");
    // « ID commande » is the load-bearing label — it tells the gérant the
    // search is BY ID (MOAT: no customer name search, ADR 0010 / PRD 70 §4.4).
    expect(input.props["placeholder"]).toMatch(/ID commande/i);
    expect(input.props["aria-label"]).toMatch(/ID commande/i);
  });

  it("fires `onSearchChange` with the new string on input change", () => {
    const onSearchChange = vi.fn();
    const tree = serialize(
      OrdersTabsView({
        tab: "all",
        onTabChange: () => {},
        search: "",
        onSearchChange,
      }),
    );
    const [input] = findBySlot(tree, "orders-search-input");
    if (input === undefined || input === null || "text" in input) {
      throw new Error("search input missing");
    }
    const onChange = input.props["onChange"] as (e: {
      target: { value: string };
    }) => void;
    onChange({ target: { value: "orders_abc" } });
    expect(onSearchChange).toHaveBeenCalledWith("orders_abc");
  });
});
