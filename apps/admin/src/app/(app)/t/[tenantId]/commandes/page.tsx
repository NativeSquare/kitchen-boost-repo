"use client";

/**
 * F-COMMANDES-PAGE-SHELL (#222) — Route `/t/[tenantId]/commandes/`.
 *
 * First tracer-bullet of EPIC F-COMMANDES #141 (« Liste live des commandes +
 * refund total + export CSV »): mounts the page skeleton with a header
 * « Commandes » + a placeholder card. No data wired yet (issue body « pas de
 * données encore — juste le scaffold prouvant que la route est joignable, le
 * tenant context est résolu via le segment `[tenantId]`, et la page hérite
 * du layout chrome-less »).
 *
 * Subsequent slices of EPIC #141 will wire:
 *   - `useTenantQuery(api.lib.orders.orders.listOrders)` for the live table
 *     (Convex push-based reactivity, no SSE — decision actée 2026-05-29).
 *   - `useTenantQuery(api.lib.orders.orders.getOrder, { orderId })` for the
 *     detail modal.
 *   - The refund total action (signature publique to clarify — Option A vs
 *     B in EPIC #141 « Implementation Decisions »).
 *   - The CSV export (client-side, UTF-8 + BOM + `;` separator, RFC 4180,
 *     zero customer PII — MOAT, ADR 0010).
 *
 * This slice is scaffold-only: no `useTenantQuery`, no `useMutation`, no
 * reference to the canonical queries / refund entrypoints (pinned by
 * `page.test.ts`).
 *
 * Access guard: inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04, #175) — a KB Manager who
 * tries to reach a tenant they don't own is rejected by `decideTenantGate`
 * (UnauthorizedCard with explicit CTA, A4 of the manual E2E checklist)
 * before this page ever renders; a KB Admin reaching a non-existent
 * `tenantId` gets a clean 404. Cross-tenant fuzz at the backend layer is
 * owned by the `tenantQuery` wrappers of `listOrders` / `getOrder`
 * themselves (ADR 0010) — those wrappers refuse Forbidden even if a future
 * regression bypassed the layout. We do NOT duplicate that pin here.
 *
 * Sidebar entry: « Commandes » was already added to the operational sidebar
 * by F-SHELL-06 (#196). The contract is re-pinned from this slice in
 * `sidebar-entry.test.ts` (so a future regression surfaces inside the
 * F-COMMANDES suite and is attributed to the right slice).
 *
 * Scope discipline (#222 hard constraint, mirrors menu/page.tsx,
 * mes-clients/page.tsx, parametres/page.tsx, qr/page.tsx): this file (and
 * its siblings under `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is
 * the ONLY surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, `packages/backend/convex/`, or the shared admin sidebar.
 */

import { CommandesView } from "./commandes-view";

export default function CommandesPage() {
  return <CommandesView />;
}
