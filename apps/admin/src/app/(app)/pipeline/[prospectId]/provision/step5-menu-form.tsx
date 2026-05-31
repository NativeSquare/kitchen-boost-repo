"use client";

/**
 * F-WIZARD [7/10] (#271) — `Step5MenuForm`, the real Step 5 form that
 * replaces the placeholder shipped by slice [1/10] (#265).
 *
 * Step 5 — Menu (édition inline + 1ère publication requise + gate dure sur
 * step 6). The wizard MUST not let the operator advance to step 6 (QR
 * sticker) until `publishMenu` has run at least once for this tenant —
 * otherwise the PWA cliente would land on the activation step with NO menu
 * to render (ADR 0015 « édition brouillon → publication globale atomique »).
 *
 * Surface reuse (issue spec verbatim « Réutiliser l'éditeur menu de F-MENU
 * (#149) s'il est déjà construit »): we mount the SAME presentational
 * components shipped by F-MENU under `apps/admin/src/app/(app)/t/[tenantId]/menu/`:
 *   - `MenuView` (categories + items list + per-category Item CTA + publish
 *     header — F-MENU-01..F-MENU-10, the publish button stays its own load-
 *     bearing affordance with the stable `data-slot="menu-publish-button"`).
 *   - `ModifierGroupsSection` (REUSABLE modifier groups — F-MENU-08 #242).
 *
 * Why we don't redirect to `/t/[tenantId]/menu`: the wizard is the
 * provisioning UX, the operator must STAY in the wizard for the flow to be
 * one continuous path (and the URL stays `/pipeline/[prospectId]/provision`
 * for cursor-state preservation). Mounting the same editor components here
 * is the minimal-churn reuse the issue spec explicitly requests.
 *
 * The wizard's value-add over the standalone Paramètres-style page is the
 * GATE: a « Continuer » button rendered AFTER the editor surface, disabled
 * with an explicit tooltip / help text until `lastPublishedAt !== null`.
 * The publication snapshot existence is the canonical gate signal — pulled
 * from `api.lib.menu.publication.hasUnpublishedChanges.lastPublishedAt`
 * server-side (B-MENU-PUBLICATION slice 5, #176). Once the operator clicks
 * « Publier » and the snapshot lands, Convex's reactivity re-fires the
 * status query, `lastPublishedAt` flips to a number, and the gate opens
 * automatically — no manual state flip needed.
 *
 * Publish UX details:
 *   - The « Publier » button is owned by the reused `MenuView` header
 *     (data-slot stable since F-MENU-10 #254). We thread `onPublish` /
 *     `publishLoading` / `hasUnpublishedChanges` through MenuView's
 *     existing prop set, and surface `publishError` inline ourselves
 *     (the slot `wizard-step5-publish-error` is wizard-specific, lives
 *     below the editor — keeps the F-MENU error UX intact while the wizard
 *     can layer its own persistent error display per step).
 *
 * Scope (#271 hard constraint): `apps/admin/src/app/(app)/pipeline/
 * [prospectId]/provision/` UNIQUEMENT. We import from
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` (the existing editor
 * modules) — same in-app reuse pattern as `Step4BrandingForm` reusing
 * Paramètres editors.
 *
 * Testabilité: composant purement présentationnel. The Convex wiring
 * (`useMutation(api.lib.menu.publication.publishMenu)`, the categories /
 * items / modifier groups queries, etc.) lives in the `Step5Form` wrapper
 * in `step-forms.tsx` (same pattern as `Step1Form` / `Step3Form` /
 * `Step4Form`). The wrapper threads the handlers + current values down to
 * this pure component — pin shape under the lean `node` vitest env via the
 * same React-tree serializer as the sibling forms.
 */

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { MenuView } from "@/app/(app)/t/[tenantId]/menu/menu-view";
import { ModifierGroupsSection } from "@/app/(app)/t/[tenantId]/menu/modifier-groups-section";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import type { StepFormProps } from "./step-forms";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Step5MenuFormProps = StepFormProps & {
  /**
   * Categories from `useQuery(api.lib.menu.categories.list, { tenantId })`.
   *   - `undefined` → query in flight (Convex's loading sentinel)
   *   - `[]`        → tenant has no categories yet (fresh provisioning)
   *   - else        → list to render
   */
  categories: Doc<"menuCategories">[] | undefined;
  /**
   * Items bucketed by `categoryId`. `undefined` → page-level items query in
   * flight (each section will render skeletons).
   */
  itemsByCategory: Record<string, Doc<"menuItems">[]> | undefined;
  /**
   * REUSABLE modifier groups of the tenant — fed into `ModifierGroupsSection`.
   *   - `undefined` → query in flight; the section renders skeletons.
   *   - `[]`        → empty state with a primary CTA.
   *   - else        → one row per group.
   */
  modifierGroups: Doc<"modifierGroups">[] | undefined;
  /**
   * Last publication timestamp (ms epoch) of this tenant's menu — fed by
   * `api.lib.menu.publication.hasUnpublishedChanges.lastPublishedAt`.
   *   - `null`      → never published → « Continuer » gate STAYS closed.
   *   - `number`    → snapshot exists → gate opens, badge surfaces the date.
   *   - `undefined` → query in flight → treated as « still locked » (safer
   *     than letting the operator slip through during a refresh — the gate
   *     re-opens once the status resolves).
   */
  lastPublishedAt: number | null | undefined;
  /**
   * `true` while a `publishMenu` round-trip is in flight. Re-disables the
   * « Publier » button so a second click can't fire the mutation twice
   * (double toasts + wasted round-trip; the backend is idempotent at the
   * snapshot level but the cost is real).
   */
  publishLoading: boolean;
  /**
   * Last `publishMenu` backend error message, surfaced inline below the
   * editor (`data-slot="wizard-step5-publish-error"`). The page-level
   * toast still fires too (same shape as F-MENU's existing UX); this slot
   * keeps the message visible across the wizard chrome so the operator
   * doesn't lose it when the toast dismisses.
   */
  publishError: string | null;
  /** Click handler for « Publier le menu » — fires `publishMenu({ tenantId })`. */
  onPublish: () => void;
  /** F-MENU CRUD wiring — threaded through to the reused `MenuView`. */
  onCreateCategory: () => void;
  onRenameCategory: (categoryId: Id<"menuCategories">, name: string) => void;
  onDeleteCategory: (categoryId: Id<"menuCategories">) => void;
  onReorderCategories: (orderedIds: Id<"menuCategories">[]) => void;
  onToggleItemAvailability: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
  onCreateItem: (categoryId: Id<"menuCategories">) => void;
  onItemClick: (itemId: Id<"menuItems">) => void;
  onReorderItems: (
    categoryId: Id<"menuCategories">,
    orderedIds: Id<"menuItems">[],
  ) => void;
  /** F-MENU modifier-group wiring — threaded through to `ModifierGroupsSection`. */
  onCreateModifierGroup: () => void;
  onEditModifierGroup: (groupId: Id<"modifierGroups">) => void;
  onDeleteModifierGroup: (groupId: Id<"modifierGroups">) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cheap, locale-aware timestamp formatter for the « Publié + date » badge.
 * Falls back to the ISO string if `Intl` is unavailable (lean `node` env
 * always has `Intl`, but we still guard for safety).
 *
 * Format chosen: `dd/MM/yyyy HH:mm` (fr-FR) — short enough to fit in the
 * badge, precise enough to disambiguate two same-day publications. The
 * test pins on `2026` to stay locale-agnostic (every reasonable format
 * carries the year).
 */
function formatPublishedAt(ts: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step5MenuForm({
  categories,
  itemsByCategory,
  modifierGroups,
  lastPublishedAt,
  publishLoading,
  publishError,
  onPublish,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategories,
  onToggleItemAvailability,
  onCreateItem,
  onItemClick,
  onReorderItems,
  onCreateModifierGroup,
  onEditModifierGroup,
  onDeleteModifierGroup,
  onPrev,
  onNext,
}: Step5MenuFormProps): React.JSX.Element {
  // The gate is the CORE invariant of this step: the operator MUST publish
  // at least once before advancing to step 6 (QR sticker — without a
  // snapshot, the PWA cliente would land on the activation step with
  // nothing to render, ADR 0015 § Conséquences).
  //
  // `lastPublishedAt === null`      → never published (canonical signal).
  // `lastPublishedAt === undefined` → query in flight; treated as locked
  //                                   too (defensive — safer than letting
  //                                   the operator slip through during a
  //                                   refresh; the gate re-opens once the
  //                                   status resolves).
  // `lastPublishedAt: number`       → snapshot exists; gate opens.
  const hasPublishedSnapshot =
    typeof lastPublishedAt === "number" && lastPublishedAt > 0;
  const canContinue = hasPublishedSnapshot;
  const handleContinue = () => {
    // Defensive: never call onNext when the gate is closed (the disabled
    // attribute is the primary affordance; this is the belt-and-braces guard
    // in case a click event still bubbles in some edge browser).
    if (!canContinue) return;
    onNext();
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-2 lg:px-6">
      {/*
       * Publication badge — surfaces the current publication state
       * (Brouillon non publié vs Publié + timestamp). The badge lives ABOVE
       * the editor so the operator sees the wizard-specific status BEFORE
       * scrolling through the (potentially long) menu surface. It is
       * deliberately distinct from F-MENU's own « modifications non
       * publiées » badge — that one signals « your draft has unsaved
       * edits since the last publish », which is a different question from
       * « has a snapshot ever been published ».
       */}
      <div className="flex flex-col gap-1">
        {hasPublishedSnapshot ? (
          <span
            className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900"
            data-slot="wizard-step5-published-badge"
          >
            Publié — {formatPublishedAt(lastPublishedAt as number)}
          </span>
        ) : (
          <span
            className="inline-flex w-fit items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900"
            data-slot="wizard-step5-draft-badge"
          >
            Brouillon non publié
          </span>
        )}
      </div>

      {/*
       * F-MENU editor surface — REUSED from `apps/admin/src/app/(app)/t/
       * [tenantId]/menu/menu-view.tsx`. `MenuView` is a pure function of
       * its props; the wiring (queries / mutations) is owned by this form's
       * wrapper in `step-forms.tsx`. The « Publier » button (stable slot
       * `menu-publish-button`) is rendered inside `MenuView`'s header — the
       * acceptance criteria « bouton « Publier le menu » bien visible »
       * is satisfied by the reused component, no duplication.
       */}
      <MenuView
        categories={categories}
        onCreateCategory={onCreateCategory}
        onRenameCategory={onRenameCategory}
        onDeleteCategory={onDeleteCategory}
        onReorderCategories={onReorderCategories}
        itemsByCategory={itemsByCategory}
        onToggleItemAvailability={onToggleItemAvailability}
        onCreateItem={onCreateItem}
        onItemClick={onItemClick}
        onReorderItems={onReorderItems}
        onPublish={onPublish}
        publishLoading={publishLoading}
        // « Aperçu » is intentionally NOT wired here: the wizard runs at the
        // KB Admin level under /pipeline/..., outside the /t/[tenantId]/menu
        // shell that backs the preview route's TenantProvider. The publish
        // gate is the only navigation guarantee step 5 needs.
        previewHref={undefined}
        hasUnpublishedChanges={undefined}
      />

      {/*
       * F-MENU modifier groups surface — REUSED for the « personnalisations »
       * CRUD (issue spec « modifiers idéalement »). Lives BELOW the
       * categories/items list so the operator scopes them out only once
       * the menu skeleton exists (the picker inside ItemModal is the
       * primary attach surface, but a tenant may want to prepare a few
       * groups upfront).
       */}
      <ModifierGroupsSection
        groups={modifierGroups}
        onCreateGroup={onCreateModifierGroup}
        onEditGroup={onEditModifierGroup}
        onDeleteGroup={onDeleteModifierGroup}
      />

      {/*
       * Backend publish error — wizard-specific persistent display. F-MENU's
       * page-level toast still fires too (the wrapper owns it), but this
       * slot keeps the message visible across the wizard chrome so the
       * operator doesn't lose it when the toast dismisses (typically
       * 4-5s) while they're still scrolling through the editor.
       */}
      {publishError !== null ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          data-slot="wizard-step5-publish-error"
          role="alert"
        >
          {publishError}
        </div>
      ) : null}

      <Separator />

      {/*
       * Wizard nav strip. The « Continuer » button is the GATE: disabled
       * until `lastPublishedAt !== null`. A short help text sits BELOW the
       * button (data-slot `wizard-step5-continue-help`) — it's the
       * accessible-by-default alternative to a tooltip (which would require
       * pointer-only interactions); the issue spec calls for « Tooltip
       * explicite », and a visible help paragraph is its strict superset
       * (always visible, screen-reader friendly).
       */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onPrev}>
            Précédent
          </Button>
          <Button
            type="button"
            data-slot="wizard-step5-continue-button"
            disabled={!canContinue}
            onClick={canContinue ? handleContinue : undefined}
            title={
              canContinue
                ? undefined
                : "Publie ton menu au moins une fois avant de passer à l'impression du QR sticker."
            }
          >
            Continuer
          </Button>
        </div>
        {!canContinue ? (
          <p
            className="text-muted-foreground text-xs"
            data-slot="wizard-step5-continue-help"
          >
            Publie ton menu au moins une fois avant de passer à
            l&apos;impression du QR sticker.
          </p>
        ) : null}
      </div>
    </div>
  );
}
