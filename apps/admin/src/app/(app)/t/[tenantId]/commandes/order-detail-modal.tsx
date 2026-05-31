"use client";

/**
 * F-COMMANDES-DETAIL-MODAL (#239) + F-COMMANDES-REFUND (#243) —
 * `OrderDetailModal`, the modal that opens when the gérant clicks a row of
 * the orders table.
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
 * F-COMMANDES-REFUND (#243) — the refund affordance is OPT-IN via props:
 * the modal renders the « Rembourser intégralement » CTA + the confirm
 * `AlertDialog` ONLY when the page passes BOTH `onRefund` (the
 * `useTenantAction(refundOrder)` trigger) AND `canRefund: true`. The page
 * owns the role gating (`kb_manager` or KB Admin via root override —
 * `staff` gets `onRefund: undefined` so no button surfaces) and the
 * refundability gate (`paidAt` set + status !== `refusée`). The modal stays
 * a pure function of its props — no `useAction`, no role lookup, no
 * `useState` outside the local reason-text field.
 *
 * Scope discipline (#239 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import { useState } from "react";

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

import { formatPriceCentimes } from "../menu/format-price";
import { formatOrderDate } from "./format-order-date";

/**
 * F-COMMANDES-REFUND (#243) — cap on the optional reason field. Issue body:
 * « champ raison libre OPTIONNELLE (texte, max 500 chars) ». The input is
 * controlled — onChange truncates above the cap, and the `maxLength` HTML
 * attribute is the structural safety net (pinned by the modal test).
 */
const REFUND_REASON_MAX_LENGTH = 500;

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
  /**
   * F-COMMANDES-REFUND (#243) — refund trigger wired by the page via
   * `useTenantAction(api.lib.stripe.refund.refundOrder)`. UNDEFINED ⇒ the
   * modal renders no refund button (e.g. the active role is `staff`, or
   * the page deliberately defers the affordance). The optional `reason` is
   * forwarded only for client-side audit / future logging — the backend
   * `refundOrder` does not accept a reason argument V1, but capturing it on
   * the front lets a later slice persist it without changing this contract.
   */
  onRefund?: (input: { reason?: string }) => Promise<void>;
  /**
   * F-COMMANDES-REFUND (#243) — page-side refundability gate. The modal
   * renders the CTA ONLY when ALL of `onRefund`, `canRefund: true`, and a
   * positive `refundAmountCentimes` are provided. The page sets `false`
   * when `paidAt` is absent, when `status === "refusée"`, or when the role
   * is not allowed (RBAC mirror of the backend allow-list).
   */
  canRefund?: boolean;
  /**
   * F-COMMANDES-REFUND (#243) — the amount surfaced in the CTA label and
   * the confirm dialog. Centimes integer (same convention as the rest of
   * the pricing surface — `formatPriceCentimes`).
   */
  refundAmountCentimes?: number;
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
  onRefund,
  canRefund,
  refundAmountCentimes,
}: OrderDetailModalProps) {
  // F-COMMANDES-REFUND (#243) — the refund affordance is gated on ALL three
  // props being satisfied. We resolve the boolean once so the conditional
  // tree below stays scannable. A `refundAmountCentimes` of `0` is treated
  // as « nothing to refund » and hides the CTA (the backend would throw
  // INVALID_STATE anyway — no need to let the gérant click).
  const refundEnabled =
    onRefund !== undefined &&
    canRefund === true &&
    typeof refundAmountCentimes === "number" &&
    refundAmountCentimes > 0;

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
          {refundEnabled ? (
            <RefundAffordance
              amountCentimes={refundAmountCentimes}
              onRefund={onRefund}
            />
          ) : null}
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

// ---------------------------------------------------------------------------
// F-COMMANDES-REFUND (#243) — refund CTA + confirm AlertDialog
//
// Self-contained: owns the AlertDialog open state (so the gérant can cancel
// without closing the parent modal), the optional reason text (capped at 500
// chars), and the pending flag during the action call. The parent modal stays
// pure — it just renders this subtree when the page passes the refund props.
//
// The confirm action is the LAST piece of UX before the irreversible Stripe
// refund: the gérant has already seen the amount in the CTA label; the
// dialog re-shows it prominently + asks for an optional reason. A re-trigger
// is prevented by the `pending` flag (button disabled + spinner copy).
// ---------------------------------------------------------------------------
function RefundAffordance({
  amountCentimes,
  onRefund,
}: {
  amountCentimes: number;
  onRefund: (input: { reason?: string }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const formatted = formatPriceCentimes(amountCentimes);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      const trimmed = reason.trim();
      await onRefund(trimmed.length === 0 ? {} : { reason: trimmed });
    } finally {
      // Always release the pending flag even on throw — the parent page
      // surfaces the error via `toast.error` and the modal will close on
      // success. If the action throws, the gérant can retry from the same
      // (still-open) dialog.
      setPending(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          data-slot="order-detail-modal-refund"
        >
          Rembourser {formatted}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        {/*
          F-COMMANDES-REFUND (#243) — an explicit wrapper carries the
          `order-detail-modal-refund-confirm` slot so the node-env tree-
          serializer surfaces it even when `AlertDialogContent` is mocked as
          a passthrough (the radix primitive itself would carry the data-
          slot in production via shadcn's wrapper; in node we need our own
          slot anchor).
        */}
        <div data-slot="order-detail-modal-refund-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Rembourser intégralement</AlertDialogTitle>
            <AlertDialogDescription>
              Le client recevra un remboursement total de{" "}
              <span
                className="font-semibold"
                data-slot="order-detail-modal-refund-amount"
              >
                {formatted}
              </span>{" "}
              sur le moyen de paiement utilisé. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <label
              htmlFor="order-detail-modal-refund-reason-input"
              className="text-muted-foreground text-sm"
            >
              Raison (optionnelle)
            </label>
            <textarea
              id="order-detail-modal-refund-reason-input"
              data-slot="order-detail-modal-refund-reason"
              value={reason}
              onChange={(e) =>
                setReason(e.target.value.slice(0, REFUND_REASON_MAX_LENGTH))
              }
              maxLength={REFUND_REASON_MAX_LENGTH}
              className="border-input bg-background min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Ex. produit manquant à la livraison."
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => {
                // Fire-and-await: the AlertDialog closes on its default
                // click behaviour, the parent page closes the parent modal
                // on success (toast.success) and surfaces toast.error on
                // failure (the parent modal stays open so the gérant keeps
                // the context).
                void handleConfirm();
              }}
              data-slot="order-detail-modal-refund-confirm-action"
            >
              {pending
                ? "Remboursement en cours…"
                : "Confirmer le remboursement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
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
