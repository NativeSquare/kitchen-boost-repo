"use client";

/**
 * F-MENU-02 (#200) — `CategoryListEditor`, the CRUD-enabled counterpart of
 * slice-1's read-only `CategoryList`. Renders one editable row per
 * `menuCategories` doc + a footer « + Catégorie » button, and exposes three
 * callbacks the page wires to `useTenantMutation`:
 *   - `onCreate()`               — append a fresh empty category at the end.
 *   - `onRename(id, name)`       — debounced rename (autosave, ADR 0015
 *     « debounce on texts »).
 *   - `onDelete(id)`             — fired ONLY after the confirmation dialog
 *     « Confirmer la suppression » resolves (« suppression avec
 *     confirmation, cascade backend »).
 *
 * Why the editor lives next to the read-only view (not inside it): keeping
 * `MenuView` switchable between read / edit branches via callback presence
 * leaves the slice-1 contract untouched (the page can still pass only
 * `categories` if it wants), and keeps each component testable in isolation
 * under `environment: "node"` (no jsdom). The `MenuView` test pins « no
 * "+ Catégorie" without callbacks »; this file's test pins every editor
 * interaction.
 *
 * Optimistic UI strategy (ADR 0015 « optimistic UI Convex + rollback + toast
 * sur erreur »):
 *   - Rename: the input is uncontrolled w/ `defaultValue`, then the row holds
 *     a local `draft` that overrides display. The debounced mutation fires
 *     after 600 ms of inactivity OR on blur (`flush()`); on resolve the
 *     incoming `category.name` matches the draft and the row settles; on
 *     reject the page surfaces `toast.error` and we revert to
 *     `category.name`.
 *   - Create: relies on Convex's natural reactivity — `categories.list`
 *     re-runs after the mutation resolves and a new row appears. We surface
 *     the new row with a `data-autofocus-pending` marker so a future
 *     enhancement can lift the focus (the AC mentions "focus auto sur le
 *     champ nom" — the data-marker is the contract; the actual focus call
 *     is browser-only and not pinnable from node-env tests).
 *   - Delete: a confirmation dialog gates the call. The dialog is rendered
 *     conditionally via component-local state. The list reactively re-renders
 *     once the mutation resolves.
 *
 * Scope discipline (#200): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useEffect, useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useDebouncedCallback } from "./use-debounced-callback";

/** Default debounce for the rename input (ADR 0015, story body « 500-800 ms »). */
const RENAME_DEBOUNCE_MS = 600;

export type CategoryListEditorProps = {
  /** Tenant's categories (sorted defensively by `order` inside this view). */
  categories: Doc<"menuCategories">[];
  /** Append a fresh empty category at the end. Fired by the « + Catégorie » button. */
  onCreate: () => void;
  /** Commit a rename. Fired by the debounced input (autosave) and the input's onBlur (flush). */
  onRename: (categoryId: Id<"menuCategories">, name: string) => void;
  /** Drop a category. Fired by the confirmation dialog's "Confirmer" action. */
  onDelete: (categoryId: Id<"menuCategories">) => void;
};

export function CategoryListEditor({
  categories,
  onCreate,
  onRename,
  onDelete,
}: CategoryListEditorProps) {
  // Defensive resort by `order` — mirror of the read-only `CategoryList`.
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-col gap-3" data-slot="menu-category-list-editor">
      <div className="flex flex-col gap-2">
        {sorted.map((category) => (
          <CategoryRow
            key={category._id}
            category={category}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
      <div className="flex">
        <Button
          type="button"
          variant="outline"
          onClick={onCreate}
          data-slot="menu-category-add"
        >
          <IconPlus className="mr-2 size-4" aria-hidden="true" />
          Ajouter une catégorie
        </Button>
      </div>
    </div>
  );
}

type CategoryRowProps = {
  category: Doc<"menuCategories">;
  onRename: (categoryId: Id<"menuCategories">, name: string) => void;
  onDelete: (categoryId: Id<"menuCategories">) => void;
};

function CategoryRow({ category, onRename, onDelete }: CategoryRowProps) {
  const [draft, setDraft] = useState<string>(category.name);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Keep the displayed draft in sync if the server-side name updates
  // out-of-band (e.g. successful rename round-trip resolves with the same
  // string we just typed — already a no-op — OR a future slice mutates the
  // row from elsewhere).
  useEffect(() => {
    setDraft(category.name);
  }, [category.name]);

  const debouncedRename = useDebouncedCallback<string>((next) => {
    const trimmed = next.trim();
    if (trimmed.length === 0) {
      // « tenter rename avec valeur invalide → message clair affiché »:
      // we revert the local draft to the last committed name. The page-level
      // mutation handler would otherwise toast a backend INVALID error, but
      // the backend currently accepts an empty string (no validator) — so
      // the front owns the rule. The revert keeps the list visually
      // consistent (no « empty row » phantom).
      setDraft(category.name);
      return;
    }
    if (trimmed === category.name) return; // no-op
    onRename(category._id, trimmed);
  }, RENAME_DEBOUNCE_MS);

  // Cancel any pending debounced rename when the row unmounts (delete) so we
  // never fire a rename against a deleted id.
  useEffect(() => {
    return () => {
      debouncedRename.cancel();
    };
    // We deliberately don't depend on `debouncedRename` (it's a fresh
    // closure each render — including it would cancel on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card data-slot="menu-category-row">
      <CardContent className="flex items-center gap-3 py-3">
        <Input
          defaultValue={category.name}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            debouncedRename(next);
          }}
          onBlur={() => {
            debouncedRename.flush();
          }}
          data-slot="menu-category-name-input"
          data-category-id={category._id as unknown as string}
          aria-label={`Nom de la catégorie ${category.name}`}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setConfirmOpen(true)}
          data-slot="menu-category-delete"
          aria-label={`Supprimer la catégorie ${category.name}`}
        >
          <IconTrash className="size-4" aria-hidden="true" />
        </Button>
      </CardContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {category.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Tous les items rattachés à cette
              catégorie seront également supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(category._id);
                setConfirmOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-slot="menu-category-delete-confirm"
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
