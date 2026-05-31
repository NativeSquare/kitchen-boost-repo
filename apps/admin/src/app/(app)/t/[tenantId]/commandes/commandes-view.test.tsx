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
  partial: Partial<Doc<"orders">> & { _id: string; createdAt: number },
): Doc<"orders"> {
  return {
    _id: partial._id as unknown as Id<"orders">,
    _creationTime: partial.createdAt,
    tenantId: TENANT,
    customerId: CUSTOMER,
    status: "nouvelle",
    mode: "delivery",
    source: "direct",
    createdAt: partial.createdAt,
    ...partial,
  } as Doc<"orders">;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CommandesView — F-COMMANDES-LIVE-TABLE (#227)", () => {
  it("AC — surfaces the page title « Commandes » on every branch (header doesn't flash)", () => {
    // Loading branch
    expect(allText(serialize(CommandesView({ orders: undefined })))).toMatch(
      /Commandes/,
    );
    // Empty branch
    expect(allText(serialize(CommandesView({ orders: [] })))).toMatch(
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
    expect(allText(serialize(CommandesView({ orders: populated })))).toMatch(
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
    const text = allText(serialize(CommandesView({ orders: populated })));
    expect(text).not.toMatch(/La liste arrive dans le prochain slice/);
    expect(text).not.toMatch(/commandes-page-placeholder/);
  });

  it("AC1 — delegates rendering to `OrdersTable` (the loading branch surfaces the table skeleton)", () => {
    const tree = serialize(CommandesView({ orders: undefined }));
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
    const tree = serialize(CommandesView({ orders: populated }));
    const rowCount = dataSlots(tree).filter(
      (s) => s === "orders-table-row",
    ).length;
    expect(rowCount).toBe(2);
  });

  it("AC1 — empty branch surfaces the empty-state copy from `OrdersTable`", () => {
    const text = allText(serialize(CommandesView({ orders: [] })));
    expect(text).toMatch(/Aucune commande pour le moment/);
  });

  it("renders without crashing on every branch (pure function of props)", () => {
    expect(serialize(CommandesView({ orders: undefined }))).not.toBeNull();
    expect(serialize(CommandesView({ orders: [] }))).not.toBeNull();
    expect(
      serialize(
        CommandesView({
          orders: [
            order({
              _id: "orders_x",
              createdAt: Date.UTC(2026, 4, 29, 14, 30),
              pricingSnapshot: {
                subtotal: 1800,
                deliveryFee: 200,
                total: 2000,
              },
            }),
          ],
        }),
      ),
    ).not.toBeNull();
  });
});
