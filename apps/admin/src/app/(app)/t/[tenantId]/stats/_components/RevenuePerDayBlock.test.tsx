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

  it("populated branch surfaces a Recharts LineChart node", () => {
    const tree = serialize(
      RevenuePerDayBlock({
        range: 30,
        revenuePerDay: [
          { date: "2026-05-01", revenue: 1000 },
          { date: "2026-05-02", revenue: 2000 },
        ],
      }),
    );
    // Recharts component names are stable: LineChart / Line / XAxis / YAxis / Tooltip.
    expect(hasNodeOfType(tree, "LineChart")).toBe(true);
    expect(hasNodeOfType(tree, "Line")).toBe(true);
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
