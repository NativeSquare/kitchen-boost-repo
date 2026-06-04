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

  it("AC1 — does NOT use raw `useQuery` for any tenantQuery (would bypass tenantId injection — ADR 0014 §4)", () => {
    // Same discipline as menu/page.test.ts: raw `useQuery` from convex/react
    // auto-injects nothing; using it for a tenantQuery either fails at
    // runtime (Forbidden / missing tenantId) or silently leaks the wrong
    // tenant's data (ADR 0010).
    //
    // EXCEPTION (F-COMMANDES-CSV-EXPORT #244, mirrors QR page #198): a raw
    // `useQuery` IS allowed against the EXISTING root-only kbAdminQuery
    // `api.lib.stripe.account.loadTenantForStripe` (the same primitive the
    // F-SHELL-04 layout uses to resolve a tenant slug for KB Admin
    // impersonation — root-only, takes `tenantId` as an explicit arg, no
    // tenant-injection needed). Every tenantQuery (`listOrders`,
    // `getOrder`) MUST still go through `useTenantQuery`.
    const code = stripNonCode(PAGE_SOURCE);
    // Strip the legitimate exception first: the import line + any
    // `useQuery(api.lib.stripe.account.loadTenantForStripe, ...)` call.
    // What remains must not contain `useQuery` — proof every OTHER use
    // would be a regression that bypassed `useTenantQuery`.
    const stripped = code
      // Allowed import: `import { useQuery } from "convex/react";` (the
      // hook is needed for the root-only `loadTenantForStripe` probe).
      .replace(
        /import\s*\{[^}]*useQuery[^}]*\}\s*from\s*["']convex\/react["'];?/g,
        "",
      )
      // Allowed call: against the EXISTING kbAdminQuery primitive only.
      .replace(
        /useQuery\s*\([^)]*api\.lib\.stripe\.account\.loadTenantForStripe[^)]*\)/g,
        "",
      );
    expect(stripped).not.toMatch(/\buseQuery\b/);
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

  it("AC #238 — does NOT push filter state into the URL (V1 decision: no `useRouter`-driven sync)", () => {
    // EPIC #141 explicitly defers URL-shareable filters to V2. The page
    // does NOT call `useRouter()` to thread the date/status filter into
    // the URL — any such call would mean a slice drifted from the decision.
    //
    // #415 EXCEPTION: the page reads `useSearchParams().get("tab")` ONCE
    // (lazy `useState` initializer) so the monitoring drill-down link
    // (`/t/<id>/commandes?tab=missed`, deriveIncidentDisplay) lands ops
    // on the right tab. This is one-way URL → initial state, NOT a
    // bidirectional sync (no `useRouter().replace` per click). The
    // `useRouter` ban stays in force; `useSearchParams` is permitted
    // for the documented read-once initializer.
    const code = stripNonCode(PAGE_SOURCE);
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

  // -------------------------------------------------------------------------
  // F-COMMANDES-CSV-EXPORT (#244) — the page now wires the « Exporter CSV »
  // button: builds the tenant-slug-resolved filename, hands the filtered
  // orders to `ordersToCsv`, triggers `downloadCsv`. The button is mounted
  // by the view; the page owns the data + the trigger.
  //
  // Decision actée EPIC #141 + issue body: NO backend endpoint — the CSV is
  // generated FROM THE FILTERED PAYLOAD ALREADY IN MEMORY (front-side),
  // never via an extra Convex query.
  // -------------------------------------------------------------------------
  it("AC #244 — imports `ordersToCsv` + `downloadCsv` from the deep pure module", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bordersToCsv\b/);
    expect(code).toMatch(/\bdownloadCsv\b/);
  });

  it("AC #244 — wires the export handler against the FILTERED orders payload (not the raw backend list)", () => {
    // The issue body « Le CSV genere reflete la liste FILTREE (pas la liste
    // brute backend) — le user attend que son filtre date/statut soit
    // respecte. » We pin the handler calls `ordersToCsv(<filtered>)` —
    // i.e. the same variable that's already fed to the view, not a raw
    // unfiltered `orders` reference.
    const code = stripNonCode(PAGE_SOURCE);
    const collapsed = code.replace(/\s+/g, " ");
    // The handler invokes ordersToCsv on the filtered list (variable name
    // « filtered » in the page — pinned by the slice-3 wiring above).
    expect(collapsed).toMatch(/ordersToCsv\s*\(\s*filtered/);
  });

  it("AC #244 — builds the filename via `buildCsvFilename(tenantSlug, ...)` (canonical, single source of truth)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bbuildCsvFilename\b/);
  });

  it("AC #244 — does NOT add a Convex query / mutation / action for the CSV (front-side, no backend)", () => {
    // Issue body « Aucun endpoint backend (decision actee EPIC #141) ». We
    // pin that the page does NOT introduce a NEW `useTenantQuery` /
    // `useTenantAction` / `useTenantMutation` call branded with an `export`
    // / `csv` identifier — the existing two (`listOrders` + `getOrder`) and
    // the refund action are unchanged.
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/api\.[\w.]*csv/i);
    expect(code).not.toMatch(/api\.[\w.]*export/i);
  });

  it("AC #244 — forwards `onExportCsv` to the view (the view mounts the button + relays the click)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bonExportCsv\b/);
  });

  it("AC #244 — resolves the tenant slug from the session (KB Manager) OR the kbAdminQuery (KB Admin)", () => {
    // Filename format « commandes_<tenantSlug>_<YYYYMMDD>.csv ». The slug
    // is the tenant's slug (provisioning emits `[a-z0-9-]+`). The page
    // already reads `useSession()` for the refund role gate (#243); we
    // expose the slug from that same session lookup for the manager path
    // — KB Admin via the same root-override pattern as the QR page.
    const code = stripNonCode(PAGE_SOURCE);
    // We DO NOT pin the exact mechanic (the page can use `session.tenants`
    // for the manager path + the existing admin query for impersonation),
    // but we pin the slug literal surfaces somewhere in the executable
    // code path — proof the filename isn't built on the raw tenantId.
    expect(code).toMatch(/\bslug\b/);
  });

  // -------------------------------------------------------------------------
  // #415 — Manquées tab + order id search.
  // -------------------------------------------------------------------------
  it("AC #415 — composes `applyTabFilter` + `searchOrdersById` on top of `filterOrders`", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\bapplyTabFilter\b/);
    expect(code).toMatch(/\bsearchOrdersById\b/);
  });

  it("AC #415 — reads the initial tab from `?tab=` so the monitoring drill-down lands on « Manquées »", () => {
    // The monitoring drill-down for an `auto_expired_burst` builds
    // `/t/<id>/commandes?tab=missed` via `deriveIncidentDisplay`. The page
    // reads the param ONCE (lazy `useState` initializer) so a click in
    // the monitoring table lands ops on the right tab without an extra
    // step. We pin `useSearchParams` is used (one-way URL → state) and
    // the « missed » literal surfaces in the resolver.
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/\buseSearchParams\b/);
    // The resolver references the tab keys — at the very least the page
    // restricts to `ORDER_TABS` keys to avoid trapping the user on an
    // unknown value.
    expect(code).toMatch(/\bORDER_TABS\b|"all"|'all'/);
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
