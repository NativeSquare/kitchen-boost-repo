/**
 * F-STATS-DASHBOARD [4/8] (#257) — `RevenuePerDayBlock`, the LineChart Recharts
 * card surfacing `revenuePerDay({ rangeDays })` on the stats page.
 *
 * Same React-tree-serializer pattern as `stats-view.test.tsx` — apps/admin
 * vitest runs `environment: "node"` (no jsdom, no RTL).
 *
 * Pins :
 *   - the card title « Revenus par jour » ;
 *   - tri-state behaviour : undefined → skeleton (loading), [] → empty FR
 *     message, [...] → LineChart node ;
 *   - the populated branch surfaces a Recharts LineChart node ;
 *   - the empty FR message exact wording ;
 *   - we DO NOT call useTenantQuery here (the page owns the hook) — the block
 *     receives `revenuePerDay` as a prop.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { RevenuePerDayBlock } from "./RevenuePerDayBlock";

// ---------------------------------------------------------------------------
// React-tree serializer (same shape as `stats-view.test.tsx`).
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
  // forwardRef / memo: the component is an OBJECT carrying displayName, plus
  // potentially a `render` (forwardRef) or `type` (memo) function we can dig
  // into for a fallback name.
  if (typeof t === "object" && t !== null) {
    const obj = t as {
      displayName?: string;
      render?: { displayName?: string; name?: string };
      type?: { displayName?: string; name?: string };
    };
    if (typeof obj.displayName === "string") return obj.displayName;
    if (obj.render !== undefined) {
      return obj.render.displayName ?? obj.render.name ?? "Anonymous";
    }
    if (obj.type !== undefined) {
      return obj.type.displayName ?? obj.type.name ?? "Anonymous";
    }
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

function hasNodeOfType(n: SerializedNode, name: string): boolean {
  return flatten(n).some(
    (x) => x !== null && !("text" in x) && x.type === name,
  );
}

function hasSlot(n: SerializedNode, slot: string): boolean {
  return flatten(n).some((x) => {
    if (x === null || "text" in x) return false;
    return (x.props as Record<string, unknown>)["data-slot"] === slot;
  });
}

/**
 * Walk the RAW React element tree (no function-pointer-render) and return
 * `true` iff any descendant element's `type` resolves to a component whose
 * `displayName`/`name` matches `name`. Used to assert the presence of
 * Recharts components (`LineChart`, `Line`, ...) which the serializer can't
 * descend into (they use hooks that throw under `environment: "node"`).
 */
function containsTypeByName(node: ReactNode, name: string): boolean {
  if (node === null || node === undefined || node === false || node === true) {
    return false;
  }
  if (typeof node === "string" || typeof node === "number") return false;
  if (Array.isArray(node)) {
    return node.some((c) => containsTypeByName(c, name));
  }
  if (!isReactElement(node)) return false;
  if (typeName(node.type) === name) return true;
  const children = (node.props as { children?: ReactNode } | null)?.children;
  return containsTypeByName(children ?? null, name);
}

describe("RevenuePerDayBlock — F-STATS-DASHBOARD [4/8] (#257)", () => {
  it("renders the card title « Revenus par jour » on the populated branch", () => {
    const text = allText(
      serialize(
        RevenuePerDayBlock({
          range: 30,
          revenuePerDay: [
            { date: "2026-05-01", revenue: 1000 },
            { date: "2026-05-02", revenue: 0 },
          ],
        }),
      ),
    );
    expect(text).toMatch(/Revenus par jour/);
  });

  it("loading branch (revenuePerDay === undefined) surfaces a skeleton", () => {
    const tree = serialize(
      RevenuePerDayBlock({
        range: 30,
        revenuePerDay: undefined,
      }),
    );
    expect(hasSlot(tree, "skeleton")).toBe(true);
  });

  it("empty branch (revenuePerDay === []) surfaces FR empty state message", () => {
    const text = allText(
      serialize(
        RevenuePerDayBlock({
          range: 30,
          revenuePerDay: [],
        }),
      ),
    );
    expect(text).toMatch(/Pas encore de données sur cette période/);
  });

  it("populated branch surfaces a Recharts LineChart node (carried inside ResponsiveContainer)", () => {
    // Recharts internals (ResponsiveContainer, LineChart) call hooks at
    // function-component render time, which our function-pointer-render
    // serializer bails out on. We inspect the RAW React element tree returned
    // by `RevenuePerDayBlock(...)` BEFORE serializing — that tree carries
    // `<LineChart>` as a child of `<ResponsiveContainer>` and is enough to
    // pin the contract (we use the Recharts component identity, not a
    // rendered DOM node).
    const element = RevenuePerDayBlock({
      range: 30,
      revenuePerDay: [
        { date: "2026-05-01", revenue: 1000 },
        { date: "2026-05-02", revenue: 2000 },
      ],
    });
    expect(containsTypeByName(element, "LineChart")).toBe(true);
    expect(containsTypeByName(element, "Line")).toBe(true);
  });

  it('populated branch carries the canonical card slot (data-slot="revenue-per-day")', () => {
    const tree = serialize(
      RevenuePerDayBlock({
        range: 30,
        revenuePerDay: [{ date: "2026-05-01", revenue: 1000 }],
      }),
    );
    expect(hasSlot(tree, "revenue-per-day")).toBe(true);
  });
});
