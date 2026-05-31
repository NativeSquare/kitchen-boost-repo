/**
 * F-MENU-04 (#211) — `ItemList` test contract.
 *
 * The pure presentational counterpart of slice 1's `CategoryList`, for items
 * UNDER a single category. Renders one card per item with name, price (TTC,
 * centimes formatted via `formatPriceCentimes`), thumbnail SLOT, and the
 * load-bearing INLINE rupture toggle (the « 1-tap out of stock » staff
 * affordance — see story body and CONTEXT « Item out of stock »).
 *
 * Why a SEPARATE file from `category-list-editor.tsx`: the category editor
 * owns category-level CRUD (rename, delete, reorder); items have a different
 * shape (price, allergens, photo, availability) and a different lifecycle
 * (toggle live without publication — ADR 0015 § Conséquences), so they live
 * in their own component to keep responsibilities tight and the test
 * surfaces independent.
 *
 * Three branches mirror slice 1's discipline:
 *   - `items === undefined` → loading skeletons (the category exists but its
 *     items haven't landed yet).
 *   - `items.length === 0`  → empty state per category (« Aucun item dans
 *     cette catégorie »).
 *   - else                  → flat vertical list of cards (sorted by `order`).
 *
 * Acceptance criteria pinned (#211):
 *   - AC1 « Items affichés sous chaque catégorie en cards (nom, prix,
 *     thumbnail) » → each row carries name + formatted price + thumbnail
 *     SLOT. The thumbnail SLOT is always rendered (placeholder when no
 *     `photoStorageId`), so the layout stays stable across items with /
 *     without photos.
 *   - AC2 « Toggle rupture sur card (et non pas seulement dans la modale) »
 *     → each row exposes a Switch with `data-slot="menu-item-availability-toggle"`
 *     and an `aria-label` that announces « Disponibilité de <name> ».
 *   - AC3 « Toggle appelle setItemAvailability en direct, optimistic UI » →
 *     the toggle's `onCheckedChange` (Radix Switch contract) invokes
 *     `onToggleAvailability(itemId, nextAvailable)` exactly once with the
 *     FLIPPED value. The optimistic-UI smoothing (don't snap back during
 *     in-flight) is pinned via Convex's natural reactivity — we assert the
 *     toggle's `checked` state mirrors `item.available` so a successful
 *     mutation round-trip is silent.
 *
 * Under `environment: "node"` (no React renderer), we re-use the same
 * react-tree serializer + react-hooks shim pattern as
 * `category-list-editor.test.tsx`. `useState` returns the initial value,
 * `useEffect` is a no-op — the assertions only walk the FIRST render.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

// React hooks shim — same shape as category-list-editor.test.tsx.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const v =
        typeof initial === "function" ? (initial as () => T)() : initial;
      return [v, () => {}];
    },
    useEffect: () => {},
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

// `convex/react` `useQuery` is invoked by the thumbnail component to resolve
// `photoStorageId` → URL via the template `api.storage.getImageUrl` query.
// Under node env (no Convex provider, no React renderer), the real hook
// throws. Stub it to return `undefined` (the Convex loading sentinel) so the
// thumbnail falls through to the placeholder branch — pinned by the « slot
// always present » assertion below.
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
}));

const { ItemList } = await import("./item-list");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (mirror of category-list-editor.test.tsx).
// ---------------------------------------------------------------------------
type SerializedNode =
  | { type: string; props: Record<string, unknown>; children: SerializedNode[] }
  | { text: string }
  | null;

function isReactElement(node: unknown): node is ReactElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node
  );
}

function typeName(t: unknown): string {
  if (typeof t === "string") return t;
  if (typeof t === "function") {
    return (
      (t as { displayName?: string; name?: string }).displayName ??
      (t as { name?: string }).name ??
      "Anonymous"
    );
  }
  return String(t);
}

function serialize(node: ReactNode): SerializedNode {
  if (node === null || node === undefined || node === false || node === true) {
    return null;
  }
  if (typeof node === "string" || typeof node === "number") {
    return { text: String(node) };
  }
  if (Array.isArray(node)) {
    return {
      type: "ArrayFragment",
      props: {},
      children: node
        .map((c) => serialize(c))
        .filter((c): c is SerializedNode => c !== null),
    };
  }
  if (isReactElement(node)) {
    if (typeof node.type === "function") {
      const fn = node.type as (p: unknown) => ReactNode;
      try {
        return serialize(fn(node.props));
      } catch {
        return { type: typeName(node.type), props: {}, children: [] };
      }
    }
    const props = { ...(node.props as Record<string, unknown>) };
    const rawChildren = props.children as ReactNode | undefined;
    delete props.children;
    const children: SerializedNode[] = [];
    if (rawChildren !== undefined) {
      const list = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
      for (const c of list) {
        const s = serialize(c);
        if (s !== null) children.push(s);
      }
    }
    return { type: typeName(node.type), props, children };
  }
  return null;
}

function flatten(n: SerializedNode): SerializedNode[] {
  if (n === null) return [];
  if ("text" in n) return [n];
  return [n, ...n.children.flatMap(flatten)];
}

function allText(n: SerializedNode): string {
  return flatten(n)
    .map((x) => (x && "text" in x ? x.text : null))
    .filter((x): x is string => x !== null)
    .join(" ");
}

function allClasses(n: SerializedNode): string {
  return flatten(n)
    .map((x) => {
      if (x === null || "text" in x) return null;
      const cls = x.props["className"];
      return typeof cls === "string" ? cls : null;
    })
    .filter((c): c is string => c !== null)
    .join(" ");
}

function findBySlot(n: SerializedNode, slot: string) {
  return flatten(n).filter((x) => {
    if (x === null || "text" in x) return false;
    return x.props["data-slot"] === slot;
  }) as Array<{
    type: string;
    props: Record<string, unknown>;
    children: SerializedNode[];
  }>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
type Item = Doc<"menuItems">;

function makeItem(
  partial: Partial<Item> & { name: string; order: number },
): Item {
  return {
    _id: `item_${partial.name}` as Item["_id"],
    _creationTime: 0,
    tenantId: "tenant_test" as Item["tenantId"],
    categoryId: "cat_test" as Item["categoryId"],
    name: partial.name,
    description: partial.description ?? "",
    basePrice: partial.basePrice ?? 0,
    allergens: partial.allergens ?? [],
    available: partial.available ?? true,
    order: partial.order,
    createdAt: 0,
    photoStorageId: partial.photoStorageId,
    unavailableSince: partial.unavailableSince,
  };
}

const SMASH_BURGER = makeItem({
  name: "Smash Burger",
  order: 0,
  basePrice: 1250,
  available: true,
});
const TIRAMISU = makeItem({
  name: "Tiramisu",
  order: 1,
  basePrice: 650,
  available: false,
  unavailableSince: 1_700_000_000_000,
});
const COKE = makeItem({
  name: "Coca-Cola",
  order: 2,
  basePrice: 300,
  available: true,
  photoStorageId: "kg2_storage_id" as Item["photoStorageId"],
});
const ITEMS: Item[] = [SMASH_BURGER, TIRAMISU, COKE];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ItemList — F-MENU-04 (#211)", () => {
  it("AC1 — renders one card per item, sorted by `order` (defensive resort)", () => {
    // Pass them in REVERSE order to assert the defensive resort.
    const tree = serialize(
      ItemList({
        items: [COKE, TIRAMISU, SMASH_BURGER],
        onToggleAvailability: vi.fn(),
      }),
    );
    const rows = findBySlot(tree, "menu-item-row");
    expect(rows).toHaveLength(ITEMS.length);
    const text = allText(tree);
    const burgerIdx = text.indexOf("Smash Burger");
    const tiraIdx = text.indexOf("Tiramisu");
    const cokeIdx = text.indexOf("Coca-Cola");
    expect(burgerIdx).toBeGreaterThanOrEqual(0);
    expect(tiraIdx).toBeGreaterThan(burgerIdx);
    expect(cokeIdx).toBeGreaterThan(tiraIdx);
  });

  it("AC1 — each card surfaces the item's name and formatted price (TTC, centimes → « N,DD € »)", () => {
    const tree = serialize(
      ItemList({ items: ITEMS, onToggleAvailability: vi.fn() }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Smash Burger/);
    expect(text).toMatch(/Tiramisu/);
    expect(text).toMatch(/Coca-Cola/);
    // Prices: 1250 → 12,50 € ; 650 → 6,50 € ; 300 → 3,00 €.
    expect(text).toMatch(/12,50\s?€/);
    expect(text).toMatch(/6,50\s?€/);
    expect(text).toMatch(/3,00\s?€/);
  });

  it("AC1 — each card carries a thumbnail SLOT (rendered for ALL items, layout stays stable across with/without photo)", () => {
    // The thumbnail SLOT is the layout-stable affordance: present even when
    // the item has no photo (placeholder branch). If a future refactor only
    // renders the thumbnail conditionally, the cards would jump on every
    // photo upload — bad UX for a list the gérant scans.
    const tree = serialize(
      ItemList({ items: ITEMS, onToggleAvailability: vi.fn() }),
    );
    const thumbnails = findBySlot(tree, "menu-item-thumbnail");
    expect(thumbnails).toHaveLength(ITEMS.length);
  });

  it("AC2 — each card carries the rupture toggle inline (data-slot=menu-item-availability-toggle)", () => {
    // The 1-tap out-of-stock toggle is the load-bearing staff affordance —
    // it MUST live on the card, not behind an « edit item » modal.
    const tree = serialize(
      ItemList({ items: ITEMS, onToggleAvailability: vi.fn() }),
    );
    const toggles = findBySlot(tree, "menu-item-availability-toggle");
    expect(toggles).toHaveLength(ITEMS.length);
  });

  it("AC2 — each toggle carries an aria-label announcing the item it controls (screen-reader announces « Disponibilité de <name> »)", () => {
    const tree = serialize(
      ItemList({ items: ITEMS, onToggleAvailability: vi.fn() }),
    );
    const toggles = findBySlot(tree, "menu-item-availability-toggle");
    for (const t of toggles) {
      const aria = t.props["aria-label"];
      expect(typeof aria).toBe("string");
      expect(aria as string).toMatch(/disponibilit[ée]/i);
    }
    // At least one toggle's label includes a known item name (we don't pin
    // the exact phrasing — load-bearing is « the item name appears »).
    const labels = toggles
      .map((t) => t.props["aria-label"])
      .filter((a): a is string => typeof a === "string");
    expect(labels.some((l) => l.includes("Smash Burger"))).toBe(true);
  });

  it("AC3 — toggle `checked` mirrors `item.available` (true for available items, false for ruptured)", () => {
    // Smash Burger (available) → checked=true.
    // Tiramisu (unavailable) → checked=false.
    // The « checked » prop is the Radix Switch root prop; we read it off the
    // serialized node directly.
    const tree = serialize(
      ItemList({ items: ITEMS, onToggleAvailability: vi.fn() }),
    );
    const toggles = findBySlot(tree, "menu-item-availability-toggle");
    const burgerToggle = toggles.find((t) =>
      (t.props["aria-label"] as string).includes("Smash Burger"),
    );
    const tiraToggle = toggles.find((t) =>
      (t.props["aria-label"] as string).includes("Tiramisu"),
    );
    expect(burgerToggle?.props["checked"]).toBe(true);
    expect(tiraToggle?.props["checked"]).toBe(false);
  });

  it("AC3 — `onCheckedChange(next)` invokes `onToggleAvailability(itemId, next)` exactly once with the FLIPPED value", () => {
    // The « optimistic UI in direct, sans passer par publication » contract
    // (story body, ADR 0015 § Conséquences): one toggle click → one mutation
    // call with the new boolean — no debounce, no batching.
    const onToggleAvailability = vi.fn();
    const tree = serialize(ItemList({ items: ITEMS, onToggleAvailability }));
    const toggles = findBySlot(tree, "menu-item-availability-toggle");
    const burgerToggle = toggles.find((t) =>
      (t.props["aria-label"] as string).includes("Smash Burger"),
    );
    expect(burgerToggle).toBeDefined();
    const onCheckedChange = burgerToggle?.props["onCheckedChange"] as
      | ((next: boolean) => void)
      | undefined;
    expect(typeof onCheckedChange).toBe("function");
    // Simulate Radix calling us with the NEW (toggled) value.
    onCheckedChange?.(false);
    expect(onToggleAvailability).toHaveBeenCalledTimes(1);
    expect(onToggleAvailability).toHaveBeenCalledWith(SMASH_BURGER._id, false);
  });

  it("AC3 — ruptured item toggle → `onCheckedChange(true)` re-enables it (the gérant can flip it back manually)", () => {
    const onToggleAvailability = vi.fn();
    const tree = serialize(ItemList({ items: ITEMS, onToggleAvailability }));
    const toggles = findBySlot(tree, "menu-item-availability-toggle");
    const tiraToggle = toggles.find((t) =>
      (t.props["aria-label"] as string).includes("Tiramisu"),
    );
    const onCheckedChange = tiraToggle?.props["onCheckedChange"] as
      | ((next: boolean) => void)
      | undefined;
    onCheckedChange?.(true);
    expect(onToggleAvailability).toHaveBeenCalledTimes(1);
    expect(onToggleAvailability).toHaveBeenCalledWith(TIRAMISU._id, true);
  });

  it("loading branch (items === undefined) renders skeletons, NOT the empty state, NOT a crash", () => {
    const tree = serialize(
      ItemList({ items: undefined, onToggleAvailability: vi.fn() }),
    );
    expect(tree).not.toBeNull();
    const text = allText(tree);
    expect(text).not.toMatch(/aucun item/i);
    // The Skeleton primitive renders with `animate-pulse` (shadcn marker).
    const classes = allClasses(tree);
    expect(classes).toMatch(/animate-pulse/);
  });

  it("empty branch (items === []) renders an explicit empty state per-category, NOT skeletons", () => {
    const tree = serialize(
      ItemList({ items: [], onToggleAvailability: vi.fn() }),
    );
    const text = allText(tree);
    expect(text).toMatch(/aucun item/i);
    const classes = allClasses(tree);
    expect(classes).not.toMatch(/animate-pulse/);
  });

  it("when an item is ruptured, surfaces a visual « rupture » badge so the gérant scans the list at a glance", () => {
    // The toggle alone is too subtle — a list of 50 items needs a quick
    // visual signal for « this one is out of stock right now ». The badge
    // is pinned by data-slot so a polish refactor doesn't break the contract.
    const tree = serialize(
      ItemList({ items: ITEMS, onToggleAvailability: vi.fn() }),
    );
    const badges = findBySlot(tree, "menu-item-rupture-badge");
    // Exactly ONE badge: Tiramisu (available=false). Smash Burger and Coke
    // are available → no badge.
    expect(badges).toHaveLength(1);
  });

  // Mark `Id` import as used so the type-only fixture compiles in node env.
  void ({} as Id<"menuItems">);
});
