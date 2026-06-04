/**
 * F-COMMANDES-PAGE-SHELL (#222) + F-COMMANDES-LIVE-TABLE (#227) —
 * `CommandesView`, the presentational shell of the tenant Commandes page.
 *
 * Slice 1 (#222) shipped only the header + a placeholder card. Slice 2 (#227,
 * THIS file's contract) replaces the placeholder with a live `OrdersTable`
 * branched on the result of `useTenantQuery(api.lib.orders.orders.listOrders)`
 * (which the page owns). The view stays a pure function of its props: it
 * takes `orders: Doc<"orders">[] | undefined` and forwards it to the table —
 * the three branches (loading / empty / populated) live in `OrdersTable` and
 * are pinned by `orders-table.test.tsx`.
 *
 * The header (« Commandes ») is ALWAYS rendered, regardless of the data
 * branch — same chrome-doesn't-flash discipline as `MenuView` /
 * `MesClientsView` (the page title is the operator's anchor across the
 * loading → populated transition).
 *
 * The slice-1 « La liste arrive dans le prochain slice » placeholder is
 * GONE — the table is now wired. We pin its absence so a future regression
 * (e.g. an accidental revert of `commandes-view.tsx`) fails loudly inside
 * this slice's suite.
 *
 * Acceptance criteria pinned here (#227):
 *   - AC1 « Module `orders-table` rend une table HTML sémantique avec les 4
 *     colonnes » → the view delegates to `OrdersTable` (pinned via a slot
 *     marker) and the table's contract is pinned by `orders-table.test.tsx`.
 *   - The header « Commandes » still surfaces on every render branch.
 *
 * Same React-tree-serializer pattern as `menu-view.test.tsx` /
 * `mes-clients-view.test.tsx`. `apps/admin/vitest.config.ts` runs in
 * `environment: "node"`.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { CommandesView } from "./commandes-view";
import { ALL_ORDER_STATUSES } from "./orders-filtering";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as the sibling view tests.
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
// Fixtures
// ---------------------------------------------------------------------------
const TENANT = "tenants_fixture" as unknown as Id<"tenants">;
const CUSTOMER = "customers_fixture" as unknown as Id<"customers">;

function order(
  partial: Partial<Omit<Doc<"orders">, "_id">> & {
    _id: string;
    createdAt: number;
  },
): Doc<"orders"> {
  const { _id, createdAt, ...rest } = partial;
  return {
    _id: _id as unknown as Id<"orders">,
    _creationTime: createdAt,
    tenantId: TENANT,
    customerId: CUSTOMER,
    status: "nouvelle",
    mode: "delivery",
    source: "direct",
    createdAt,
    ...rest,
  } as Doc<"orders">;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Default props builder — slice 3 (#238) added the filter props; sibling
// branches of the test suite that only care about the data branches reuse
// this so they don't have to repeat the four filter-related fields.
// ---------------------------------------------------------------------------
const NOOP = () => {};
function defaults(orders: Doc<"orders">[] | undefined) {
  return {
    orders,
    filter: { dateRange: "tout" as const, statuses: [] },
    onDateRangeChange: NOOP,
    onStatusesChange: NOOP,
    // F-COMMANDES-DETAIL-MODAL (#239) — the view now forwards a row-click
    // handler to `OrdersTable`. Test branches that don't exercise the
    // click reuse a no-op here.
    onOrderClick: NOOP,
    // F-COMMANDES-CSV-EXPORT (#244) — the view now mounts an « Exporter
    // CSV » button in the header. Test branches that don't exercise the
    // export reuse a no-op here.
    onExportCsv: NOOP,
    // #415 — the view now mounts the 4 tabs + the order id search input.
    // Test branches that don't exercise them reuse no-ops + the default tab.
    tab: "all" as const,
    onTabChange: NOOP,
    search: "",
    onSearchChange: NOOP,
  };
}

describe("CommandesView — F-COMMANDES-LIVE-TABLE (#227)", () => {
  it("AC — surfaces the page title « Commandes » on every branch (header doesn't flash)", () => {
    // Loading branch
    expect(allText(serialize(CommandesView(defaults(undefined))))).toMatch(
      /Commandes/,
    );
    // Empty branch
    expect(allText(serialize(CommandesView(defaults([]))))).toMatch(
      /Commandes/,
    );
    // Populated branch
    const populated = [
      order({
        _id: "orders_x",
        createdAt: Date.UTC(2026, 4, 29, 14, 30),
        pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
      }),
    ];
    expect(allText(serialize(CommandesView(defaults(populated))))).toMatch(
      /Commandes/,
    );
  });

  it("AC — the slice-1 placeholder « La liste arrive dans le prochain slice » is GONE (live table replaces it)", () => {
    // Slice 1 (#222) shipped a placeholder copy; slice 2 (#227) wires the
    // real table — the placeholder must not survive a revert that brought it
    // back. We assert on the populated branch (where the table is fully
    // rendered) so a regression cannot hide.
    const populated = [
      order({
        _id: "orders_x",
        createdAt: Date.UTC(2026, 4, 29, 14, 30),
        pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
      }),
    ];
    const text = allText(serialize(CommandesView(defaults(populated))));
    expect(text).not.toMatch(/La liste arrive dans le prochain slice/);
    expect(text).not.toMatch(/commandes-page-placeholder/);
  });

  it("AC1 — delegates rendering to `OrdersTable` (the loading branch surfaces the table skeleton)", () => {
    const tree = serialize(CommandesView(defaults(undefined)));
    const slots = dataSlots(tree);
    expect(slots).toContain("orders-table-skeleton");
  });

  it("AC1 — populated branch renders a row per order via `OrdersTable`", () => {
    const populated = [
      order({
        _id: "orders_a",
        createdAt: Date.UTC(2026, 4, 29, 14, 30),
        pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
      }),
      order({
        _id: "orders_b",
        createdAt: Date.UTC(2026, 4, 29, 13, 15),
        pricingSnapshot: { subtotal: 1250, deliveryFee: 0, total: 1250 },
      }),
    ];
    const tree = serialize(CommandesView(defaults(populated)));
    const rowCount = dataSlots(tree).filter(
      (s) => s === "orders-table-row",
    ).length;
    expect(rowCount).toBe(2);
  });

  it("AC1 — empty branch surfaces the empty-state copy from `OrdersTable`", () => {
    const text = allText(serialize(CommandesView(defaults([]))));
    expect(text).toMatch(/Aucune commande pour le moment/);
  });

  it("renders without crashing on every branch (pure function of props)", () => {
    expect(serialize(CommandesView(defaults(undefined)))).not.toBeNull();
    expect(serialize(CommandesView(defaults([])))).not.toBeNull();
    expect(
      serialize(
        CommandesView(
          defaults([
            order({
              _id: "orders_x",
              createdAt: Date.UTC(2026, 4, 29, 14, 30),
              pricingSnapshot: {
                subtotal: 1800,
                deliveryFee: 200,
                total: 2000,
              },
            }),
          ]),
        ),
      ),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-COMMANDES-FILTERS (#238) — the view now mounts `OrdersFilters` above the
// table and forwards the controlled filter props. The view stays pure —
// `filterOrders` is applied at the page level so the `orders` prop here is
// already filtered. The view's job is to mount the filters component, render
// the table on the filtered payload, and keep the page-level filter state
// the single source of truth.
// ---------------------------------------------------------------------------
describe("CommandesView — F-COMMANDES-FILTERS (#238)", () => {
  it("renders the `OrdersFilters` controlled component above the table", () => {
    const tree = serialize(CommandesView(defaults([])));
    const slots = dataSlots(tree);
    // The filters component renders the 4 date buttons and the 8 status
    // multi-select items; we pin one slot per group so a regression that
    // accidentally removes the component fires here.
    expect(slots).toContain("orders-filters-date-today");
    expect(slots).toContain("orders-filters-date-7d");
    expect(slots).toContain("orders-filters-date-30d");
    expect(slots).toContain("orders-filters-date-tout");
    const statusItems = slots.filter((s) => s === "orders-filters-status-item");
    expect(statusItems.length).toBe(ALL_ORDER_STATUSES.length);
    // #415 — 9 statuses now (auto_expired added for the « Manquées » tab).
    expect(statusItems.length).toBe(9);
  });

  it("threads the controlled `filter` value into the filters component (active state visible)", () => {
    const tree = serialize(
      CommandesView({
        ...defaults([]),
        filter: { dateRange: "7d", statuses: ["nouvelle"] },
      }),
    );
    // We assert that the 7d date button surfaces data-active="true" — proof
    // the filter value propagates through.
    const sevenDay = flatten(tree).find(
      (x) =>
        x !== null &&
        !("text" in x) &&
        x.props["data-slot"] === "orders-filters-date-7d",
    );
    if (!sevenDay || "text" in sevenDay)
      throw new Error("7d button missing in tree");
    expect(sevenDay.props["data-active"]).toBe("true");

    // And one status (nouvelle) is active.
    const nouvelleItem = flatten(tree).find(
      (x) =>
        x !== null &&
        !("text" in x) &&
        x.props["data-slot"] === "orders-filters-status-item" &&
        x.props["data-status"] === "nouvelle",
    );
    if (!nouvelleItem || "text" in nouvelleItem)
      throw new Error("nouvelle status item missing in tree");
    expect(nouvelleItem.props["data-active"]).toBe("true");
  });

  it("threads the filter even on the loading branch (filters render before data lands)", () => {
    // The gérant must be able to set a filter while the initial fetch is in
    // flight (the table renders the skeleton; the filters are usable
    // immediately). The slice-2 « no shell shift » discipline extends to
    // filters: they don't appear AFTER the data lands.
    const tree = serialize(CommandesView(defaults(undefined)));
    const slots = dataSlots(tree);
    expect(slots).toContain("orders-filters-date-tout");
    expect(slots).toContain("orders-table-skeleton");
  });
});

// ---------------------------------------------------------------------------
// F-COMMANDES-DETAIL-MODAL (#239) — the view forwards a row-click handler to
// `OrdersTable`. The page owns the modal state; the view's only job here is
// to relay the click. We pin this is a pure forwarding (the view does NOT
// derive the orderId itself, doesn't sniff the row, doesn't open anything).
// ---------------------------------------------------------------------------
describe("CommandesView — F-COMMANDES-DETAIL-MODAL (#239)", () => {
  it("forwards `onOrderClick` to the table — clicking a row invokes the prop with the row's order id", () => {
    const populated = [
      order({
        _id: "orders_x",
        createdAt: Date.UTC(2026, 4, 29, 14, 30),
        pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
      }),
    ];
    const calls: string[] = [];
    const tree = serialize(
      CommandesView({
        ...defaults(populated),
        onOrderClick: (id) => calls.push(String(id)),
      }),
    );
    const row = flatten(tree).find(
      (x) =>
        x !== null &&
        !("text" in x) &&
        x.props["data-slot"] === "orders-table-row",
    );
    if (!row || "text" in row) throw new Error("row missing in tree");
    const click = row.props.onClick as (() => void) | undefined;
    expect(typeof click).toBe("function");
    click?.();
    expect(calls).toEqual(["orders_x"]);
  });
});

// ---------------------------------------------------------------------------
// F-COMMANDES-CSV-EXPORT (#244) — the view now mounts an « Exporter CSV »
// button in the page header. The page owns the click handler (it knows the
// filtered orders + the tenant slug). The view stays pure — it forwards the
// click and disables the button when there are no orders to export.
// ---------------------------------------------------------------------------
describe("CommandesView — F-COMMANDES-CSV-EXPORT (#244)", () => {
  it("mounts the `ExportCsvButton` in the header on every branch", () => {
    // Loading branch — the button is visible (disabled) so the page chrome
    // doesn't flash when the data lands (same discipline as the filters).
    const loadingSlots = dataSlots(
      serialize(CommandesView(defaults(undefined))),
    );
    expect(loadingSlots).toContain("export-csv-button");

    // Empty branch — the button is visible (disabled — no orders to export).
    const emptySlots = dataSlots(serialize(CommandesView(defaults([]))));
    expect(emptySlots).toContain("export-csv-button");

    // Populated branch — the button is visible (enabled).
    const populated = [
      order({
        _id: "orders_x",
        createdAt: Date.UTC(2026, 4, 29, 14, 30),
        pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
      }),
    ];
    const populatedSlots = dataSlots(
      serialize(CommandesView(defaults(populated))),
    );
    expect(populatedSlots).toContain("export-csv-button");
  });

  it("disables the button when `orders` is undefined (loading) or empty (no data to export)", () => {
    function findExportButton(orders: Doc<"orders">[] | undefined) {
      const tree = serialize(CommandesView(defaults(orders)));
      return flatten(tree).find(
        (x) =>
          x !== null &&
          !("text" in x) &&
          x.props["data-slot"] === "export-csv-button",
      );
    }

    const loading = findExportButton(undefined);
    if (!loading || "text" in loading)
      throw new Error("export button missing in loading branch");
    expect(loading.props.disabled).toBe(true);

    const empty = findExportButton([]);
    if (!empty || "text" in empty)
      throw new Error("export button missing in empty branch");
    expect(empty.props.disabled).toBe(true);
  });

  it("enables the button when there are filtered orders to export", () => {
    const populated = [
      order({
        _id: "orders_x",
        createdAt: Date.UTC(2026, 4, 29, 14, 30),
        pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
      }),
    ];
    const tree = serialize(CommandesView(defaults(populated)));
    const node = flatten(tree).find(
      (x) =>
        x !== null &&
        !("text" in x) &&
        x.props["data-slot"] === "export-csv-button",
    );
    if (!node || "text" in node)
      throw new Error("export button missing in populated branch");
    expect(node.props.disabled).toBe(false);
  });

  it("forwards `onExportCsv` to the button — clicking it invokes the page-owned handler", () => {
    const populated = [
      order({
        _id: "orders_x",
        createdAt: Date.UTC(2026, 4, 29, 14, 30),
        pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
      }),
    ];
    const calls: number[] = [];
    const tree = serialize(
      CommandesView({
        ...defaults(populated),
        onExportCsv: () => calls.push(1),
      }),
    );
    const node = flatten(tree).find(
      (x) =>
        x !== null &&
        !("text" in x) &&
        x.props["data-slot"] === "export-csv-button",
    );
    if (!node || "text" in node) throw new Error("export button missing");
    const click = node.props.onClick as (() => void) | undefined;
    expect(typeof click).toBe("function");
    click?.();
    expect(calls).toEqual([1]);
  });
});
