/**
 * F-MENU-03 (#206) — Pure helpers for the drag&drop reorder slice.
 *
 * The dnd-kit `onDragEnd` event hands us `{ active.id, over.id }`. Building
 * the new ordered ids list is pulled out here so the `CategoryListEditor`
 * drag-end handler stays a one-liner and the list arithmetic is testable
 * in isolation, under the same `environment: "node"` setup as the rest of
 * the menu route.
 *
 * Invariants:
 *   - The output array always contains every input id exactly once. The
 *     backend `reorderTenantCategories` rejects any payload that isn't the
 *     full set (see `categories.test.ts` — « reorder refuses an id set that
 *     is not exactly the tenant's categories »). We must never construct
 *     one that violates that invariant.
 *   - `active === over` (the user dropped the row on itself) yields a fresh
 *     copy equal to the input — no mutation gets sent.
 *   - An absent `active` or `over` (defensive — dnd-kit shouldn't fire
 *     this for a sortable container, but the type is `UniqueIdentifier`
 *     so anything goes) yields the input unchanged.
 */

/**
 * Build the new ordered ids array after a drag-end event.
 *
 * Moves `activeId` to the position currently occupied by `overId`,
 * preserving every other id's relative order.
 */
export function reorderById<T extends string>(
  ids: readonly T[],
  activeId: T,
  overId: T,
): T[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) {
    // Defensive: dnd-kit fired with an id we don't know — keep the list
    // intact rather than throw mid-handler (the handler is fire-and-forget,
    // a throw would be swallowed by React).
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
