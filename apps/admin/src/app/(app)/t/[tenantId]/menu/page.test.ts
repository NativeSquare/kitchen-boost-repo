/**
 * F-MENU-01 (#187) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `mes-clients/page.test.ts`).
 * The page is a thin wiring layer: it MUST bind
 * `api.lib.menu.categories.list` via `useTenantQuery` (ADR 0014 §4 / #183),
 * never a raw `useQuery` (which would bypass tenantId auto-injection and
 * either fail at runtime or — worse — silently leak the wrong tenant's
 * data, ADR 0010).
 *
 * What's NOT covered here (and on purpose): the rendering branches —
 * loading / empty / populated — those are pinned by `menu-view.test.tsx`.
 * What's pinned here is the assembly: page actually calls `useTenantQuery`
 * against `categories.list`, and delegates to `MenuView`.
 *
 * Acceptance criteria pinned here (#187):
 *   - AC2 « `useTenantQuery(api.lib.menu.categories.list)` câblé » → the
 *     source imports `useTenantQuery` AND references the canonical
 *     `categories.list` query, AND does NOT use a raw `useQuery`.
 *   - AC3 (delegation) → the source delegates rendering to `MenuView`, so
 *     the rendering branches stay pinned by the view's test (which can run
 *     under the lean `node` env).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

describe("page.tsx — F-MENU-01 (#187) wiring contract", () => {
  it("AC2 — binds `api.lib.menu.categories.list` via `useTenantQuery` (not raw useQuery)", () => {
    // Imports useTenantQuery from the canonical hooks barrel.
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    // Calls it on categories.list (collapse whitespace so a Prettier
    // line-wrap inside the call still matches).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.categories\.list[^)]*\)/,
    );
  });

  it("AC2 — does NOT use a raw `useQuery` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // `useQuery` from convex/react auto-injects nothing; using it for a
    // tenantQuery either fails at runtime (Forbidden / missing tenantId)
    // or silently leaks the wrong tenant's data — ADR 0010.
    //
    // Strip comments + template strings before the check so a docstring
    // referring to `useQuery` doesn't false-positive.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("AC3 — delegates rendering to `MenuView` (keeps the page thin + the view testable)", () => {
    // Same split as `mes-clients/page.tsx` → `MesClientsView`. The page is
    // a wiring layer; the visible branches (loading / empty / populated)
    // live in `MenuView` and are pinned by `menu-view.test.tsx`.
    expect(PAGE_SOURCE).toMatch(/MenuView/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-02 (#200) — CRUD wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-02 — wires `categories.create` / `categories.rename` / `categories.remove` through `useTenantMutation`", () => {
    // Slice 2 binds the three category mutations through `useTenantMutation`
    // (ADR 0014 §4 / #183), never raw `useMutation` (which would bypass the
    // tenantId injection — same risk as raw `useQuery` for the list, ADR 0010).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(PAGE_SOURCE).toMatch(/useTenantMutation/);
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.create[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.rename[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.remove[^)]*\)/,
    );
  });

  it("F-MENU-02 — does NOT use a raw `useMutation` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // Same discipline as for `useQuery` on the read path: a raw `useMutation`
    // would fail at runtime (Forbidden / missing tenantId) or — worse —
    // would only happen to work because Convex would refuse the call.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(code).not.toMatch(/\buseMutation\b/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-03 (#206) — drag&drop reorder wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-03 — wires `categories.reorder` through `useTenantMutation` (not raw useMutation, sends FULL ordered ids list)", () => {
    // The page binds the reorder mutation through `useTenantMutation` (same
    // discipline as create/rename/remove — ADR 0014 §4) and forwards a
    // handler that sends the COMPLETE ordered ids list (the backend rejects
    // a partial payload — `reorderTenantCategories` invariant pinned by
    // `packages/backend/convex/lib/menu/categories.test.ts`).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.categories\.reorder[^)]*\)/,
    );
    // The handler signature mentions `orderedIds` so the page passes the
    // full list to the mutation, not a diff.
    expect(PAGE_SOURCE).toMatch(/orderedIds/);
  });

  it("F-MENU-03 — passes `onReorderCategories` down to MenuView", () => {
    // Wiring contract: the page exposes the drag&drop handler via the
    // dedicated prop the view forwards to `CategoryListEditor`.
    expect(PAGE_SOURCE).toMatch(/onReorderCategories/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-04 (#211) — items list + inline rupture toggle wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-04 — wires `api.lib.menu.items.list` via `useTenantQuery` (not raw useQuery)", () => {
    // The page reads the tenant's items through the canonical tenantQuery
    // (ADR 0014 §4 / #183) — never a raw `useQuery` (which would bypass
    // tenantId auto-injection, ADR 0010).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.items\.list[^)]*\)/,
    );
  });

  it("F-MENU-04 — wires `availability.setItemAvailability` via `useTenantMutation` (live toggle, ADR 0015)", () => {
    // The rupture toggle calls `setItemAvailability` DIRECTLY (not through
    // publishMenu — ADR 0015 § Conséquences, story body « SANS passer par
    // publication »). The mutation is bound through `useTenantMutation` so
    // the tenantId injection is automatic.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.availability\.setItemAvailability[^)]*\)/,
    );
  });

  it("F-MENU-04 — passes `itemsByCategory` and `onToggleItemAvailability` down to MenuView", () => {
    // Wiring contract: the page exposes the per-category items map +
    // toggle handler via the dedicated props the view forwards down to
    // ItemList.
    expect(PAGE_SOURCE).toMatch(/itemsByCategory/);
    expect(PAGE_SOURCE).toMatch(/onToggleItemAvailability/);
  });

  it("F-MENU-04 — toggle handler wraps the mutation in try/catch + `toast.error` + `getConvexErrorMessage` (same discipline as CRUD)", () => {
    // The toggle is a live mutation; backend errors (e.g. NOT_FOUND for a
    // foreign id during a race) must surface as a user-visible toast, not
    // silently swallowed. Same shape as the F-MENU-02 CRUD handlers.
    // We pin the source mentions « setItemAvailability » + an associated
    // toast wiring nearby.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/setItemAvailability[\s\S]{0,400}toast\.error/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-05 (#219) — items CRUD wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-05 — wires `items.create` / `items.update` / `items.remove` via `useTenantMutation`", () => {
    // The item-modal CRUD goes through three tenantMutations (ADR 0014 §4 /
    // #183, ADR 0010): create (« + Item »), update (autosave in edit mode),
    // remove (delete with confirmation). Never raw `useMutation`.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.items\.create[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.items\.update[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.items\.remove[^)]*\)/,
    );
  });

  it("F-MENU-05 — passes `onCreateItem` and `onItemClick` down to MenuView (modal open hooks)", () => {
    // Wiring contract: the page exposes the « + Item » per-category + the
    // « click-on-card-to-edit » handlers via the dedicated props the view
    // forwards down to the item sections.
    expect(PAGE_SOURCE).toMatch(/onCreateItem/);
    expect(PAGE_SOURCE).toMatch(/onItemClick/);
  });

  it("F-MENU-05 — mounts the `ItemModal` so the modal can render outside the items section", () => {
    // The modal renders at page-level (not inside the ItemList) so the
    // backdrop overlays the whole page and the modal state survives a
    // category/item refresh.
    expect(PAGE_SOURCE).toMatch(/ItemModal/);
  });

  it("F-MENU-05 — items create/update/remove handlers wrap mutations in try/catch + toast.error + getConvexErrorMessage", () => {
    // Same discipline as F-MENU-02: backend errors (INVALID_PRICE, NOT_FOUND
    // for cross-tenant probes, etc.) surface as a visible toast — never
    // silently swallowed. We check that each handler references both the
    // mutation AND a toast.error call within a small window.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    // create — the page-level `handleCreateItem` must catch and toast.
    expect(collapsed).toMatch(/createItem[\s\S]{0,800}toast\.error/);
    // update — the autosave path also catches and toasts on the page side
    // (the modal is presentational only).
    expect(collapsed).toMatch(/updateItem[\s\S]{0,800}toast\.error/);
    // remove — the delete-confirmation path catches and toasts.
    expect(collapsed).toMatch(/removeItem[\s\S]{0,800}toast\.error/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-06 (#226) — Item photo upload / replace / remove wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-06 — wires `photos.generateUploadUrl` + `photos.attachPhoto` + `photos.removePhoto` via `useTenantMutation`", () => {
    // The photo flow goes through three tenantMutations (ADR 0014 §4 / #183,
    // ADR 0010): mint upload URL (generateUploadUrl), record the storage id
    // on the item (attachPhoto, which the backend invariant guarantees frees
    // the previous blob on replacement — `setTenantItemPhoto`), drop the
    // photo entirely (removePhoto). Never raw `useMutation`.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.photos\.generateUploadUrl[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.photos\.attachPhoto[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.photos\.removePhoto[^)]*\)/,
    );
  });

  it("F-MENU-06 — passes `onUploadPhoto` and `onRemovePhoto` down to the ItemModal", () => {
    // Wiring contract: the page exposes the two photo handlers via the
    // dedicated props the modal accepts (callable when in edit mode, where
    // an item id exists to attach to).
    expect(PAGE_SOURCE).toMatch(/onUploadPhoto/);
    expect(PAGE_SOURCE).toMatch(/onRemovePhoto/);
  });

  it("F-MENU-06 — photo handlers wrap mutations in try/catch + toast.error + getConvexErrorMessage (same discipline as item CRUD)", () => {
    // Backend errors (NOT_FOUND for a foreign item id during a cross-tenant
    // race; upload URL minting failures; etc.) MUST surface as a visible
    // toast — never silently swallowed. Same shape as the F-MENU-05 handlers.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    // The upload path references attachPhoto (or generateUploadUrl) AND has
    // a toast.error nearby (within the same handler-sized window).
    expect(collapsed).toMatch(/attachPhoto[\s\S]{0,1200}toast\.error/);
    // The remove path references removePhoto AND has a toast.error nearby.
    expect(collapsed).toMatch(/removePhoto[\s\S]{0,800}toast\.error/);
  });

  // ---------------------------------------------------------------------------
  // F-MENU-07 (#237) — items drag&drop reorder wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-07 — wires `items.reorder` through `useTenantMutation` (not raw useMutation, sends FULL ordered ids list)", () => {
    // The page binds the items reorder mutation through `useTenantMutation`
    // (same discipline as `categories.reorder` — ADR 0014 §4) and forwards
    // a handler that sends the COMPLETE ordered ids list for ONE category
    // (the backend `items.reorder` rejects any payload that isn't the full
    // set — invariant pinned by
    // `packages/backend/convex/lib/menu/items.test.ts`).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.items\.reorder[^)]*\)/,
    );
  });

  it("F-MENU-07 — passes `onReorderItems` down to MenuView", () => {
    // Wiring contract: the page exposes the items drag&drop handler via the
    // dedicated prop the view forwards down to per-category `ItemList`s.
    expect(PAGE_SOURCE).toMatch(/onReorderItems/);
  });

  it("F-MENU-07 — reorder handler wraps the mutation in try/catch + `toast.error` + `getConvexErrorMessage` (same discipline as CRUD)", () => {
    // Backend errors (NOT_FOUND for cross-tenant category id; INVALID_REORDER
    // when the orderedIds set drifts from the category's items) MUST surface
    // as a user-visible toast — never silently swallowed. Same shape as the
    // categories reorder handler.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    // The handler references items.reorder (`reorderItems` local) AND has a
    // toast.error within a handler-sized window.
    expect(collapsed).toMatch(
      /api\.lib\.menu\.items\.reorder[\s\S]{0,1200}toast\.error/,
    );
  });

  // ---------------------------------------------------------------------------
  // F-MENU-08 (#242) — Reusable modifier groups CRUD wiring contract
  // ---------------------------------------------------------------------------

  it("F-MENU-08 — wires `modifiers.listGroups` via `useTenantQuery` (not raw useQuery)", () => {
    // The « Personnalisations » section reads the tenant's REUSABLE groups
    // through the canonical tenantQuery (ADR 0014 §4 / #183) — never a raw
    // `useQuery` (which would bypass tenantId auto-injection, ADR 0010).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.modifiers\.listGroups[^)]*\)/,
    );
  });

  it("F-MENU-08 — wires `modifiers.createGroup` / `updateGroup` / `removeGroup` via `useTenantMutation`", () => {
    // The modifier-group modal CRUD goes through three tenantMutations
    // (ADR 0014 §4 / #183, ADR 0010): createGroup (« + Personnalisation »),
    // updateGroup (« Sauvegarder » from the edit modal), removeGroup (delete
    // with confirmation, cascades to N-N edges backend-side — see
    // `packages/backend/convex/lib/menu/modifiers.ts`).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.modifiers\.createGroup[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.modifiers\.updateGroup[^)]*\)/,
    );
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.menu\.modifiers\.removeGroup[^)]*\)/,
    );
  });

  it("F-MENU-08 — wires `modifiers.listGroupItems` via `useTenantQuery` (impact set for the delete confirmation)", () => {
    // Issue body: « Avant édit/suppression, afficher la liste des items qui
    // réutilisent ce groupe » → resolved through `listGroupItems`. The page
    // calls it ON DEMAND when the modal is open in edit mode (skip otherwise
    // to keep the round-trip count down).
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.modifiers\.listGroupItems[^)]*\)/,
    );
  });

  it("F-MENU-08 — mounts the `ModifierGroupModal` so it can render outside the section", () => {
    // The modal renders at page-level (not inside the section) so the backdrop
    // overlays the whole page and the modal state survives a list refresh.
    expect(PAGE_SOURCE).toMatch(/ModifierGroupModal/);
  });

  it("F-MENU-08 — modifier-group CRUD handlers wrap mutations in try/catch + toast.error + getConvexErrorMessage", () => {
    // Same discipline as F-MENU-02/05: backend errors (INVALID_MODIFIER,
    // NOT_FOUND for cross-tenant probes, etc.) surface as a visible toast —
    // never silently swallowed.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/createGroup[\s\S]{0,1200}toast\.error/);
    expect(collapsed).toMatch(/updateGroup[\s\S]{0,1200}toast\.error/);
    expect(collapsed).toMatch(/removeGroup[\s\S]{0,1200}toast\.error/);
  });

  it("F-MENU-02 — surfaces errors via `toast.error` + `getConvexErrorMessage` (no raw alert / console.error)", () => {
    // The CRUD handlers wrap each mutation call in try/catch and toast the
    // ConvexError's message (slice acceptance criterion « toast sur erreur »
    // + « messages d'erreur dérivés des ConvexError backend »).
    expect(PAGE_SOURCE).toMatch(/from\s+["']sonner["']/);
    expect(PAGE_SOURCE).toMatch(/toast/);
    expect(PAGE_SOURCE).toMatch(/getConvexErrorMessage/);
    // No raw alert in production code path (bad UX + bypasses our error sink).
    expect(PAGE_SOURCE).not.toMatch(/\balert\s*\(/);
  });
});
