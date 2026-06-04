/**
 * F-COMMANDES-FILTERS (#238) — `OrdersFilters` test contract.
 *
 * Fully-controlled component (no internal state — same discipline as the
 * sibling editors). It renders:
 *  - 4 date range buttons (« Aujourd'hui » / « 7 jours » / « 30 jours » /
 *    « Tout ») — the currently selected one is `data-active="true"`;
 *  - a status multi-select with the 8 values of the `orderStatus` validator
 *    (imported from `orders-filtering.ts` so a future status addition surfaces
 *    here loudly instead of being silently dropped from the filter).
 *
 * AC pinned here (#238):
 *  - 4 date buttons render with their copy and their `data-slot` markers.
 *  - The "active" button (per `value.dateRange`) is marked `data-active="true"`.
 *  - Clicking a date button invokes `onDateRangeChange(<key>)` with the key
 *    of the clicked button.
 *  - The multi-select surfaces every status from `ALL_ORDER_STATUSES` (8 of
 *    them) — no status is hard-coded inside this file, the list comes from
 *    the validator-derived constant.
 *  - A status item that's IN `value.statuses` renders `data-active="true"`;
 *    NOT in the set renders `data-active="false"`.
 *  - Clicking a status item NOT in the set → `onStatusesChange` is invoked
 *    with the set + that status (toggle ON).
 *  - Clicking a status item IN the set → `onStatusesChange` is invoked with
 *    the set without that status (toggle OFF).
 *
 * The view is fully controlled — never holds local state, never calls
 * `setState`. This means the page (which owns `useState` per EPIC #141) is
 * the single source of truth, and a live Convex push re-runs the filter
 * predicate against the same state without any extra plumbing.
 *
 * Same React-tree-serializer pattern as `commandes-view.test.tsx` /
 * `orders-table.test.tsx`. `apps/admin/vitest.config.ts` runs in
 * `environment: "node"` (no jsdom, no RTL).
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { OrdersFilters } from "./orders-filters";
import {
  ALL_ORDER_STATUSES,
  type DateRangeKey,
  type OrderStatus,
} from "./orders-filtering";

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
  return flatten(n).filter(
    (x) => x !== null && !("text" in x) && x.props["data-slot"] === slot,
  );
}

function dataSlots(n: SerializedNode): string[] {
  return flatten(n)
    .map((x) => {
      if (x === null || "text" in x) return null;
      const ds = x.props["data-slot"];
      return typeof ds === "string" ? ds : null;
    })
    .filter((s): s is string => s !== null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OrdersFilters — F-COMMANDES-FILTERS (#238)", () => {
  describe("date range buttons", () => {
    it("renders the 4 documented date range buttons", () => {
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: [] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const slots = dataSlots(tree);
      expect(slots).toContain("orders-filters-date-today");
      expect(slots).toContain("orders-filters-date-7d");
      expect(slots).toContain("orders-filters-date-30d");
      expect(slots).toContain("orders-filters-date-tout");
    });

    it("renders the French copy for each date button", () => {
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: [] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const text = allText(tree);
      expect(text).toMatch(/Aujourd'hui/);
      expect(text).toMatch(/7 jours/);
      expect(text).toMatch(/30 jours/);
      expect(text).toMatch(/Tout/);
    });

    it("marks the currently selected date range with data-active='true'", () => {
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "7d", statuses: [] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const sevenDay = findBySlot(tree, "orders-filters-date-7d")[0];
      const today = findBySlot(tree, "orders-filters-date-today")[0];
      const tout = findBySlot(tree, "orders-filters-date-tout")[0];
      expect(
        sevenDay && !("text" in sevenDay) && sevenDay.props["data-active"],
      ).toBe("true");
      expect(today && !("text" in today) && today.props["data-active"]).toBe(
        "false",
      );
      expect(tout && !("text" in tout) && tout.props["data-active"]).toBe(
        "false",
      );
    });

    it("calls onDateRangeChange with the clicked key", () => {
      const onDateRangeChange = vi.fn();
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: [] },
          onDateRangeChange,
          onStatusesChange: () => {},
        }),
      );
      const today = findBySlot(tree, "orders-filters-date-today")[0];
      expect(today).toBeDefined();
      if (!today || "text" in today) throw new Error("today button missing");
      const onClick = today.props["onClick"];
      expect(typeof onClick).toBe("function");
      (onClick as () => void)();
      expect(onDateRangeChange).toHaveBeenCalledWith("today");

      const sevenDay = findBySlot(tree, "orders-filters-date-7d")[0];
      if (!sevenDay || "text" in sevenDay) throw new Error("7d button missing");
      (sevenDay.props["onClick"] as () => void)();
      expect(onDateRangeChange).toHaveBeenCalledWith("7d");
    });
  });

  describe("status multi-select", () => {
    it("renders one item per documented status (9 total — #415 adds auto_expired)", () => {
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: [] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const items = findBySlot(tree, "orders-filters-status-item");
      expect(items.length).toBe(ALL_ORDER_STATUSES.length);
      expect(items.length).toBe(9);
    });

    it("surfaces the literal status text for every status (PRD 20 vocabulary)", () => {
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: [] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const text = allText(tree);
      for (const status of ALL_ORDER_STATUSES) {
        expect(text).toMatch(
          new RegExp(status.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
      }
    });

    it("marks a status data-active='true' if present in value.statuses", () => {
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: ["nouvelle", "refusée"] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const items = findBySlot(tree, "orders-filters-status-item");
      const byStatus = new Map<string, Record<string, unknown>>();
      for (const item of items) {
        if (!item || "text" in item) continue;
        const status = item.props["data-status"];
        if (typeof status === "string") byStatus.set(status, item.props);
      }
      expect(byStatus.get("nouvelle")?.["data-active"]).toBe("true");
      expect(byStatus.get("refusée")?.["data-active"]).toBe("true");
      expect(byStatus.get("livrée")?.["data-active"]).toBe("false");
      expect(byStatus.get("en préparation")?.["data-active"]).toBe("false");
    });

    it("clicking a status NOT in the set toggles it ON (calls onStatusesChange with the set + status)", () => {
      const onStatusesChange = vi.fn();
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: ["nouvelle"] },
          onDateRangeChange: () => {},
          onStatusesChange,
        }),
      );
      const items = findBySlot(tree, "orders-filters-status-item");
      const livreeItem = items.find(
        (x) =>
          x !== null && !("text" in x) && x.props["data-status"] === "livrée",
      );
      if (!livreeItem || "text" in livreeItem)
        throw new Error("livrée item missing");
      (livreeItem.props["onClick"] as () => void)();
      expect(onStatusesChange).toHaveBeenCalledTimes(1);
      const arg = onStatusesChange.mock.calls[0]?.[0] as OrderStatus[];
      expect(arg).toContain("nouvelle");
      expect(arg).toContain("livrée");
      expect(arg.length).toBe(2);
    });

    it("clicking a status IN the set toggles it OFF (calls onStatusesChange with the set without it)", () => {
      const onStatusesChange = vi.fn();
      const tree = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: ["nouvelle", "refusée"] },
          onDateRangeChange: () => {},
          onStatusesChange,
        }),
      );
      const items = findBySlot(tree, "orders-filters-status-item");
      const refuseeItem = items.find(
        (x) =>
          x !== null && !("text" in x) && x.props["data-status"] === "refusée",
      );
      if (!refuseeItem || "text" in refuseeItem)
        throw new Error("refusée item missing");
      (refuseeItem.props["onClick"] as () => void)();
      expect(onStatusesChange).toHaveBeenCalledTimes(1);
      const arg = onStatusesChange.mock.calls[0]?.[0] as OrderStatus[];
      expect(arg).toEqual(["nouvelle"]);
    });
  });

  describe("component is fully controlled (no internal state)", () => {
    it("re-renders with new value props without losing track of the active state", () => {
      // First render: 'tout' active.
      const tree1 = serialize(
        OrdersFilters({
          value: { dateRange: "tout", statuses: [] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const tout1 = findBySlot(tree1, "orders-filters-date-tout")[0];
      if (!tout1 || "text" in tout1) throw new Error("tout button missing");
      expect(tout1.props["data-active"]).toBe("true");

      // Second render with a different value prop: 'today' active, 'tout' inactive.
      const tree2 = serialize(
        OrdersFilters({
          value: { dateRange: "today", statuses: [] },
          onDateRangeChange: () => {},
          onStatusesChange: () => {},
        }),
      );
      const today2 = findBySlot(tree2, "orders-filters-date-today")[0];
      const tout2 = findBySlot(tree2, "orders-filters-date-tout")[0];
      if (!today2 || "text" in today2) throw new Error("today button missing");
      if (!tout2 || "text" in tout2) throw new Error("tout button missing");
      expect(today2.props["data-active"]).toBe("true");
      expect(tout2.props["data-active"]).toBe("false");
    });
  });
});
