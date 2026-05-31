/**
 * F-COMMANDES-DETAIL-MODAL (#239) — `OrderDetailModal` test contract.
 *
 * The modal that opens when the gérant clicks a row of the orders table.
 * It is FULLY CONTROLLED (open + orderId owned by the page) and reads its
 * payload via `useTenantQuery(api.lib.orders.orders.getOrder, {orderId})`
 * — the page wires the call, the modal accepts the resulting
 * `OrderWithDetail | null | undefined` value as a prop. This keeps the
 * component pure (no Convex / hooks shim in the test) and mirrors the
 * controlled-orchestration discipline of `ItemModal` and `OrdersFilters`.
 *
 * Three render branches:
 *   - `detail === undefined` → loading state (skeleton; the gérant sees the
 *     modal chrome immediately, content lands when `getOrder` resolves).
 *   - `detail === null`      → « Commande introuvable » (the order id no
 *     longer exists for this tenant — backend re-checks ownership and
 *     returns null, never throws for a foreign id).
 *   - `detail` populated     → the four sections:
 *       1. Items frozen (name + qty + unit price EUR + modifiers grouped)
 *       2. Pricing snapshot (subtotal / deliveryFee / total in EUR)
 *       3. Timeline (`orderEvents` time-ordered, FR datetime per event)
 *       4. Mode (« Livraison » / « À emporter »), source (« direct » in V1),
 *          note resto (free text from `restaurantNote`)
 *
 * AC pinned here (issue body #239):
 *   - Items render in the order of `detail.items` (backend hands them in
 *     insertion order via the `by_order` index).
 *   - Modifiers under each item surface their `groupName: optionName` shape
 *     so the gérant immediately reads « Sauce : moutarde » without
 *     resolving anything.
 *   - Unit price + total + subtotal + deliveryFee are formatted via
 *     `formatPriceCentimes` (centimes → French euro string).
 *   - Pricing snapshot section is rendered ONLY if `pricingSnapshot` is set
 *     (an order in « en attente de paiement » has no snapshot yet —
 *     gracefully hide rather than rendering « — » three times).
 *   - Timeline events render the literal `status` text (PRD 20 vocabulary)
 *     and a human-readable timestamp via `formatOrderDate`.
 *   - Timeline events render in input order (backend hands them oldest
 *     first via the `by_order` index; the view does NOT resort defensively).
 *   - Mode is rendered with customer-facing French copy («  Livraison » /
 *     « À emporter »), not the raw schema literal.
 *   - Source is rendered as the literal `detail.source` (V1 = `direct` only,
 *     per ADR 0009 — the gérant sees « direct » verbatim).
 *   - Note resto is rendered when present, omitted (no empty section) when
 *     absent.
 *   - Refund button is NOT rendered — explicitly out of scope this slice
 *     (« Pas de bouton refund encore - c'est le slice suivant »).
 *
 * Same React-tree-serializer pattern as `commandes-view.test.tsx` /
 * `orders-table.test.tsx`. `apps/admin/vitest.config.ts` runs in
 * `environment: "node"` so the dialog primitives must be passthrough-mocked
 * (radix's `useId` / `useContext` throw under node env) — mirrors the
 * `item-modal.test.tsx` discipline.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import type { OrderWithDetail } from "@packages/backend/convex/lib/tenancy";

// The component renders inside a `<Dialog>`; radix primitives call hooks
// internally (`useId`, `useContext`) which throw under `environment: "node"`.
// Passthrough the primitives so the inner content renders to the tree —
// mirrors `item-modal.test.tsx`.
vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactNode => children ?? null;
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogClose: passthrough,
    DialogTrigger: passthrough,
    DialogPortal: passthrough,
    DialogOverlay: passthrough,
  };
});

const { OrderDetailModal } = await import("./order-detail-modal");

// ---------------------------------------------------------------------------
// React-tree serializer (same shape as the sibling view tests).
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
const ORDER_ID = "orders_x" as unknown as Id<"orders">;

function makeDetail(partial: Partial<OrderWithDetail> = {}): OrderWithDetail {
  const createdAt = Date.UTC(2026, 4, 29, 14, 30);
  const base: OrderWithDetail = {
    _id: ORDER_ID,
    _creationTime: createdAt,
    tenantId: TENANT,
    customerId: CUSTOMER,
    status: "nouvelle",
    mode: "delivery",
    source: "direct",
    createdAt,
    pricingSnapshot: {
      subtotal: 2500,
      deliveryFee: 250,
      total: 2750,
    },
    items: [
      {
        _id: "items_1" as unknown as Id<"orderItems">,
        _creationTime: createdAt,
        tenantId: TENANT,
        orderId: ORDER_ID,
        itemName: "Burger maison",
        unitPrice: 1200,
        quantity: 1,
        modifiers: [
          { groupName: "Sauce", optionName: "Moutarde", priceDelta: 0 },
          { groupName: "Cuisson", optionName: "À point", priceDelta: 0 },
        ],
        allergens: ["gluten"],
      },
      {
        _id: "items_2" as unknown as Id<"orderItems">,
        _creationTime: createdAt,
        tenantId: TENANT,
        orderId: ORDER_ID,
        itemName: "Frites",
        unitPrice: 650,
        quantity: 2,
        modifiers: [],
        allergens: [],
      },
    ],
    events: [
      {
        _id: "events_1" as unknown as Id<"orderEvents">,
        _creationTime: createdAt,
        tenantId: TENANT,
        orderId: ORDER_ID,
        status: "en attente de paiement",
        at: Date.UTC(2026, 4, 29, 14, 28),
      },
      {
        _id: "events_2" as unknown as Id<"orderEvents">,
        _creationTime: createdAt,
        tenantId: TENANT,
        orderId: ORDER_ID,
        status: "nouvelle",
        at: Date.UTC(2026, 4, 29, 14, 30),
      },
    ],
  };
  return { ...base, ...partial } as OrderWithDetail;
}

function defaults(detail: OrderWithDetail | null | undefined) {
  return {
    open: true,
    onOpenChange: () => {},
    detail,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OrderDetailModal — F-COMMANDES-DETAIL-MODAL (#239)", () => {
  // -------------------------------------------------------------------------
  // Loading branch
  // -------------------------------------------------------------------------
  describe("loading (detail === undefined)", () => {
    it("renders a loading skeleton (the chrome lands immediately, content arrives when the query resolves)", () => {
      const tree = serialize(OrderDetailModal(defaults(undefined)));
      expect(dataSlots(tree)).toContain("order-detail-modal-loading");
    });

    it("does NOT render the items / pricing / timeline sections while loading", () => {
      const tree = serialize(OrderDetailModal(defaults(undefined)));
      const slots = dataSlots(tree);
      expect(slots).not.toContain("order-detail-modal-items");
      expect(slots).not.toContain("order-detail-modal-pricing");
      expect(slots).not.toContain("order-detail-modal-timeline");
    });
  });

  // -------------------------------------------------------------------------
  // Null branch — order not found (foreign id or deleted)
  // -------------------------------------------------------------------------
  describe("not-found (detail === null)", () => {
    it("renders « Commande introuvable » when the backend returns null", () => {
      const tree = serialize(OrderDetailModal(defaults(null)));
      expect(allText(tree)).toMatch(/Commande introuvable/);
    });

    it("does NOT render any data section when not found", () => {
      const tree = serialize(OrderDetailModal(defaults(null)));
      const slots = dataSlots(tree);
      expect(slots).not.toContain("order-detail-modal-items");
      expect(slots).not.toContain("order-detail-modal-pricing");
      expect(slots).not.toContain("order-detail-modal-timeline");
    });
  });

  // -------------------------------------------------------------------------
  // Populated branch — the four sections
  // -------------------------------------------------------------------------
  describe("populated (detail is an OrderWithDetail)", () => {
    it("renders the four sections (items / pricing / timeline / meta)", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const slots = dataSlots(tree);
      expect(slots).toContain("order-detail-modal-items");
      expect(slots).toContain("order-detail-modal-pricing");
      expect(slots).toContain("order-detail-modal-timeline");
      expect(slots).toContain("order-detail-modal-meta");
    });

    // ---- Items ----
    it("renders one row per item, in the input order (backend insertion order)", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      expect(countSlots(tree, "order-detail-modal-item")).toBe(2);
      const text = allText(tree);
      // The fixture has two items — Burger first, then Frites. The view
      // does NOT resort defensively: the backend `listTenantOrderItems`
      // returns rows in `by_order` insertion order, which is the order the
      // gérant should see.
      const idxBurger = text.indexOf("Burger maison");
      const idxFrites = text.indexOf("Frites");
      expect(idxBurger).toBeGreaterThanOrEqual(0);
      expect(idxFrites).toBeGreaterThan(idxBurger);
    });

    it("renders each item's name, quantity and unit price in EUR", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      // Burger: name, qty 1, 1200 cents → « 12,00 €  »
      expect(text).toMatch(/Burger maison/);
      expect(text).toMatch(/12,00/);
      // Frites: name, qty 2, 650 cents → « 6,50 € »
      expect(text).toMatch(/Frites/);
      expect(text).toMatch(/6,50/);
      // Quantities surface verbatim so the gérant scans « 2 × Frites ».
      expect(text).toMatch(/×\s*1\b|x\s*1\b|\b1\s*×|\b1\s*x/);
      expect(text).toMatch(/×\s*2\b|x\s*2\b|\b2\s*×|\b2\s*x/);
    });

    it("renders modifiers under each item as « groupName : optionName » lines", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      // Burger has two modifiers, both surface as group / option pairs.
      expect(text).toMatch(/Sauce/);
      expect(text).toMatch(/Moutarde/);
      expect(text).toMatch(/Cuisson/);
      expect(text).toMatch(/À point/);
    });

    // ---- Pricing ----
    it("renders subtotal / deliveryFee / total from `pricingSnapshot` in EUR", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      // subtotal 2500 → « 25,00 € », deliveryFee 250 → « 2,50 € », total 2750 → « 27,50 € »
      expect(text).toMatch(/25,00/);
      expect(text).toMatch(/2,50/);
      expect(text).toMatch(/27,50/);
    });

    it("renders the pricing labels in FR (« Sous-total » / « Livraison » / « Total »)", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      expect(text).toMatch(/Sous-total/);
      expect(text).toMatch(/Livraison/);
      expect(text).toMatch(/Total/);
    });

    it("does NOT render the pricing section when `pricingSnapshot` is absent (« en attente de paiement »)", () => {
      // Before Stripe confirms the payment, the snapshot is undefined.
      // Rather than rendering « — » three times, the section is hidden so
      // the modal stays scannable.
      const detail = makeDetail({
        pricingSnapshot: undefined,
        status: "en attente de paiement",
      });
      const tree = serialize(OrderDetailModal(defaults(detail)));
      expect(dataSlots(tree)).not.toContain("order-detail-modal-pricing");
    });

    // ---- Timeline ----
    it("renders the timeline with one row per event, in input order", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      expect(countSlots(tree, "order-detail-modal-event")).toBe(2);
      const text = allText(tree);
      // Backend hands events oldest first via the `by_order` index — the
      // view preserves that order so the gérant reads a top-down timeline.
      const idxFirst = text.indexOf("en attente de paiement");
      const idxSecond = text.indexOf("nouvelle");
      expect(idxFirst).toBeGreaterThanOrEqual(0);
      expect(idxSecond).toBeGreaterThan(idxFirst);
    });

    it("renders each event's timestamp via `formatOrderDate` (DD/MM/YYYY HH:mm)", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      // The two event timestamps from the fixture (UTC components).
      expect(text).toMatch(/29\/05\/2026.*14:28/);
      expect(text).toMatch(/29\/05\/2026.*14:30/);
    });

    // ---- Meta (mode / source / note) ----
    it("renders mode with French customer-facing copy (« Livraison » for delivery)", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      expect(text).toMatch(/Livraison/);
      // The raw schema literal must not leak — same discipline as the
      // orders table.
      expect(text).not.toMatch(/\bdelivery\b/);
    });

    it("renders mode « À emporter » for a pickup order", () => {
      const detail = makeDetail({ mode: "pickup" });
      const tree = serialize(OrderDetailModal(defaults(detail)));
      const text = allText(tree);
      expect(text).toMatch(/À emporter/);
      expect(text).not.toMatch(/\bpickup\b/);
    });

    it("renders the source literally (« direct » in V1, per ADR 0009)", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      // V1 is `direct` only; the modal surfaces the literal value so a V2
      // Hubrise ingestion (`uber_eats` / `deliveroo`) would surface
      // verbatim too.
      expect(text).toMatch(/direct/);
    });

    it("renders the restaurant note when present", () => {
      const detail = makeDetail({
        restaurantNote: "Sans oignons s'il vous plaît",
      });
      const tree = serialize(OrderDetailModal(defaults(detail)));
      expect(allText(tree)).toMatch(/Sans oignons s'il vous plaît/);
    });

    it("omits the restaurant-note section when the note is absent", () => {
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      // The fixture has no restaurantNote — the dedicated slot must not
      // surface (rather than rendering an empty « Note du restaurant : »
      // label).
      expect(dataSlots(tree)).not.toContain("order-detail-modal-note");
    });

    // ---- Slice discipline ----
    it("does NOT render a refund button (« Pas de bouton refund encore — slice suivant »)", () => {
      // The issue body explicitly defers the refund action to
      // F-COMMANDES-REFUND. We pin its absence so a regression that adds
      // the button to this slice fires here loudly.
      const tree = serialize(OrderDetailModal(defaults(makeDetail())));
      const text = allText(tree);
      expect(text).not.toMatch(/Rembourser/i);
      expect(text).not.toMatch(/Refund/i);
      expect(dataSlots(tree)).not.toContain("order-detail-modal-refund");
    });

    it("does NOT render a refund button on a paid + non-refused order either", () => {
      // Extra pin — the « refund affordance » regression usually surfaces
      // when paidAt is set; we explicitly cover the case.
      const detail = makeDetail({
        paidAt: Date.UTC(2026, 4, 29, 14, 30),
        status: "livrée",
      });
      const tree = serialize(OrderDetailModal(defaults(detail)));
      expect(allText(tree)).not.toMatch(/Rembourser/i);
    });
  });

  // -------------------------------------------------------------------------
  // open=false → modal is closed; the inner content does not render anywhere
  // (radix-side: portal is unmounted). We pin that the component is at
  // least callable in this state — the controlled `open` is the page's
  // contract with `Dialog`, our passthrough mock means the test would also
  // surface inner content; here we only assert the component renders without
  // throwing in this branch.
  // -------------------------------------------------------------------------
  describe("controlled open prop", () => {
    it("accepts open=false without throwing", () => {
      expect(() =>
        serialize(
          OrderDetailModal({
            open: false,
            onOpenChange: () => {},
            detail: undefined,
          }),
        ),
      ).not.toThrow();
    });

    it("threads the `open` prop into the underlying Dialog (controlled by the page)", () => {
      // The Dialog is passthrough-mocked so we can't assert on its props
      // directly; the wiring is structurally enforced by typescript (the
      // page passes `open` + `onOpenChange` and the source assigns them to
      // <Dialog>). Smoke pin: the component renders content when
      // open=true.
      const tree = serialize(
        OrderDetailModal({
          open: true,
          onOpenChange: () => {},
          detail: undefined,
        }),
      );
      expect(dataSlots(tree)).toContain("order-detail-modal-loading");
    });
  });
});
