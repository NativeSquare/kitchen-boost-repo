"use client";

/**
 * F-MENU-01 (#187) + F-MENU-02 (#200) — Route `/t/[tenantId]/menu/`.
 *
 * Slice 1 (#187) wired the read-only categories list via `useTenantQuery`.
 * Slice 2 (#200) layers CRUD on top: the page binds the three category
 * mutations (`create` / `rename` / `remove`) through `useTenantMutation`
 * (ADR 0014 §4 / F-SHELL-05 #183), wraps each call in a try/catch that
 * surfaces backend `ConvexError`s as `toast.error(...)` with the
 * server-provided message (« optimistic UI + rollback + toast sur erreur »,
 * « messages d'erreur dérivés des ConvexError backend » — issue body), and
 * hands the resulting callbacks to `MenuView`, which forwards them to the
 * interactive `CategoryListEditor`.
 *
 * Naming: « Nouvelle catégorie » is the default-name for a fresh create
 * (issue AC1 « bouton + Catégorie crée une catégorie vide en fin de
 * liste »). The backend schema requires a non-empty string, so we send a
 * placeholder the gérant immediately renames inline (the « focus auto sur
 * le champ nom » target is the just-created row's input, surfaced by the
 * `data-autofocus-pending` marker — actual focus is a future enhancement,
 * not pinnable from node-env tests).
 *
 * Naming F-MENU-03 (#206) will add drag&drop on top — strictly out of
 * scope here (« pas de drag&drop dans cette story », issue AC). Slice 10
 * (#254) will activate the « Aperçu » / « Publier » buttons.
 *
 * Scope discipline (#200 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/`) is the ONLY surface touched
 * by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useTenantMutation, useTenantQuery } from "@/hooks";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { MenuView } from "./menu-view";

/** Placeholder name for a freshly-created category — the gérant renames it inline. */
const DEFAULT_NEW_CATEGORY_NAME = "Nouvelle catégorie";

export default function MenuPage() {
  // `useTenantQuery` / `useTenantMutation` read `tenantId` from
  // `<TenantProvider/>` (mounted by the chrome-less `/t/[tenantId]` layout)
  // and inject it into args (ADR 0014 §4 / #183). `undefined` is the
  // loading sentinel; an empty array means the tenant has no categories
  // yet; otherwise we render the list.
  const categories = useTenantQuery(api.lib.menu.categories.list);
  const createCategory = useTenantMutation(api.lib.menu.categories.create);
  const renameCategory = useTenantMutation(api.lib.menu.categories.rename);
  const removeCategory = useTenantMutation(api.lib.menu.categories.remove);

  const handleCreate = async () => {
    try {
      await createCategory({ name: DEFAULT_NEW_CATEGORY_NAME });
    } catch (error) {
      toast.error("Impossible de créer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleRename = async (
    categoryId: Id<"menuCategories">,
    name: string,
  ) => {
    try {
      await renameCategory({ categoryId, name });
    } catch (error) {
      toast.error("Impossible de renommer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleDelete = async (categoryId: Id<"menuCategories">) => {
    try {
      await removeCategory({ categoryId });
    } catch (error) {
      toast.error("Impossible de supprimer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  return (
    <MenuView
      categories={categories}
      onCreateCategory={handleCreate}
      onRenameCategory={handleRename}
      onDeleteCategory={handleDelete}
    />
  );
}
