"use client";

/**
 * F-COMMANDES-PAGE-SHELL (#222) + F-COMMANDES-LIVE-TABLE (#227) —
 * Route `/t/[tenantId]/commandes/`.
 *
 * Slice 1 (#222) shipped a scaffold-only page (no data wired). Slice 2 (#227,
 * THIS file's contract) wires the live orders table to the canonical Convex
 * read:
 *
 *   const orders = useTenantQuery(api.lib.orders.orders.listOrders);
 *   return <CommandesView orders={orders} />;
 *
 * Why this shape:
 *   - `useTenantQuery` (ADR 0014 paragraph 4 / #183) reads `tenantId` from
 *     `<TenantProvider/>` (mounted by the chrome-less `/t/[tenantId]` layout)
 *     and injects it into the args. The page does NOT thread `tenantId` by
 *     hand and does NOT call raw `useQuery` (which would either fail
 *     Forbidden or — worse — silently leak the wrong tenant's data, ADR
 *     0010).
 *   - The query is already `tenantQuery({allow: ["kb_manager", "staff"]})`
 *     server-side, indexed `by_tenant_status`, sort DESC on `createdAt`
 *     (cf. `packages/backend/convex/lib/orders/orders.ts`). The kitchen
 *     workflow + staff visibility are honoured by the wrapper; the page
 *     mounts under the `(app)/t/[tenantId]` layout that gates access.
 *   - One single subscription per page mount (no N+1): we ONLY call
 *     `useTenantQuery` once, on `listOrders`. The detail modal (`getOrder`),
 *     the refund action, and the filters land in subsequent slices of EPIC
 *     #141.
 *   - The view is a pure function of the prop; the three branches
 *     (loading / empty / populated) live in `CommandesView` → `OrdersTable`
 *     and are pinned by their respective tests under the lean `node`
 *     vitest env.
 *
 * Reactivity (EPIC #141 decision, 2026-05-29): Convex's WebSocket transport
 * pushes a fresh result whenever any backend mutation touches the tenant's
 * orders (Stripe webhook `confirmPayment` flipping `en attente de paiement →
 * nouvelle`, kitchen workflow `recordStatus`, refund). The table updates
 * without manual refresh — no SSE/WebSocket plumbing required.
 *
 * Access guard: inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04, #175) — a KB Manager who
 * tries to reach a tenant they don't own is rejected by `decideTenantGate`
 * before this page ever renders; a KB Admin reaching a non-existent
 * `tenantId` gets a clean 404. Cross-tenant fuzz at the backend layer is
 * owned by the `tenantQuery` wrapper of `listOrders` itself (ADR 0010) —
 * the wrapper refuses Forbidden even if a future regression bypassed the
 * layout. We do NOT duplicate those pins here.
 *
 * Sidebar entry: the « Commandes » entry was added to the operational
 * sidebar by F-SHELL-06 (#196); its contract is re-pinned from
 * `sidebar-entry.test.ts`.
 *
 * Out of scope this slice (later slices of EPIC #141): filtres date/statut,
 * modal détail, action remboursement, export CSV. The page therefore does
 * NOT call `useTenantMutation` / `useTenantAction` / a refund entrypoint,
 * and does NOT reference `getOrder` — see `page.test.ts` for the negative
 * pins.
 *
 * Scope discipline (#227 hard constraint, mirrors menu/page.tsx,
 * mes-clients/page.tsx, parametres/page.tsx, qr/page.tsx): this file (and
 * its siblings under `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is
 * the ONLY surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, `packages/backend/convex/`, or the shared admin sidebar.
 */

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantQuery } from "@/hooks";

import { CommandesView } from "./commandes-view";

export default function CommandesPage() {
  const orders = useTenantQuery(api.lib.orders.orders.listOrders, {});
  return <CommandesView orders={orders} />;
}
