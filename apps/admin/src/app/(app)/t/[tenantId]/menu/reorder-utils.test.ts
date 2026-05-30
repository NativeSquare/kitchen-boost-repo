/**
 * F-MENU-03 (#206) — Pure helpers for the drag&drop reorder slice.
 *
 * The optimistic-UI flow in `CategoryListEditor` builds a fresh ordered ids
 * array from a dnd-kit `onDragEnd` event (`{ active.id, over.id }`) and
 * hands it to `onReorder`. The list arithmetic is pulled into a pure helper
 * so the « réordonner 3 catégories, vérifier l'ordre persisté et le payload
 * envoyé » contract (issue AC) can be pinned WITHOUT spinning a React
 * renderer — same node-env discipline as the rest of the menu route.
 *
 * Invariants pinned here:
 *   - The output array always lists EVERY input id exactly once (no diff,
 *     no drop). The backend `reorderTenantCategories` rejects any payload
 *     that isn't the full set; we must never construct one that violates
 *     that invariant.
 *   - Moving an id to its current position is a no-op (returns an array
 *     equal to the input).
 *   - Moving an absent id (active.id not in the input) returns the input
 *     unchanged (defensive — dnd-kit shouldn't fire this, but we don't
 *     want to throw inside the drag-end handler).
 */
import { describe, expect, it } from "vitest";

import { reorderById } from "./reorder-utils";

describe("reorderById — F-MENU-03 (#206)", () => {
  it("moves an id forward (down the list)", () => {
    expect(reorderById(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("moves an id backward (up the list)", () => {
    expect(reorderById(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("returns a stable copy when active === over (drag dropped on itself)", () => {
    const input = ["a", "b", "c"];
    const out = reorderById(input, "b", "b");
    expect(out).toEqual(["a", "b", "c"]);
    // Must be a fresh array (the caller is free to mutate the result).
    expect(out).not.toBe(input);
  });

  it("returns the input unchanged when active is absent", () => {
    expect(reorderById(["a", "b", "c"], "x", "b")).toEqual(["a", "b", "c"]);
  });

  it("returns the input unchanged when over is absent", () => {
    expect(reorderById(["a", "b", "c"], "a", "x")).toEqual(["a", "b", "c"]);
  });

  it("the output always contains every input id exactly once (length-invariant)", () => {
    const input = ["a", "b", "c", "d", "e"];
    const out = reorderById(input, "a", "e");
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it("handles the « réordonner 3 catégories » e2e payload shape (AC)", () => {
    // « Entrées, Plats, Desserts » → drag « Desserts » before « Plats » →
    // « Entrées, Desserts, Plats ». The full ordered ids list is what the
    // mutation receives — no diff.
    const before = ["entrees", "plats", "desserts"];
    const after = reorderById(before, "desserts", "plats");
    expect(after).toEqual(["entrees", "desserts", "plats"]);
  });
});
