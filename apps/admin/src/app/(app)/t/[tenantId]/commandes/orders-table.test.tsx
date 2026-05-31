/**
 * F-COMMANDES-LIVE-TABLE (#227) — `OrdersTable`, the live table that
 * replaces the slice-1 placeholder under `/t/[tenantId]/commandes/`.
 *
 * Pure presentational component owning the THREE branches the table can be
 * in (issue body « Loading state visible pendant le fetch initial »,
 * « Empty state visible si zero commandes », « V1 colonnes: createdAt / status
 * / mode / total »):
 *   - `orders === undefined` → loading skeleton rows (no blank flash, no
 *     shell-swap when the data lands — same discipline as `MenuView` /
 *     `MesClientsView`).
 *   - `orders.length === 0`  → empty state (« Aucune commande pour le
 *     moment »).
 *   - else                   → a 4-column table (createdAt FR / status badge
 *     / mode / total EUR from `pricingSnapshot.total` centimes).
 *
 * The table's row order MIRRORS the input order — sort by `createdAt` DESC
 * is GUARANTEED BY THE BACKEND (`listTenantOrders` reads the `by_tenant`
 * index in reverse insertion order; cf.
 * `packages/backend/convex/lib/tenancy/ordersStore.ts`). The view does NOT
 * resort defensively: a regression of that backend invariant would surface
 * in the backend's own test suite, and resorting here would mask a wider
 * bug. We assert the order is preserved as-handed-in.
 *
 * Same React-tree-serializer pattern as `menu-view.test.tsx` /
 * `mes-clients-view.test.tsx`. `apps/admin/vitest.config.ts` runs in
 * `environment: "node"` (no jsdom, no RTL), so we walk the React tree the
 * view returns and assert text content + structural shape.
 *
 * What's pinned here (acceptance criteria #227):
 *   - AC2 (loading): `undefined` MUST render skeleton rows, NOT the empty
 *     state, NOT blank.
 *   - AC3 (empty): `[]` MUST render the « Aucune commande pour le moment »
 *     copy, NOT a 0-row table headers-only.
 *   - AC1 (populated): a 3-rows fixture renders 3 data rows, each with the
 *     four columns (createdAt / status / mode / total), in input order
 *     (backend guarantees DESC).
 *   - AC1 (header): the 4 column headers surface verbatim (« Date »,
 *     « Statut », « Mode », « Total ») so the table is screen-reader-friendly
 *     and the gérant can scan it from row-0.
 *   - AC1 (total format): `pricingSnapshot.total` centimes is rendered as a
 *     French euro string (« 12,50 € » shape — `formatPriceCentimes` reused);
 *     a missing snapshot (e.g. « en attente de paiement » before Stripe
 *     confirms) renders « — » so the row stays scannable.
 *   - AC1 (status badge): status surfaces inside a `<Badge>` component (the
 *     issue body « status (badge) »); status text is the literal value
 *     (« nouvelle », « en préparation », …) so the operator scans the same
 *     vocabulary they see in the PRD 20 state machine.
 *   - AC1 (mode): `mode` renders as « Livraison » / « À emporter » (the
 *     gérant doesn't speak schema; mirrors the customer-facing PWA copy).
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { OrdersTable } from "./orders-table";

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

function countSlots(n: SerializedNode, slot: string): number {
  return dataSlots(n).filter((s) => s === slot).length;
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

const THREE_ORDERS: Doc<"orders">[] = [
  order({
    _id: "orders_a",
    createdAt: Date.UTC(2026, 4, 29, 14, 30),
    status: "nouvelle",
    mode: "delivery",
    pricingSnapshot: {
      subtotal: 1800,
      deliveryFee: 200,
      total: 2000,
    },
  }),
  order({
    _id: "orders_b",
    createdAt: Date.UTC(2026, 4, 29, 13, 15),
    status: "en préparation",
    mode: "pickup",
    pricingSnapshot: {
      subtotal: 1250,
      deliveryFee: 0,
      total: 1250,
    },
  }),
  order({
    _id: "orders_c",
    createdAt: Date.UTC(2026, 4, 29, 12, 0),
    status: "livrée",
    mode: "delivery",
    pricingSnapshot: {
      subtotal: 3500,
      deliveryFee: 300,
      total: 3800,
    },
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OrdersTable — F-COMMANDES-LIVE-TABLE (#227)", () => {
  // -------------------------------------------------------------------------
  // AC2 — loading branch
  // -------------------------------------------------------------------------
  describe("loading (orders === undefined)", () => {
    it("renders a skeleton placeholder, NOT the empty state, NOT a 0-row table", () => {
      const tree = serialize(OrdersTable({ orders: undefined }));
      const slots = dataSlots(tree);
      expect(slots).toContain("orders-table-skeleton");
      // Must NOT show the empty-state copy in this branch.
      expect(allText(tree)).not.toMatch(/Aucune commande pour le moment/);
    });

    it("renders multiple skeleton rows (the table shape is visible while loading — no shell shift)", () => {
      // Issue body « Loading state (skeleton ou spinner) ». We pick skeleton
      // rows so the layout doesn't shift when the data lands — same shape
      // pattern as `CategoryListSkeleton` in menu/menu-view.tsx.
      const tree = serialize(OrdersTable({ orders: undefined }));
      const rowCount = countSlots(tree, "orders-table-skeleton-row");
      expect(rowCount).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // AC3 — empty branch
  // -------------------------------------------------------------------------
  describe("empty (orders === [])", () => {
    it("renders the « Aucune commande pour le moment » copy", () => {
      const tree = serialize(OrdersTable({ orders: [] }));
      expect(allText(tree)).toMatch(/Aucune commande pour le moment/);
    });

    it("does NOT render data rows (no table body content under empty)", () => {
      const tree = serialize(OrdersTable({ orders: [] }));
      const rowCount = countSlots(tree, "orders-table-row");
      expect(rowCount).toBe(0);
    });

    it("does NOT render the loading skeleton", () => {
      const tree = serialize(OrdersTable({ orders: [] }));
      expect(dataSlots(tree)).not.toContain("orders-table-skeleton");
    });
  });

  // -------------------------------------------------------------------------
  // AC1 — populated branch
  // -------------------------------------------------------------------------
  describe("populated (3 orders)", () => {
    it("renders exactly 3 data rows for a 3-order fixture", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const rowCount = countSlots(tree, "orders-table-row");
      expect(rowCount).toBe(3);
    });

    it("renders the 4 column headers verbatim (« Date » / « Statut » / « Mode » / « Total »)", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const text = allText(tree);
      expect(text).toMatch(/Date/);
      expect(text).toMatch(/Statut/);
      expect(text).toMatch(/Mode/);
      expect(text).toMatch(/Total/);
    });

    it("renders each row in the input order — backend already guarantees DESC sort (no defensive resort)", () => {
      // The backend's `listTenantOrders` returns by_tenant ordered by
      // `_creationTime` DESC — we don't resort here (a regression of that
      // invariant should surface in the backend test suite, not be masked
      // by the view). We assert the table renders the rows in the order it
      // received them.
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const text = allText(tree);
      const idxA = text.indexOf("14:30");
      const idxB = text.indexOf("13:15");
      const idxC = text.indexOf("12:00");
      expect(idxA).toBeGreaterThanOrEqual(0);
      expect(idxB).toBeGreaterThan(idxA);
      expect(idxC).toBeGreaterThan(idxB);
    });

    it("renders `createdAt` in French DD/MM/YYYY HH:mm shape (compact, glanceable)", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const text = allText(tree);
      // Same epoch fixtures as above — the helper renders UTC components
      // (locale-independent — tests stay green on any CI timezone).
      expect(text).toMatch(/29\/05\/2026.*14:30/);
      expect(text).toMatch(/29\/05\/2026.*13:15/);
    });

    it("renders status inside a `<Badge>` (issue body « status (badge) »)", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      // The shadcn Badge sets `data-slot="badge"`. We expect ONE badge per
      // row (3 rows → 3 badges) so the status is visually distinct from
      // the other columns.
      const badgeCount = countSlots(tree, "badge");
      expect(badgeCount).toBe(3);
    });

    it("renders the literal status text (PRD 20 vocabulary — « nouvelle » / « en préparation » / « livrée »)", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const text = allText(tree);
      expect(text).toMatch(/nouvelle/);
      expect(text).toMatch(/en préparation/);
      expect(text).toMatch(/livrée/);
    });

    it("renders `mode` as customer-facing copy (« Livraison » / « À emporter », not « delivery » / « pickup »)", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const text = allText(tree);
      // 2 delivery rows + 1 pickup row in the fixture.
      expect(text).toMatch(/Livraison/);
      expect(text).toMatch(/À emporter/);
      // No raw schema vocabulary leaks into the table cells (the schema
      // literal lives in the backend; the gérant reads French copy).
      // We can't assert absence globally (a status like "remise" contains
      // letters), but we can assert the raw lowercase enum doesn't show.
      expect(text).not.toMatch(/\bdelivery\b/);
      expect(text).not.toMatch(/\bpickup\b/);
    });

    it("renders `total` from `pricingSnapshot.total` centimes as a French euro string", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const text = allText(tree);
      // Fixture totals: 2000 → 20,00 €, 1250 → 12,50 €, 3800 → 38,00 €.
      expect(text).toMatch(/20,00/);
      expect(text).toMatch(/12,50/);
      expect(text).toMatch(/38,00/);
    });

    it("renders « — » for the total when `pricingSnapshot` is absent (e.g. « en attente de paiement »)", () => {
      // Before Stripe confirms the payment, the snapshot is undefined — the
      // backend keeps the order in the « en attente de paiement » status
      // (PRD 10 §10/§11). The table must stay scannable.
      const pendingOrder: Doc<"orders"> = order({
        _id: "orders_pending",
        createdAt: Date.UTC(2026, 4, 29, 11, 0),
        status: "en attente de paiement",
        // pricingSnapshot deliberately omitted
      });
      const tree = serialize(OrdersTable({ orders: [pendingOrder] }));
      const text = allText(tree);
      expect(text).toMatch(/—/);
      // The row is still rendered (not skipped), so the gérant sees it.
      expect(countSlots(tree, "orders-table-row")).toBe(1);
    });

    it("uses a semantic <table> (issue body « table HTML sémantique »)", () => {
      const tree = serialize(OrdersTable({ orders: THREE_ORDERS }));
      const slots = dataSlots(tree);
      // The shadcn `<Table>` primitive sets `data-slot="table"`.
      expect(slots).toContain("table");
      expect(slots).toContain("table-header");
      expect(slots).toContain("table-body");
    });
  });
});
