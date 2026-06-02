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
 *   - Rename: the input is CONTROLLED via a local `draft` state seeded
 *     ONCE from `category.name` at mount. From then on, the draft is the
 *     user's input — never re-overwritten by a Convex live-query echo (see
 *     the long comment inside `CategoryRow` for the race the previous
 *     useEffect resync introduced : fast typists lost letters mid-typing).
 *     The debounced mutation fires after 600 ms of inactivity OR on blur
 *     (`flush()`) ; on resolve the row settles ; on reject the page surfaces
 *     `toast.error` (and the draft stays at the user's last input — they can
 *     correct + retry without re-typing). Row identity is the load-bearing
 *     key : the editor keys each row by `category._id`, so a different
 *     category gets a fresh `useState(category.name)`.
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

import { useEffect, useMemo, useRef, useState } from "react";
import { IconGripVertical, IconPlus, IconTrash } from "@tabler/icons-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

import { reorderById } from "./reorder-utils";
import { useDebouncedCallback } from "./use-debounced-callback";

/** Default debounce for the rename input (ADR 0015, story body « 500-800 ms »). */
const RENAME_DEBOUNCE_MS = 600;

/**
 * Detect the « last id that just appeared » between two snapshots of the
 * displayed categories. Pure helper, exported for unit-testing (the React-side
 * wiring uses a `useRef` to hold the previous snapshot — see
 * `CategoryListEditor` body).
 *
 * Contract:
 *   - First-time call (`prevIds === null`) returns `{ newlyAddedId: null }`
 *     — we never autofocus on the initial mount (the user did not just click
 *     « Ajouter une catégorie », the list was simply hydrated by Convex).
 *   - Otherwise, returns the LAST id in `current` that wasn't present in
 *     `prevIds`. « Last one wins » because the only path that creates rows
 *     is the footer button, which creates them one at a time — and if a
 *     concurrent tab also creates one, autofocusing the more-recent one
 *     (sorted by `order = max + 1`) is the better UX.
 *   - Always returns the new `nextIds` set so the caller can stash it for
 *     the next comparison without recomputing.
 */
export function findNewlyAddedId<T extends { _id: string }>(
  prevIds: ReadonlySet<string> | null,
  current: readonly T[],
): { newlyAddedId: string | null; nextIds: Set<string> } {
  const nextIds = new Set(current.map((c) => c._id));
  if (prevIds === null) return { newlyAddedId: null, nextIds };
  let found: string | null = null;
  for (const c of current) {
    if (!prevIds.has(c._id)) found = c._id;
  }
  return { newlyAddedId: found, nextIds };
}

export type CategoryListEditorProps = {
  /** Tenant's categories (sorted defensively by `order` inside this view). */
  categories: Doc<"menuCategories">[];
  /** Append a fresh empty category at the end. Fired by the « + Catégorie » button. */
  onCreate: () => void;
  /** Commit a rename. Fired by the debounced input (autosave) and the input's onBlur (flush). */
  onRename: (categoryId: Id<"menuCategories">, name: string) => void;
  /** Drop a category. Fired by the confirmation dialog's "Confirmer" action. */
  onDelete: (categoryId: Id<"menuCategories">) => void;
  /**
   * F-MENU-03 (#206) — persist a new full ordered ids list after a drag&drop.
   * The COMPLETE list is sent (backend `categories.reorder` rejects partial
   * payloads — invariant pinned by
   * `packages/backend/convex/lib/menu/categories.test.ts`). When omitted,
   * the editor renders without drag handles (read-only ordering).
   */
  onReorder?: (orderedIds: Id<"menuCategories">[]) => void;
};

export function CategoryListEditor({
  categories,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: CategoryListEditorProps) {
  // Defensive resort by `order` — mirror of the read-only `CategoryList`.
  const sorted = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories],
  );

  // Optimistic UI: the displayed order is a local state that we override
  // on drag-end BEFORE the mutation resolves. We resync to the server order
  // using React's canonical « reset state on prop change » pattern (compare
  // the previous `sorted` reference in render — no `useEffect`, no
  // double-render, no `react-hooks/set-state-in-effect` lint violation).
  // Two paths converge through this resync:
  //   - Success: Convex re-fires `categories.list`, the new `sorted` ===
  //     the optimistic guess → no visible change.
  //   - Rollback: the mutation rejected, `sorted` is still the OLD order
  //     → `displayedIds` snaps back, and the page-level handler surfaces
  //     `toast.error`.
  const sortable = onReorder !== undefined;
  const [displayedIds, setDisplayedIds] = useState<Id<"menuCategories">[]>(() =>
    sorted.map((c) => c._id),
  );
  const [prevSorted, setPrevSorted] = useState(sorted);
  if (sorted !== prevSorted) {
    setPrevSorted(sorted);
    setDisplayedIds(sorted.map((c) => c._id));
  }

  const byId = useMemo(() => {
    const map = new Map<Id<"menuCategories">, Doc<"menuCategories">>();
    for (const c of sorted) map.set(c._id, c);
    return map;
  }, [sorted]);

  // Build the displayed list. If the local id-order has drifted from the
  // server (optimistic update in flight), apply our order; otherwise just
  // use `sorted`. Defensive: any id missing from `byId` (race where the
  // server removed a row between drag and resync) is silently dropped.
  const displayed = useMemo<Doc<"menuCategories">[]>(() => {
    const ordered: Doc<"menuCategories">[] = [];
    for (const id of displayedIds) {
      const c = byId.get(id);
      if (c !== undefined) ordered.push(c);
    }
    // Append any server-side new rows that aren't in the optimistic list yet
    // (e.g. another tab just created one) at the end, in their sorted order.
    if (ordered.length !== sorted.length) {
      const seen = new Set(ordered.map((c) => c._id));
      for (const c of sorted) {
        if (!seen.has(c._id)) ordered.push(c);
      }
    }
    return ordered;
  }, [displayedIds, byId, sorted]);

  // « + Ajouter une catégorie » UX (Alex, E2E manuel) : la row fraîchement
  // créée doit autofocus son input + select-all le nom par défaut, sinon le
  // gérant doit cliquer + Ctrl+A + retaper. On détecte la new row par
  // diff d'ids entre deux renders. On utilise le pattern canonique « reset
  // state on prop change » (cf. `prevSorted` ci-dessus) plutôt que `useRef`
  // — le React Compiler interdit la lecture/écriture de ref pendant render,
  // et ce calcul est dérivé du `displayed` (donc une state-on-prop est la
  // forme correcte). Premier render = `null` (la liste est juste hydratée
  // par Convex, pas un create user-initiated → pas d'autofocus).
  const [prevDisplayed, setPrevDisplayed] = useState(displayed);
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  if (displayed !== prevDisplayed) {
    const { newlyAddedId: nextId } = findNewlyAddedId(
      new Set(prevDisplayed.map((c) => c._id as unknown as string)),
      displayed,
    );
    setPrevDisplayed(displayed);
    setNewlyAddedId(nextId);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A small distance threshold avoids accidental drags when the user
      // just wants to click an input or button on the row.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (onReorder === undefined) return;
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const activeId = active.id as Id<"menuCategories">;
    const overId = over.id as Id<"menuCategories">;
    const nextIds = reorderById(displayedIds, activeId, overId);
    // Optimistic UI: paint the new order BEFORE the mutation resolves. If
    // the server rejects, `categories` prop stays put → `useEffect` resyncs
    // `displayedIds` back. The page-level handler surfaces `toast.error`.
    setDisplayedIds(nextIds);
    onReorder(nextIds);
  };

  const rows = displayed.map((category) => {
    const autoFocus = (category._id as unknown as string) === newlyAddedId;
    return sortable ? (
      <SortableCategoryRow
        key={category._id}
        category={category}
        onRename={onRename}
        onDelete={onDelete}
        autoFocus={autoFocus}
      />
    ) : (
      <CategoryRow
        key={category._id}
        category={category}
        onRename={onRename}
        onDelete={onDelete}
        sortable={false}
        autoFocus={autoFocus}
      />
    );
  });

  const body = sortable ? (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={displayedIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">{rows}</div>
      </SortableContext>
    </DndContext>
  ) : (
    <div className="flex flex-col gap-2">{rows}</div>
  );

  return (
    <div className="flex flex-col gap-3" data-slot="menu-category-list-editor">
      {body}
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

export type CategoryRowProps = {
  category: Doc<"menuCategories">;
  onRename: (categoryId: Id<"menuCategories">, name: string) => void;
  onDelete: (categoryId: Id<"menuCategories">) => void;
  /**
   * F-MENU-03 (#206) — `true` when this row is rendered inside a
   * `SortableContext`. The actual drag-handle button + sortable wiring
   * (transform, listeners) lives in `SortableCategoryRow` — this flag is
   * carried for future render-only branches.
   */
  sortable: boolean;
  /** F-MENU-03 (#206) — optional drag-handle slot rendered as the first row cell. */
  dragHandle?: React.ReactNode;
  /** F-MENU-03 (#206) — outer style applied by dnd-kit's transform (translate / transition). */
  style?: React.CSSProperties;
  /** F-MENU-03 (#206) — set-node-ref from `useSortable`, attached to the outer Card. */
  setNodeRef?: (node: HTMLElement | null) => void;
  /**
   * « + Ajouter une catégorie » UX (Alex, E2E manuel) — `true` when this row
   * was just appended by the user via the footer button. On the FIRST render
   * of the row, the rename input is focused + its text fully selected so the
   * gérant can simply start typing to overwrite the « Nouvelle catégorie »
   * placeholder (no click + Ctrl+A + retype roundtrip). Subsequent renders
   * (e.g. live-query echo after the create mutation resolves) do NOT re-focus
   * — the user may have already tabbed away.
   */
  autoFocus?: boolean;
};

export function CategoryRow({
  category,
  onRename,
  onDelete,
  dragHandle,
  style,
  setNodeRef,
  autoFocus = false,
}: CategoryRowProps) {
  // The local `draft` is seeded ONCE from `category.name` and from then on it
  // is the user's input — never re-overwritten by Convex live-query echoes.
  //
  // Why no `useEffect(() => setDraft(category.name), [category.name])` :
  // ----------------------------------------------------------------------
  // The earlier version of this row resynced `draft` on every `category.name`
  // change. With Convex's reactive queries + a 600 ms debounce, that resync
  // ran into a race against fast typists :
  //   1. user types "B" → `draft = "B"` → debounce schedules `rename("B")`
  //   2. user types "Bu" → `draft = "Bu"` (debounce reschedules)
  //   3. (out-of-band) a stale Convex re-fire re-emits `category.name = "B"`
  //      (or, after the round-trip, `"B"` lands AFTER the user typed "Bu")
  //   4. the resync useEffect ran `setDraft("B")` → the "u" disappears
  //      visually mid-typing
  // The local draft IS the source of truth while the user edits ; the backend
  // catches up via the debounced `onRename`. We never need to overwrite the
  // user's input from server data. Row identity is the load-bearing key here :
  // the parent `CategoryListEditor` keys each `<CategoryRow>` by
  // `category._id`, so a different category gets a different React component
  // instance with its own fresh `useState(category.name)`. The only « rename
  // by another tab while I'm editing » scenario is intentionally not
  // supported — there are no concurrent editors of the same row in V1 (single
  // KB Admin per provisioning session, ADR 0015).
  //
  // The empty-string revert path (debounce body below) is the ONLY allowed
  // server→draft overwrite, and it only fires when the user explicitly typed
  // an empty value (caught BEFORE the mutation).
  const [draft, setDraft] = useState<string>(category.name);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  // « + Ajouter une catégorie » UX — focus + select-all on the first render
  // of a freshly-created row so the gérant types directly over the « Nouvelle
  // catégorie » placeholder. We only fire ONCE (no deps that would re-run),
  // because by the time the row re-renders the user may already have tabbed
  // away — we'd steal focus mid-flow.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (el === null) return;
    el.focus();
    el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card data-slot="menu-category-row" ref={setNodeRef} style={style}>
      <CardContent className="flex items-center gap-3 py-3">
        {dragHandle}
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            debouncedRename(next);
          }}
          onKeyDown={(e) => {
            // Enter = commit. Fires the pending rename synchronously (no need
            // to wait 600 ms), then blurs so the user gets a visual signal
            // « ma saisie a bien été enregistrée ». Reported E2E manuel par
            // Alex : « Enter ne fais aucune action, PAS moyen de valider la
            // saisie d'une catégorie simplement ».
            if (e.key === "Enter") {
              e.preventDefault();
              debouncedRename.flush();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            debouncedRename.flush();
          }}
          data-slot="menu-category-name-input"
          data-category-id={category._id as unknown as string}
          data-autofocus-pending={autoFocus ? "true" : undefined}
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

/**
 * F-MENU-03 (#206) — Sortable wrapper around `CategoryRow`. Calls dnd-kit's
 * `useSortable` to get the transform + listeners, builds the drag-handle
 * button (a small grip icon with an explicit `aria-label` so screen readers
 * announce « Réordonner la catégorie X »), and forwards both into the row.
 *
 * The handle (not the whole row) is the drag activator — keeps the inputs
 * and the delete button clickable without triggering a drag. The handle
 * also serves as the keyboard sortable affordance (`KeyboardSensor` listens
 * on the same element) — pressing space-bar focused on the handle starts
 * sorting, arrow keys move the row, space-bar drops it. That covers the
 * « réordonnable au clavier » acceptance criterion (apps/admin is a pro
 * tool, used all day).
 */
type SortableCategoryRowProps = Pick<
  CategoryRowProps,
  "category" | "onRename" | "onDelete" | "autoFocus"
>;

function SortableCategoryRow({
  category,
  onRename,
  onDelete,
  autoFocus,
}: SortableCategoryRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category._id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const handle = (
    <button
      type="button"
      data-slot="menu-category-drag-handle"
      aria-label={`Réordonner la catégorie ${category.name}`}
      className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none rounded p-1 outline-none focus-visible:ring-2 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <IconGripVertical className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <CategoryRow
      category={category}
      onRename={onRename}
      onDelete={onDelete}
      sortable
      dragHandle={handle}
      style={style}
      setNodeRef={setNodeRef}
      autoFocus={autoFocus}
    />
  );
}
