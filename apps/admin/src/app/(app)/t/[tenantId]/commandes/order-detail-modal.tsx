"use client";

/**
 * F-COMMANDES-DETAIL-MODAL (#239) — `OrderDetailModal`, the read-only modal
 * that opens when the gérant clicks a row of the orders table.
 *
 * Fully CONTROLLED — the page owns:
 *   - the `open` flag (and toggles it on row click / on dismiss);
 *   - the selected `orderId` (and uses it to bind
 *     `useTenantQuery(api.lib.orders.orders.getOrder, {orderId})`);
 *   - the resolved `detail: OrderWithDetail | null | undefined` value, passed
 *     in as a prop.
 *
 * The modal therefore has no Convex / hooks shim — it's a pure function of
 * its props (mirrors `OrdersFilters`, `OrdersTable`, and the bones of
 * `ItemModal`'s outer shell). The page wires the `tenantQuery` call once,
 * skipped with `"skip"` while no row is selected (« Pas de N+1 ») — when a
 * row is clicked the query opens, Convex pushes the payload via WebSocket,
 * and the modal re-renders without any extra plumbing.
 *
 * Three render branches inside the Dialog:
 *   1. `detail === undefined` → loading skeleton; the gérant sees the modal
 *      chrome (title + close button) IMMEDIATELY so the click feels
 *      responsive, then content lands when `getOrder` resolves.
 *   2. `detail === null`      → « Commande introuvable » (the order id no
 *      longer exists for this tenant — backend `getTenantOrderWithDetail`
 *      re-checks ownership and returns null, never throws).
 *   3. `detail` populated     → four stacked sections:
 *        - Items frozen      : name + qty + unit price EUR + modifiers
 *          (`groupName: optionName` lines under each item).
 *        - Pricing snapshot  : Sous-total / Livraison / Total in EUR.
 *          The section is HIDDEN when `pricingSnapshot` is absent (an order
 *          in « en attente de paiement » has no snapshot yet — gracefully
 *          omit rather than render « — » three times).
 *        - Timeline          : one row per `orderEvent` in input order
 *          (backend hands events oldest-first via the `by_order` index);
 *          each row shows the literal status + the FR datetime via
 *          `formatOrderDate`.
 *        - Meta              : mode (FR customer-facing copy
 *          « Livraison » / « À emporter »), source (literal — V1 = `direct`
 *          per ADR 0009), restaurant note (only when present).
 *
 * Close affordances (issue body « Bouton "Fermer" + close on backdrop click
 * + close on Escape »): the shadcn `Dialog` primitive already wires the
 * Escape key + the backdrop click via radix, and `DialogContent` ships the
 * × close button by default (`showCloseButton` defaults to `true`). We add
 * an explicit « Fermer » button in the footer so the affordance is obvious
 * to a non-keyboard gérant on touch.
 *
 * Slice discipline (issue body « PAS de bouton refund encore — c'est le
 * slice suivant »): NO refund button anywhere in the tree. The future
 * F-COMMANDES-REFUND slice will layer it from inside this same component;
 * its absence here is pinned by `order-detail-modal.test.tsx`.
 *
 * Scope discipline (#239 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import type { Doc } from "@packages/backend/convex/_generated/dataModel";
import type { OrderWithDetail } from "@packages/backend/convex/lib/tenancy";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

import { formatPriceCentimes } from "../menu/format-price";
import { formatOrderDate } from "./format-order-date";

export type OrderDetailModalProps = {
  /** Controlled open flag — owned by the page (toggled on row click + on dismiss). */
  open: boolean;
  /** Page-side close handler (the page nulls its selectedOrderId here). */
  onOpenChange: (open: boolean) => void;
  /**
   * The query payload from `useTenantQuery(api.lib.orders.orders.getOrder,
   * {orderId})` resolved on the page:
   *   - `undefined` → query in flight (Convex loading sentinel).
   *   - `null`      → order not found for this tenant (foreign or deleted).
   *   - `OrderWithDetail` → render the four sections.
   */
  detail: OrderWithDetail | null | undefined;
};

/** Customer-facing copy for the `orderMode` enum — single source of truth. */
const MODE_LABEL: Record<Doc<"orders">["mode"], string> = {
  delivery: "Livraison",
  pickup: "À emporter",
};

export function OrderDetailModal({
  open,
  onOpenChange,
  detail,
}: OrderDetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="order-detail-modal" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Détail de la commande</DialogTitle>
          <DialogDescription>
            Items commandés, pricing, historique des statuts.
          </DialogDescription>
        </DialogHeader>
        <OrderDetailBody detail={detail} />
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              data-slot="order-detail-modal-close"
            >
              Fermer
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderDetailBody({
  detail,
}: {
  detail: OrderWithDetail | null | undefined;
}) {
  if (detail === undefined) {
    return <OrderDetailLoading />;
  }
  if (detail === null) {
    return (
      <div
        data-slot="order-detail-modal-not-found"
        className="text-muted-foreground py-8 text-center text-sm"
      >
        Commande introuvable.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ItemsSection items={detail.items} />
      {detail.pricingSnapshot !== undefined ? (
        <>
          <Separator />
          <PricingSection snapshot={detail.pricingSnapshot} />
        </>
      ) : null}
      <Separator />
      <TimelineSection events={detail.events} />
      <Separator />
      <MetaSection
        mode={detail.mode}
        source={detail.source}
        restaurantNote={detail.restaurantNote}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
function OrderDetailLoading() {
  return (
    <div
      data-slot="order-detail-modal-loading"
      className="flex flex-col gap-4 py-2"
    >
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items (frozen) — name + qty + unit price + modifiers per item
// ---------------------------------------------------------------------------
function ItemsSection({ items }: { items: Doc<"orderItems">[] }) {
  return (
    <section
      data-slot="order-detail-modal-items"
      className="flex flex-col gap-3"
    >
      <h3 className="text-sm font-semibold">Articles</h3>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={String(item._id)}
            data-slot="order-detail-modal-item"
            className="flex flex-col gap-1"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                <span className="tabular-nums">{item.quantity} ×</span>{" "}
                {item.itemName}
              </span>
              <span className="text-muted-foreground tabular-nums text-sm">
                {formatPriceCentimes(item.unitPrice)}
              </span>
            </div>
            {item.modifiers.length > 0 ? (
              <ul className="text-muted-foreground flex flex-col gap-0.5 pl-5 text-sm">
                {item.modifiers.map((mod, idx) => (
                  <li
                    key={`${mod.groupName}-${mod.optionName}-${idx}`}
                    data-slot="order-detail-modal-item-modifier"
                  >
                    {mod.groupName} : {mod.optionName}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing snapshot — Sous-total / Livraison / Total
// ---------------------------------------------------------------------------
function PricingSection({
  snapshot,
}: {
  snapshot: NonNullable<Doc<"orders">["pricingSnapshot"]>;
}) {
  return (
    <section
      data-slot="order-detail-modal-pricing"
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-semibold">Pricing</h3>
      <dl className="flex flex-col gap-1 text-sm">
        <PricingRow label="Sous-total" centimes={snapshot.subtotal} />
        <PricingRow label="Livraison" centimes={snapshot.deliveryFee} />
        <PricingRow label="Total" centimes={snapshot.total} emphasized />
      </dl>
    </section>
  );
}

function PricingRow({
  label,
  centimes,
  emphasized = false,
}: {
  label: string;
  centimes: number;
  emphasized?: boolean;
}) {
  return (
    <div
      className={
        emphasized
          ? "flex items-baseline justify-between font-semibold"
          : "flex items-baseline justify-between"
      }
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatPriceCentimes(centimes)}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline — orderEvents in input order (backend hands oldest-first)
// ---------------------------------------------------------------------------
function TimelineSection({ events }: { events: Doc<"orderEvents">[] }) {
  return (
    <section
      data-slot="order-detail-modal-timeline"
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-semibold">Historique</h3>
      <ol className="flex flex-col gap-2">
        {events.map((event) => (
          <li
            key={String(event._id)}
            data-slot="order-detail-modal-event"
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <Badge variant="secondary">{event.status}</Badge>
            <span className="text-muted-foreground tabular-nums">
              {formatOrderDate(event.at)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Meta — mode / source / restaurant note
// ---------------------------------------------------------------------------
function MetaSection({
  mode,
  source,
  restaurantNote,
}: {
  mode: Doc<"orders">["mode"];
  source: Doc<"orders">["source"];
  restaurantNote: string | undefined;
}) {
  return (
    <section
      data-slot="order-detail-modal-meta"
      className="flex flex-col gap-2 text-sm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">Mode</span>
        <span>{MODE_LABEL[mode]}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">Source</span>
        <span>{source}</span>
      </div>
      {restaurantNote !== undefined && restaurantNote.length > 0 ? (
        <div
          data-slot="order-detail-modal-note"
          className="flex flex-col gap-1 pt-2"
        >
          <span className="text-muted-foreground">Note pour le restaurant</span>
          <p className="whitespace-pre-wrap">{restaurantNote}</p>
        </div>
      ) : null}
    </section>
  );
}
