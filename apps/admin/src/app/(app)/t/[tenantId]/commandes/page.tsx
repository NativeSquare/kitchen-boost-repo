"use client";

/**
 * F-COMMANDES-PAGE-SHELL (#222) + F-COMMANDES-LIVE-TABLE (#227) +
 * F-COMMANDES-FILTERS (#238) + F-COMMANDES-DETAIL-MODAL (#239) +
 * F-COMMANDES-REFUND (#243) + F-COMMANDES-CSV-EXPORT (#244) —
 * Route `/t/[tenantId]/commandes/`.
 *
 * Slice 1 (#222) shipped a scaffold-only page (no data wired). Slice 2 (#227)
 * wired the live orders table. Slice 3 (#238) added the filter state +
 * pure `filterOrders` pipe. Slice 4 (#239, THIS file's current contract)
 * layers the read-only `OrderDetailModal` on top:
 *
 *   const orders = useTenantQuery(api.lib.orders.orders.listOrders);
 *   const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(null);
 *   const detail = useTenantQuery(
 *     api.lib.orders.orders.getOrder,
 *     selectedOrderId === null ? "skip" : { orderId: selectedOrderId },
 *   );
 *   return (
 *     <>
 *       <CommandesView orders={filtered} … onOrderClick={setSelectedOrderId} />
 *       <OrderDetailModal
 *         open={selectedOrderId !== null}
 *         onOpenChange={(o) => o || setSelectedOrderId(null)}
 *         detail={detail}
 *       />
 *     </>
 *   );
 *
 * Why this shape:
 *   - `useTenantQuery` (ADR 0014 paragraph 4 / #183) reads `tenantId` from
 *     `<TenantProvider/>` (mounted by the chrome-less `/t/[tenantId]` layout)
 *     and injects it into the args. The page does NOT thread `tenantId` by
 *     hand and does NOT call raw `useQuery` (which would either fail
 *     Forbidden or — worse — silently leak the wrong tenant's data, ADR
 *     0010).
 *   - Both queries are tenant-scoped on the backend: `listOrders` and
 *     `getOrder` use `tenantQuery({allow: ["kb_manager", "staff"]})` (cf.
 *     `packages/backend/convex/lib/orders/orders.ts`). The kitchen workflow
 *     + staff visibility are honoured by the wrapper; the page mounts under
 *     the `(app)/t/[tenantId]` layout that gates access.
 *   - The detail subscription opens ONLY once a row is clicked — `"skip"`
 *     until then. So « pas de N+1 » remains the invariant: on first mount
 *     we still hold a single live subscription (`listOrders`). The
 *     `getOrder` subscription is bounded by the modal's lifetime; closing
 *     it nulls `selectedOrderId` which re-skips the query and unwatches.
 *   - `filterOrders` is pure and re-runs on every render — a live Convex
 *     push that lands while a filter is active produces a fresh `orders`
 *     payload, the filter re-applies, and the table includes/hides the new
 *     line according to the current selection (AC8 « le filtre s'applique
 *     au résultat live, pas a un snapshot »). No `useEffect`, no derived
 *     state, no race against a snapshot.
 *
 * Reactivity (EPIC #141 decision, 2026-05-29): Convex's WebSocket transport
 * pushes a fresh result whenever any backend mutation touches the tenant's
 * orders (Stripe webhook `confirmPayment` flipping `en attente de paiement →
 * nouvelle`, kitchen workflow `recordStatus`, refund). Both the table AND
 * the modal update without manual refresh — no SSE/WebSocket plumbing
 * required.
 *
 * Access guard: inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04, #175) — a KB Manager who
 * tries to reach a tenant they don't own is rejected by `decideTenantGate`
 * before this page ever renders; a KB Admin reaching a non-existent
 * `tenantId` gets a clean 404. Cross-tenant fuzz at the backend layer is
 * owned by the `tenantQuery` wrapper of `listOrders` / `getOrder`
 * themselves (ADR 0010) — the wrapper refuses Forbidden even if a future
 * regression bypassed the layout. We do NOT duplicate those pins here.
 *
 * Sidebar entry: the « Commandes » entry was added to the operational
 * sidebar by F-SHELL-06 (#196); its contract is re-pinned from
 * `sidebar-entry.test.ts`.
 *
 * F-COMMANDES-REFUND (#243) wires the manager-driven refund:
 *   - `api.lib.stripe.refund.refundOrder` via `useTenantAction` (the action
 *     twin of `useTenantMutation` — ADR 0014 §4 auto-injects `tenantId`).
 *   - RBAC: `onRefund` is forwarded to the modal ONLY when the active
 *     tenant-role is `kb_manager` (the backend allow-list) OR when the
 *     user is `kb_admin` (root override). `staff` gets `onRefund:
 *     undefined`, so no button mounts (the modal renders nothing if any of
 *     `onRefund` / `canRefund` / `refundAmountCentimes` is missing).
 *   - Refundability gate (mirror of the backend `NOT_REFUNDABLE` guard):
 *     `paidAt` set + status !== `refusée`. Computed from the live
 *     `getOrder` payload, so the CTA hides instantly when Convex pushes a
 *     fresh status (e.g. another tab refunded the same order).
 *   - On success: `toast.success("Commande remboursée")` + close the
 *     parent modal (sets `selectedOrderId = null`). The Convex reactivity
 *     already flips the row to `refusée` in the table — no manual refresh.
 *   - On error: `toast.error(getConvexErrorMessage(error))` with the wire
 *     message (same discipline as the menu CRUD page). The modal stays
 *     open so the gérant keeps the context.
 *
 * F-COMMANDES-CSV-EXPORT (#244) wires the « Exporter CSV » button in the
 * page header:
 *   - The button is mounted by `CommandesView` (single source of truth for
 *     the label / slot / disabled state); the page owns the click handler
 *     because IT knows the FILTERED orders + the tenant slug + the canonical
 *     filename builder.
 *   - The handler hands `filtered` (NOT raw `orders`) to `ordersToCsv` —
 *     issue body « Le CSV genere reflete la liste FILTREE » (the gérant
 *     expects their date/status filter to be respected in the export).
 *   - The filename uses `buildCsvFilename(slug, Date.now())` →
 *     `commandes_<tenantSlug>_<YYYYMMDD>.csv` per issue body.
 *   - Slug resolution mirrors the QR page (#198): KB Manager reads it from
 *     `session.tenants[*].slug`; KB Admin under root-override reads the full
 *     tenant doc via the existing `kbAdminQuery`
 *     `api.lib.stripe.account.loadTenantForStripe` (no new endpoint — issue
 *     body « Aucun endpoint backend »). When neither source resolves a slug
 *     (transient race during impersonation), the button stays mounted but
 *     the click no-ops — same defensive pattern as the QR page's `null`
 *     guard.
 *   - Zero new Convex query / mutation / action for the CSV — the export is
 *     fully front-side (EPIC #141 decision; `useQuery` for the admin slug
 *     reuses the EXISTING root-only entrypoint, doesn't introduce one).
 *
 * Scope discipline (#239 hard constraint, mirrors menu/page.tsx,
 * mes-clients/page.tsx, parametres/page.tsx, qr/page.tsx): this file (and
 * its siblings under `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is
 * the ONLY surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, `packages/backend/convex/`, or the shared admin sidebar.
 */

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantAction, useTenantQuery } from "@/hooks";
import { useSession } from "@/lib/session";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { CommandesView } from "./commandes-view";
import { OrderDetailModal } from "./order-detail-modal";
import { buildCsvFilename, downloadCsv, ordersToCsv } from "./orders-csv";
import {
  filterOrders,
  type DateRangeKey,
  type OrderStatus,
  type OrdersFilter,
} from "./orders-filtering";

/**
 * Initial filter state on first mount: « tout » date range + no status
 * filter (the gérant sees everything, then narrows down). EPIC #141 actes
 * this as the default — they want to scan all recent activity by default,
 * not be greeted with an empty table because of an implicit filter.
 */
const DEFAULT_FILTER: OrdersFilter = {
  dateRange: "tout",
  statuses: [],
};

export default function CommandesPage() {
  const orders = useTenantQuery(api.lib.orders.orders.listOrders, {});
  const [filter, setFilter] = useState<OrdersFilter>(DEFAULT_FILTER);

  // F-COMMANDES-DETAIL-MODAL (#239) — page-owned modal state. `null` =
  // closed, no `getOrder` subscription open. Otherwise the id of the order
  // whose detail is showing. We use a single piece of state (not separate
  // `open` + `selectedId`) so a stale id can never linger after close.
  const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(
    null,
  );

  // Bind `getOrder` via useTenantQuery, but pass "skip" until a row is
  // selected — otherwise Convex would open a subscription on every page
  // mount even before the gérant clicks a row (« Pas de N+1 » remains the
  // invariant from F-COMMANDES-LIVE-TABLE; the detail subscription only
  // opens on demand). Once selected, the query refires on every backend
  // mutation that touches THIS order — the modal stays live without manual
  // refresh, mirroring the table's reactivity discipline.
  const detail = useTenantQuery(
    api.lib.orders.orders.getOrder,
    selectedOrderId === null ? "skip" : { orderId: selectedOrderId },
  );

  // F-COMMANDES-REFUND (#243) — bind the public manager-driven refund
  // action. ADR 0014 §4: `useTenantAction` auto-injects `tenantId` from the
  // URL, the page only forwards the `orderId`. Backend RBAC
  // (`tenantAction({allow:["kb_manager"]})` + root override) is the source
  // of truth; the front-side gate below mirrors it to hide the affordance
  // for `staff` (so they never see a button they couldn't click anyway).
  const triggerRefund = useTenantAction(api.lib.stripe.refund.refundOrder);

  // RBAC mirror — issue body #243: « visible uniquement si role = kb_manager
  // ; PAS staff ; KB Admin passe via root override backend ». KB Admin is
  // detected via `session.isAdmin === true`; a tenant-attached kb_manager
  // is detected via the per-tenant role on `session.tenants`. `staff` falls
  // through to `false` and the modal does not mount the refund button.
  const session = useSession();
  const activeRole: "kb_admin" | "kb_manager" | "staff" | null =
    session.status === "ready"
      ? session.session.isAdmin
        ? "kb_admin"
        : (session.session.tenants.find(
            (t) => selectedOrderId !== null && t.tenantId === detail?.tenantId,
          )?.role ?? null)
      : null;
  const canRefundRole =
    activeRole === "kb_admin" || activeRole === "kb_manager";

  // Refundability mirror — issue body #243: « visible uniquement si
  // order.paidAt est set ET order.status !== "refusée" ». The backend
  // `refundOrder` re-checks both BEFORE the Stripe call (issue #221), the
  // front gate only avoids showing a button that would throw on click.
  const canRefund =
    detail !== undefined &&
    detail !== null &&
    detail.paidAt !== undefined &&
    detail.status !== "refusée" &&
    canRefundRole;

  // Amount surfaced in the CTA + confirm dialog. Falls back to undefined
  // when the snapshot isn't frozen yet (paidAt would also be absent in
  // that case, so `canRefund` is false — the modal hides the button).
  const refundAmountCentimes =
    detail !== undefined && detail !== null
      ? detail.pricingSnapshot?.total
      : undefined;

  const handleDateRangeChange = (next: DateRangeKey) => {
    setFilter((prev) => ({ ...prev, dateRange: next }));
  };
  const handleStatusesChange = (next: OrderStatus[]) => {
    setFilter((prev) => ({ ...prev, statuses: next }));
  };
  const handleOrderClick = (orderId: Id<"orders">) => {
    setSelectedOrderId(orderId);
  };
  const handleOpenChange = (open: boolean) => {
    if (!open) setSelectedOrderId(null);
  };

  // F-COMMANDES-REFUND (#243) — refund handler. The modal owns the local
  // pending flag during the await (so the « Confirmer » button can disable
  // itself + spin); the page owns the toast + the parent-modal close on
  // success. On failure we surface the wire message via
  // `getConvexErrorMessage` — the backend throws ConvexError with
  // NOT_REFUNDABLE / NOT_FOUND / STRIPE_ERROR / INVALID_STATE (see #221).
  const handleRefund = async (
    _input: { reason?: string } = {},
  ): Promise<void> => {
    if (selectedOrderId === null) return;
    try {
      await triggerRefund({ orderId: selectedOrderId });
      toast.success("Commande remboursée");
      // Close the parent modal on success — the table reactively flips
      // the row to « refusée » via the Convex push, no manual refresh.
      setSelectedOrderId(null);
    } catch (error) {
      toast.error("Impossible de rembourser la commande", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  // Apply the pure predicate to the live payload — re-runs on every Convex
  // push because the `orders` reference changes when the wrapper re-fires
  // (AC8 « le filtre s'applique au resultat live »). Memoised on
  // (orders, filter) to avoid re-filtering on unrelated re-renders.
  const filtered = useMemo(
    () => (orders === undefined ? undefined : filterOrders(orders, filter)),
    [orders, filter],
  );

  // F-COMMANDES-CSV-EXPORT (#244) — resolve the tenant slug for the export
  // filename. Mirror of the QR page pattern (#198): KB Manager reads it from
  // `session.tenants` (`SessionTenant.slug`); KB Admin under root-override
  // reads the full tenant doc via the EXISTING root-only kbAdminQuery
  // `loadTenantForStripe` (incidentally named — re-used by the F-SHELL-04
  // layout for the same purpose). No new endpoint introduced.
  const tenantId = useCurrentTenantId();
  const isAdmin =
    session.status === "ready" && session.session.isAdmin === true;
  const adminTenantDoc = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    isAdmin ? { tenantId } : "skip",
  );
  const sessionTenant =
    session.status === "ready"
      ? (session.session.tenants.find((t) => t.tenantId === tenantId) ?? null)
      : null;
  // Admin doc wins when available (it has the canonical `slug` for an
  // impersonation case where the admin isn't a member of the tenant).
  const tenantSlug = adminTenantDoc?.slug ?? sessionTenant?.slug ?? null;

  const handleExportCsv = (): void => {
    // Defensive: filtered must be ready AND non-empty, AND we must have
    // resolved a tenant slug. The view's button is already disabled when
    // `orders === undefined || orders.length === 0`; this guard covers
    // the transient impersonation race where the admin tenant doc is in
    // flight (the button is enabled by the filtered data, but the slug
    // isn't ready yet).
    if (filtered === undefined || filtered.length === 0) return;
    if (tenantSlug === null) return;
    const filename = buildCsvFilename(tenantSlug);
    downloadCsv(filename, ordersToCsv(filtered));
  };

  return (
    <>
      <CommandesView
        orders={filtered}
        filter={filter}
        onDateRangeChange={handleDateRangeChange}
        onStatusesChange={handleStatusesChange}
        onOrderClick={handleOrderClick}
        onExportCsv={handleExportCsv}
      />
      <OrderDetailModal
        open={selectedOrderId !== null}
        onOpenChange={handleOpenChange}
        detail={detail}
        onRefund={canRefundRole ? handleRefund : undefined}
        canRefund={canRefund}
        refundAmountCentimes={refundAmountCentimes}
      />
    </>
  );
}
