/**
 * F-COMMANDES-PAGE-SHELL (#222) + F-COMMANDES-LIVE-TABLE (#227) — `page.tsx`
 * wiring contract.
 *
 * Pinned at the source-file level (same pattern as `parametres/page.test.ts`,
 * `mes-clients/page.test.ts`, `menu/page.test.ts`, `qr/page.test.ts`).
 *
 * Slice 1 (#222) shipped a scaffold-only page (no data wired). Slice 2 (#227,
 * THIS file's contract) wires the live orders table:
 *
 *   page.tsx →
 *     const orders = useTenantQuery(api.lib.orders.orders.listOrders);
 *     return <CommandesView orders={orders} />
 *
 * The Convex reactivity is push-based via WebSocket — no SSE/WebSocket
 * plumbing required (EPIC #141 decision, 2026-05-29). When the backend
 * mutates an order (Stripe webhook `confirmPayment`, kitchen workflow
 * `recordStatus`, refund), the `listOrders` watch refires automatically and
 * the table re-renders without a manual refresh.
 *
 * What's pinned here (acceptance criteria #227):
 *   - AC1 — the page binds `api.lib.orders.orders.listOrders` through
 *     `useTenantQuery` (ADR 0014 §4 / #183), never a raw `useQuery` (which
 *     would bypass tenantId auto-injection — ADR 0010).
 *   - AC1 (no N+1) — the page makes ONE `useTenantQuery` call (a single
 *     subscription per page mount; the issue body « Pas de N+1: une seule
 *     subscription Convex »).
 *   - AC delegation — the page delegates rendering to `CommandesView` (kept
 *     thin so the view's branches stay pinned by `commandes-view.test.tsx`
 *     under the lean `node` vitest env).
 *   - Slice discipline (« Hors scope ce slice: filtres, modal détail,
 *     refund, CSV ») — the source does NOT reference `getOrder` (detail
 *     modal — later slice), does NOT call `useTenantMutation` /
 *     `useTenantAction` (refund — later slice), and does NOT reference the
 *     refund entrypoints (`refundOrder`, `refundOnRefusal`).
 *   - AC scope — never imports from `apps/web` / `apps/native` / the raw
 *     backend functions tree (defensive — a future copy-paste fails here
 *     before the lint rule catches it).
 *
 * AC4 « Navigation vers `/t/<un-tenantId-valide>/commandes` rend la page
 * sans erreur » and AC5 « Un user d'un autre tenant qui essaye d'accéder à
 * l'URL est rejeté par le guard `(app)` déjà en place » are OWNED by the
 * F-SHELL-04 layout — see `commandes-view.test.tsx` and the layout's own
 * pins. Cross-tenant fuzz at the backend layer is owned by the `tenantQuery`
 * wrapper of `listOrders` itself (ADR 0010) — see `withTenant.test.ts`. We
 * do NOT duplicate those pins here.
 *
 * Scope discipline (#227 hard constraint, mirrors menu/page.tsx,
 * mes-clients/page.tsx, parametres/page.tsx, qr/page.tsx): this file (and
 * its siblings under `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is
 * the ONLY surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code, so a
 * docstring referring to (say) `useQuery` or `getOrder` doesn't false-
 * positive — only the actual code matters for the slice discipline pins
 * (same pattern as the sibling page tests).
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — F-COMMANDES-LIVE-TABLE (#227) wiring contract", () => {
  it("AC1 — exports a default function (the Next.js App Router page contract)", () => {
    // Either `export default function CommandesPage(...)` or `export default
    // <Identifier>` is acceptable — both satisfy the Next.js page convention.
    expect(PAGE_SOURCE).toMatch(/export\s+default\s+(?:function|\w)/);
  });

  it("AC delegation — delegates rendering to `CommandesView` (keeps the page thin + the view testable in node env)", () => {
    expect(PAGE_SOURCE).toMatch(/CommandesView/);
  });

  it("AC1 — binds `api.lib.orders.orders.listOrders` via `useTenantQuery` (not raw useQuery — ADR 0014 §4 / #183)", () => {
    // The page reads the tenant's orders through the canonical tenantQuery
    // (ADR 0014 §4 / #183) — never a raw `useQuery` (which would bypass
    // tenantId auto-injection, ADR 0010 — either the call would fail with a
    // Forbidden, or — worse — silently leak the wrong tenant's data).
    //
    // Assert against the STRIPPED source (no docstrings) so a comment merely
    // mentioning `useTenantQuery` doesn't false-positive — the wiring must
    // exist in executable code (same shape as menu/page.test.ts).
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useTenantQuery/);
    // Collapse whitespace so a Prettier line-wrap inside the call still
    // matches.
    const collapsed = code.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.orders\.orders\.listOrders[^)]*\)/,
    );
  });

  it("AC1 — does NOT use a raw `useQuery` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // Same discipline as menu/page.test.ts: raw `useQuery` from convex/react
    // auto-injects nothing; using it for a tenantQuery either fails at
    // runtime (Forbidden / missing tenantId) or silently leaks the wrong
    // tenant's data (ADR 0010).
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("AC1 (no N+1) — calls `useTenantQuery` exactly ONCE on `listOrders` (single subscription per page mount)", () => {
    // The issue body « Pas de N+1: une seule subscription Convex » — we pin
    // that the source has exactly one `listOrders`-bound call. Multiple
    // `useTenantQuery` calls in the file would be allowed (e.g. a later
    // slice will add `getOrder` for the detail modal), but each must hit a
    // distinct query name; for slice 2 (#227) we should see exactly one
    // `listOrders` reference in executable code.
    const code = stripNonCode(PAGE_SOURCE);
    const matches = code.match(/listOrders/g) ?? [];
    expect(matches.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // F-COMMANDES-DETAIL-MODAL (#239) — the page now layers `OrderDetailModal`
  // on top of the table. It owns the selected order id (`useState`), binds
  // `api.lib.orders.orders.getOrder` via `useTenantQuery` (skipped while no
  // row is selected, so no extra subscription is opened on first mount —
  // « Pas de N+1 »), and renders `<OrderDetailModal />` when a row is
  // selected.
  // -------------------------------------------------------------------------
  it("AC #239 — binds `api.lib.orders.orders.getOrder` via `useTenantQuery` (modal payload)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bgetOrder\b/);
    const collapsed = code.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.orders\.orders\.getOrder[^)]*\)/,
    );
  });

  it("AC #239 — skips the `getOrder` subscription while no row is selected (no extra fetch on first mount)", () => {
    // The page must pass `"skip"` to `useTenantQuery(getOrder, ...)` when
    // the selected order id is null — otherwise Convex would open a
    // subscription on EVERY page mount, even before the gérant clicks a
    // row (« Pas de N+1: une seule subscription Convex » remains the
    // invariant of the live table; getOrder only opens once a row is
    // selected).
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/"skip"|'skip'/);
  });

  it("AC #239 — mounts `OrderDetailModal` (the detail modal component)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bOrderDetailModal\b/);
  });

  it("AC #239 — forwards a row-click handler to the view via `onOrderClick`", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bonOrderClick\b/);
  });

  it("slice discipline — does NOT call raw `useMutation` / `useAction` / `useTenantMutation` (refund is an ACTION, must go through the auto-tenant `useTenantAction` hook — ADR 0014 §4)", () => {
    // F-COMMANDES-REFUND (#243) wires the refund via `useTenantAction`
    // (the action twin of `useTenantMutation`). The page must NOT use
    // raw `useMutation` / `useAction` (bypasses tenantId auto-injection,
    // ADR 0014 §4 / ADR 0010), and must NOT use `useTenantMutation`
    // (refundOrder is an action, not a mutation).
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseTenantMutation\b/);
    expect(code).not.toMatch(/\buseMutation\b/);
    expect(code).not.toMatch(/\buseAction\b/);
  });

  // -------------------------------------------------------------------------
  // F-COMMANDES-FILTERS (#238) — filter state lives on the page (EPIC #141
  // decision: `useState` on the page, no URL query params V1). The pure
  // `filterOrders(orders, {dateRange, statuses})` is applied before passing
  // the result down to the view — proof the filter re-applies on every Convex
  // push without any extra useEffect plumbing (AC: « le filtre s'applique au
  // resultat live, pas a un snapshot »).
  // -------------------------------------------------------------------------
  it("AC #238 — holds the filter state on the page via `useState`", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\buseState\b/);
  });

  it("AC #238 — applies the pure `filterOrders` to the live orders payload before rendering", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bfilterOrders\b/);
  });

  it("AC #238 — does NOT add URL query params (V1 decision: no router/searchParams plumbing)", () => {
    // EPIC #141 explicitly defers URL-shareable filters to V2. We pin that
    // the page does NOT pull `useSearchParams` / `useRouter` to thread the
    // filter into the URL — any such call would mean a slice drifted from
    // the decision.
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseSearchParams\b/);
    expect(code).not.toMatch(/\buseRouter\b/);
  });

  // F-COMMANDES-REFUND (#243) — the page now wires the public refund
  // entrypoint `api.lib.stripe.refund.refundOrder` via `useTenantAction`,
  // and forwards the trigger to the modal. The internal `refundOnRefusal`
  // (system-side, used by the kitchen Refusal workflow) MUST NOT be
  // referenced — the manager-driven refund goes through the dedicated
  // public action (issue body #243).
  it("AC #243 — binds `api.lib.stripe.refund.refundOrder` via `useTenantAction` (refund flow)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\brefundOrder\b/);
    expect(code).toMatch(/\buseTenantAction\b/);
    const collapsed = code.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantAction\([^)]*api\.lib\.stripe\.refund\.refundOrder[^)]*\)/,
    );
  });

  it("slice discipline (#243) — does NOT reference the internal `refundOnRefusal` (system-side path is for kitchen Refusal, not manager-driven)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\brefundOnRefusal\b/);
  });

  it("AC #243 — wraps the refund trigger in try/catch + toast.error + getConvexErrorMessage (same discipline as menu CRUD)", () => {
    // The refund action can throw `NOT_REFUNDABLE` / `STRIPE_ERROR` /
    // `NOT_FOUND` (issue body #243 + #221). The page surfaces the failure
    // via the wire message — same pattern as item / category CRUD
    // (`apps/admin/src/app/(app)/t/[tenantId]/menu/page.tsx`).
    expect(PAGE_SOURCE).toMatch(/from\s+["']sonner["']/);
    expect(PAGE_SOURCE).toMatch(/getConvexErrorMessage/);
    const code = stripNonCode(PAGE_SOURCE);
    // The handler awaits refundOrder, catches, and surfaces toast.error
    // with getConvexErrorMessage — collapse whitespace + match within a
    // reasonable handler window (same shape as menu/page.test.ts).
    const collapsed = code.replace(/\s+/g, " ");
    // The try-body contains nested `{ orderId }` braces; use a permissive
    // greedy/lazy match (collapsed single-line) — same shape as the menu
    // page test but tolerating nested brace pairs in the body.
    expect(collapsed).toMatch(/try\s*\{[\s\S]*?refund[\s\S]*?\}\s*catch/i);
    expect(collapsed).toMatch(/toast\.error\([\s\S]*?getConvexErrorMessage/);
  });

  it("AC #243 — emits a success toast after the refund completes (« Commande remboursée »)", () => {
    // Issue body: « Succès -> toast vert "Commande remboursée" + modal se ferme ».
    expect(PAGE_SOURCE).toMatch(/toast\.success/);
    expect(PAGE_SOURCE).toMatch(/Commande rembours/);
  });

  it("AC #243 — gates the refund affordance by role: passes `onRefund` ONLY when the active tenant-role is `kb_manager` (or KB Admin via root override)", () => {
    // The issue body: « visible uniquement si role = kb_manager ; PAS staff ;
    // KB Admin passe via root override backend ». The page reads the active
    // tenant-role from `useSession()` (the role per tenant lives there) and
    // only forwards `onRefund` to the modal when allowed. We pin the
    // mechanics (session lookup + kb_manager literal in the gate).
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useSession/);
    expect(code).toMatch(/kb_manager/);
    // Negative pin: the page MUST NOT pass `onRefund` to a `staff` user
    // (the negative is enforced by the gate; we pin the staff literal so a
    // copy-paste regression that flips the comparison is caught here).
    expect(code).toMatch(/\bstaff\b/);
  });

  it("AC #243 — forwards the refund affordance to the modal via dedicated props (onRefund / canRefund / refundAmountCentimes)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bonRefund\b/);
    expect(code).toMatch(/\bcanRefund\b/);
    expect(code).toMatch(/\brefundAmountCentimes\b/);
  });

  it("AC scope — never imports from `apps/web`, `apps/native`, or the backend `functions` tree", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // No cross-app imports. The page lives in apps/admin; touching apps/web
    // or apps/native would explode the scope (issue header hard rule).
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
    // Backend imports MUST go through the generated barrel (`api` from
    // `_generated/api`) or the dataModel — never the raw functions tree.
    expect(code).not.toMatch(/@packages\/backend\/convex\/lib\//);
  });
});
