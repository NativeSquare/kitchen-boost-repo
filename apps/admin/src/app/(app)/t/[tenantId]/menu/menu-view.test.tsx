/**
 * F-MENU-01 (#187) — `MenuView`, pure presentational shell of the menu page
 * (read-only categories list, slice 1 of EPIC F-MENU #149).
 *
 * Owns the three branches the page can be in:
 *   - `categories === undefined` → loading skeletons (no blank flash, no shell
 *     swap when the data lands).
 *   - `categories.length === 0`  → empty state (« Aucune catégorie… »).
 *   - else                       → vertical list of categories, ordered by
 *     `order` field, FLAT (no sub-categories V1, ADR 0010 / PRD 10 §5).
 *
 * Header (always rendered, regardless of branch):
 *   - title « Menu »
 *   - INACTIVE placeholders « Aperçu » / « Publier » + badge
 *     « modifications non publiées » (câblés à F-MENU-10, #254 — not this
 *     story). The buttons MUST be `disabled` so a manager can't trigger a
 *     publish before the publication wiring lands.
 *
 * Split out of `page.tsx` (which owns `useTenantQuery`) so vitest can pin
 * every branch under `environment: "node"` — same React-tree-serializer
 * pattern as `mes-clients-view.test.tsx` and `empty-state.test.tsx`. The
 * page hands `categories` in as a prop; the view is a pure function of its
 * props.
 *
 * Acceptance criteria covered (#187):
 *   - AC1 « Route accessible sous layout (app) » — pinned by `page.test.ts`.
 *   - AC2 « `useTenantQuery(api.lib.menu.categories.list)` câblé ; loading +
 *     empty state propres » → loading + empty branches pinned here, wiring
 *     pinned by `page.test.ts`.
 *   - AC3 « Catégories affichées en liste verticale à plat (pas de sous-cat
 *     V1), ordonnées par `order` » → assert the rendered names appear in
 *     ascending `order`, in a flat list (no `<ul>/<ol>` nesting deeper than
 *     1, no recursive children prop).
 *   - AC4 « Header avec titre et placeholders inactifs « Aperçu » /
 *     « Publier » / badge » → assert the three labels surface AND the
 *     buttons are `disabled`.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

// F-MENU-02 (#200) / F-MENU-03 (#206) — when CRUD/reorder callbacks are
// wired, `MenuView` renders `CategoryListEditor` (which uses `useState`,
// `useEffect`, `useMemo` + the dnd-kit primitives). Under
// `environment: "node"` (no React renderer), every hook + dnd-kit
// `useSyncExternalStore` throws. Mock them away so we can keep asserting on
// the rendered React-element tree via the serializer below.
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
vi.mock("@dnd-kit/core", () => {
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactNode => children ?? null;
  return {
    DndContext: passthrough,
    KeyboardSensor: function KeyboardSensor() {},
    PointerSensor: function PointerSensor() {},
    closestCenter: () => [],
    useSensor: () => ({}),
    useSensors: () => [],
  };
});
vi.mock("@dnd-kit/sortable", () => {
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactNode => children ?? null;
  return {
    SortableContext: passthrough,
    sortableKeyboardCoordinates: () => ({}),
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
    verticalListSortingStrategy: () => null,
  };
});
vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

// F-MENU-04 (#211) — the item-list thumbnail resolves `photoStorageId` →
// URL via `useQuery(api.storage.getImageUrl, ...)`. Under `environment: "node"`
// (no Convex provider, no React renderer), the real hook throws. Stub it to
// the loading sentinel so the thumbnail falls through to the placeholder.
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
}));

const { MenuView } = await import("./menu-view");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as mes-clients-view.test.tsx,
// trimmed to what we need here.
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

// ---------------------------------------------------------------------------
// Test fixtures — categories returned by `api.lib.menu.categories.list`.
// The backend already returns them sorted by `order` (see the categories
// store via `listTenantCategories`); we still test the view's INDEPENDENT
// resort so a backend regression that ships them out of order doesn't break
// the visible list (defensive — but cheap).
// ---------------------------------------------------------------------------
type Category = Doc<"menuCategories">;

function makeCategory(
  partial: Partial<Category> & { name: string; order: number },
): Category {
  return {
    _id: `cat_${partial.name}` as Category["_id"],
    _creationTime: 0,
    tenantId: "tenant_test" as Category["tenantId"],
    name: partial.name,
    order: partial.order,
    createdAt: 0,
  };
}

const UNORDERED_CATEGORIES: Category[] = [
  makeCategory({ name: "Desserts", order: 2 }),
  makeCategory({ name: "Entrées", order: 0 }),
  makeCategory({ name: "Plats", order: 1 }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MenuView — F-MENU-01 (#187)", () => {
  it("AC4 — surfaces the page title « Menu » on every branch", () => {
    for (const props of [
      { categories: undefined as Category[] | undefined },
      { categories: [] },
      { categories: UNORDERED_CATEGORIES },
    ]) {
      const text = allText(serialize(MenuView(props)));
      expect(text).toMatch(/\bMenu\b/);
    }
  });

  it("AC4 — header surfaces the « Aperçu » + « Publier » labels (badge presence is F-MENU-10's contract)", () => {
    // The badge « modifications non publiées » is now conditionally rendered
    // (F-MENU-10 / #254): visible only when the page wires
    // `hasUnpublishedChanges === true`. Its visibility contract lives in the
    // F-MENU-10 tests below — this AC4 test stays on the two header buttons.
    const text = allText(
      serialize(MenuView({ categories: UNORDERED_CATEGORIES })),
    );
    expect(text).toMatch(/Aperçu/);
    expect(text).toMatch(/Publier/);
  });

  it("AC4 — « Aperçu » and « Publier » HEADER buttons are DISABLED when no F-MENU-10 callbacks are wired (read-only baseline)", () => {
    // The buttons stay placeholders until the page wires the publication
    // callbacks (`onPublish` / `previewHref`). If a future refactor enables
    // them by accident on the read-only branch, a manager could trigger a
    // publish before `publishMenu` is even bound through `useTenantMutation`
    // — we'd rather fail loudly here than ship a misleading affordance.
    //
    // Pinned via data-slot to stay narrow: slice 2 (#200) introduces an
    // ENABLED "+ Catégorie" button when CRUD callbacks are wired, and the
    // delete-row buttons are also enabled — the disabled contract is on the
    // publish/preview header pair only, AND only without the F-MENU-10
    // callbacks (see the F-MENU-10 tests below for the activated branch).
    const tree = serialize(MenuView({ categories: UNORDERED_CATEGORIES }));
    const headerSlots = ["menu-preview-button", "menu-publish-button"] as const;
    for (const slot of headerSlots) {
      const matches = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === slot;
      });
      expect(matches.length).toBe(1);
      const node = matches[0] as {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      };
      expect(node.props["disabled"]).toBe(true);
    }
  });

  it("AC3 — flat list (no nested categories, no sub-cats V1)", () => {
    // ADR 0010 / PRD 10 §5: V1 menu has NO hierarchy. The rendered structure
    // MUST be a single flat list — assert there's at most one <ul>/<ol> in
    // the body branch, and that none of its descendants are themselves a
    // list (would betray a sub-cat).
    const tree = serialize(MenuView({ categories: UNORDERED_CATEGORIES }));
    const types = flatten(tree)
      .map((n) => (n && "type" in n ? n.type.toLowerCase() : null))
      .filter((t): t is string => t !== null);
    const listsCount = types.filter((t) => t === "ul" || t === "ol").length;
    // 0 (uses divs) or 1 (one flat list) are both acceptable; 2+ means
    // we accidentally rendered a sub-list.
    expect(listsCount).toBeLessThanOrEqual(1);
  });

  it("AC3 — renders the categories sorted by `order` (independent of input array order)", () => {
    // Input is Desserts(2), Entrées(0), Plats(1) — expected visible order:
    // Entrées, Plats, Desserts.
    const text = allText(
      serialize(MenuView({ categories: UNORDERED_CATEGORIES })),
    );
    const entreesIdx = text.indexOf("Entrées");
    const platsIdx = text.indexOf("Plats");
    const dessertsIdx = text.indexOf("Desserts");
    expect(entreesIdx).toBeGreaterThanOrEqual(0);
    expect(platsIdx).toBeGreaterThan(entreesIdx);
    expect(dessertsIdx).toBeGreaterThan(platsIdx);
  });

  it("AC2 — loading branch (categories === undefined) renders skeletons, NOT the empty state, NOT a crash", () => {
    const tree = serialize(MenuView({ categories: undefined }));
    expect(tree).not.toBeNull();
    const text = allText(tree);
    // Empty state copy must NOT show during loading.
    expect(text).not.toMatch(/aucune cat[ée]gorie/i);
    // The skeleton primitive (`Skeleton` from shadcn) renders with the
    // `animate-pulse` className — pinned via that marker.
    const classes = allClasses(tree);
    expect(classes).toMatch(/animate-pulse/);
  });

  it("AC2 — loading branch keeps the page title and the header buttons mounted (no blank flash)", () => {
    const text = allText(serialize(MenuView({ categories: undefined })));
    expect(text).toMatch(/\bMenu\b/);
    expect(text).toMatch(/Aperçu/);
    expect(text).toMatch(/Publier/);
  });

  it("AC2 — empty branch (categories === []) renders an explicit empty state, NOT skeletons", () => {
    const tree = serialize(MenuView({ categories: [] }));
    const text = allText(tree);
    // Empty state copy (load-bearing words; exact polish stays free).
    expect(text).toMatch(/aucune cat[ée]gorie/i);
    // Skeletons MUST NOT show on the empty branch (would betray a stuck
    // loading state).
    const classes = allClasses(tree);
    expect(classes).not.toMatch(/animate-pulse/);
  });

  it("AC4 — empty branch keeps the page title + header buttons (the empty state replaces only the body)", () => {
    const text = allText(serialize(MenuView({ categories: [] })));
    expect(text).toMatch(/\bMenu\b/);
    expect(text).toMatch(/Aperçu/);
    expect(text).toMatch(/Publier/);
  });

  // -------------------------------------------------------------------------
  // F-MENU-02 (#200) — CRUD wiring forwarded through MenuView
  // -------------------------------------------------------------------------
  // When `MenuView` receives the slice-2 callbacks (`onCreateCategory`,
  // `onRenameCategory`, `onDeleteCategory`), it must render the editable
  // `CategoryListEditor` instead of the read-only `CategoryList`. The view
  // itself stays a pure function of its props — the wiring lives in
  // `page.tsx` (pinned by `page.test.ts`).

  it("F-MENU-02 — without CRUD callbacks, header carries NO « + Catégorie » action (read-only mode preserved)", () => {
    const tree = serialize(MenuView({ categories: UNORDERED_CATEGORIES }));
    const addButtons = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-category-add";
    });
    expect(addButtons).toHaveLength(0);
  });

  it("F-MENU-02 — with CRUD callbacks, surfaces the « + Catégorie » affordance (data-slot=menu-category-add)", () => {
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
      }),
    );
    const addButtons = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-category-add";
    });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("F-MENU-02 — with CRUD callbacks, empty branch ALSO surfaces the « + Catégorie » CTA (else the gérant cannot bootstrap)", () => {
    const tree = serialize(
      MenuView({
        categories: [],
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
      }),
    );
    const addButtons = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-category-add";
    });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // F-MENU-03 (#206) — drag&drop reorder callback forwarded through MenuView
  // -------------------------------------------------------------------------
  // The page passes `onReorderCategories` (bound to
  // `useTenantMutation(api.lib.menu.categories.reorder)`) down through
  // `MenuView` to `CategoryListEditor`. When the prop is wired, each row
  // gets a drag handle (`data-slot="menu-category-drag-handle"`); when it
  // isn't, the editor stays orderable-from-elsewhere only.

  it("F-MENU-03 — without onReorderCategories, no drag handle surfaces (read-only ordering)", () => {
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
      }),
    );
    const handles = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-category-drag-handle";
    });
    expect(handles).toHaveLength(0);
  });

  it("F-MENU-03 — with onReorderCategories, surfaces a drag handle on each category row", () => {
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        onReorderCategories: () => {},
      }),
    );
    const handles = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-category-drag-handle";
    });
    expect(handles).toHaveLength(UNORDERED_CATEGORIES.length);
  });

  // -------------------------------------------------------------------------
  // F-MENU-04 (#211) — items list per category + inline rupture toggle
  // -------------------------------------------------------------------------
  // The page wires `itemsByCategory` (Record<categoryId, Doc<"menuItems">[]>
  // | undefined) and `onToggleItemAvailability` callbacks through MenuView
  // down to a per-category `ItemList`. When both are wired, each category
  // row surfaces its items inline with the rupture toggle on each card.
  // Read-only mode (no callbacks) preserves slice-1 behaviour: no items, no
  // toggle.

  it("F-MENU-04 — without itemsByCategory, no item row surfaces (read-only mode preserved)", () => {
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
      }),
    );
    const itemRows = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-row";
    });
    expect(itemRows).toHaveLength(0);
  });

  it("F-MENU-04 — with itemsByCategory + onToggleItemAvailability, surfaces item rows under each category", () => {
    type Item = Doc<"menuItems">;
    const makeItem = (name: string, categoryId: string, order: number): Item =>
      ({
        _id: `item_${name}` as Item["_id"],
        _creationTime: 0,
        tenantId: "tenant_test" as Item["tenantId"],
        categoryId: categoryId as Item["categoryId"],
        name,
        description: "",
        basePrice: 0,
        allergens: [],
        available: true,
        order,
        createdAt: 0,
      }) as Item;
    const cat0 = UNORDERED_CATEGORIES[0]._id as string; // Desserts (order=2)
    const cat1 = UNORDERED_CATEGORIES[1]._id as string; // Entrées (order=0)
    const itemsByCategory: Record<string, Item[]> = {
      [cat0]: [makeItem("Tiramisu", cat0, 0)],
      [cat1]: [makeItem("Salade", cat1, 0), makeItem("Soupe", cat1, 1)],
    };
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        itemsByCategory,
        onToggleItemAvailability: () => {},
      }),
    );
    const itemRows = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-row";
    });
    // 1 item under Desserts + 2 under Entrées = 3 total.
    expect(itemRows).toHaveLength(3);
    const text = allText(tree);
    expect(text).toMatch(/Tiramisu/);
    expect(text).toMatch(/Salade/);
    expect(text).toMatch(/Soupe/);
  });

  it("F-MENU-04 — with itemsByCategory + onToggleItemAvailability, surfaces a toggle per item", () => {
    type Item = Doc<"menuItems">;
    const makeItem = (name: string, categoryId: string, order: number): Item =>
      ({
        _id: `item_${name}` as Item["_id"],
        _creationTime: 0,
        tenantId: "tenant_test" as Item["tenantId"],
        categoryId: categoryId as Item["categoryId"],
        name,
        description: "",
        basePrice: 0,
        allergens: [],
        available: true,
        order,
        createdAt: 0,
      }) as Item;
    const cat0 = UNORDERED_CATEGORIES[0]._id as string;
    const itemsByCategory: Record<string, Item[]> = {
      [cat0]: [makeItem("Tiramisu", cat0, 0)],
    };
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        itemsByCategory,
        onToggleItemAvailability: () => {},
      }),
    );
    const toggles = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-availability-toggle";
    });
    expect(toggles).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // F-MENU-05 (#219) — « + Item » per-category CTA + click-on-card edit hook
  // -------------------------------------------------------------------------
  // The page wires `onCreateItem(categoryId)` (open the modal in CREATE mode
  // pre-filled on the clicked category) and `onItemClick(itemId)` (open the
  // modal in EDIT mode for the clicked item). When BOTH callbacks are wired
  // alongside the items-section props, each category section surfaces a
  // « + Item » footer button and each item card becomes clickable. Without
  // the callbacks, the items list stays read-only (the existing F-MENU-04
  // contract).

  it("F-MENU-05 — without onCreateItem, no « + Item » CTA surfaces in any category section", () => {
    type Item = Doc<"menuItems">;
    const cat0 = UNORDERED_CATEGORIES[0]._id as string;
    const itemsByCategory: Record<string, Item[]> = { [cat0]: [] };
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        itemsByCategory,
        onToggleItemAvailability: () => {},
      }),
    );
    const adders = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-add";
    });
    expect(adders).toHaveLength(0);
  });

  it("F-MENU-05 — with onCreateItem, surfaces a « + Item » CTA per category section (count = #categories)", () => {
    type Item = Doc<"menuItems">;
    const cat0 = UNORDERED_CATEGORIES[0]._id as string;
    const itemsByCategory: Record<string, Item[]> = { [cat0]: [] };
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        itemsByCategory,
        onToggleItemAvailability: () => {},
        onCreateItem: () => {},
        onItemClick: () => {},
      }),
    );
    const adders = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-add";
    });
    expect(adders).toHaveLength(UNORDERED_CATEGORIES.length);
  });

  it("F-MENU-05 — clicking « + Item » fires `onCreateItem(categoryId)` with the originating category", () => {
    type Item = Doc<"menuItems">;
    const cat0 = UNORDERED_CATEGORIES[0]._id as string;
    const itemsByCategory: Record<string, Item[]> = { [cat0]: [] };
    const onCreateItem = vi.fn();
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        itemsByCategory,
        onToggleItemAvailability: () => {},
        onCreateItem,
        onItemClick: () => {},
      }),
    );
    const adders = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-add";
    }) as Array<{
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    }>;
    expect(adders.length).toBeGreaterThan(0);
    // Each CTA carries an `onClick` that fires the wired callback with its
    // originating category id. We simulate one click and assert the id flows
    // back through.
    const firstAdder = adders[0];
    const onClick = firstAdder.props["onClick"] as (() => void) | undefined;
    expect(typeof onClick).toBe("function");
    onClick?.();
    expect(onCreateItem).toHaveBeenCalledTimes(1);
    // The arg is a string (category id). We don't pin which one (the
    // first-rendered section is the lowest-order category, Entrées); pin
    // « it's one of the input categories » so the test stays robust to
    // ordering refactors.
    const arg = onCreateItem.mock.calls[0][0] as string;
    expect(
      UNORDERED_CATEGORIES.map((c) => c._id as unknown as string),
    ).toContain(arg);
  });

  // -------------------------------------------------------------------------
  // F-MENU-07 (#237) — items drag&drop reorder forwarded through MenuView
  // -------------------------------------------------------------------------
  // The page passes `onReorderItems(categoryId, orderedIds)` (bound to
  // `useTenantMutation(api.lib.menu.items.reorder)`) down through `MenuView`
  // to each per-category `ItemList`. When the prop is wired, each item row
  // gets a drag handle (`data-slot="menu-item-drag-handle"`); when it isn't,
  // the items stay read-only-ordering (preserves slice-4 contract).

  it("F-MENU-07 — without onReorderItems, no item drag handle surfaces (read-only ordering)", () => {
    type Item = Doc<"menuItems">;
    const cat0 = UNORDERED_CATEGORIES[0]._id as string;
    const makeItem = (name: string, order: number): Item =>
      ({
        _id: `item_${name}` as Item["_id"],
        _creationTime: 0,
        tenantId: "tenant_test" as Item["tenantId"],
        categoryId: cat0 as Item["categoryId"],
        name,
        description: "",
        basePrice: 0,
        allergens: [],
        available: true,
        order,
        createdAt: 0,
      }) as Item;
    const itemsByCategory: Record<string, Item[]> = {
      [cat0]: [makeItem("Tiramisu", 0), makeItem("Brownie", 1)],
    };
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        itemsByCategory,
        onToggleItemAvailability: () => {},
      }),
    );
    const handles = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-drag-handle";
    });
    expect(handles).toHaveLength(0);
  });

  it("F-MENU-07 — with onReorderItems, surfaces an item drag handle on every item row", () => {
    type Item = Doc<"menuItems">;
    const cat0 = UNORDERED_CATEGORIES[0]._id as string; // Desserts
    const cat1 = UNORDERED_CATEGORIES[1]._id as string; // Entrées
    const makeItem = (name: string, catId: string, order: number): Item =>
      ({
        _id: `item_${name}` as Item["_id"],
        _creationTime: 0,
        tenantId: "tenant_test" as Item["tenantId"],
        categoryId: catId as Item["categoryId"],
        name,
        description: "",
        basePrice: 0,
        allergens: [],
        available: true,
        order,
        createdAt: 0,
      }) as Item;
    const itemsByCategory: Record<string, Item[]> = {
      [cat0]: [makeItem("Tiramisu", cat0, 0)],
      [cat1]: [makeItem("Salade", cat1, 0), makeItem("Soupe", cat1, 1)],
    };
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        itemsByCategory,
        onToggleItemAvailability: () => {},
        onReorderItems: () => {},
      }),
    );
    const handles = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-item-drag-handle";
    });
    // 1 (Desserts) + 2 (Entrées) = 3 handles total.
    expect(handles).toHaveLength(3);
  });

  it("AC3 — renders one category per row (count matches input length)", () => {
    // Pin the row count, so a future refactor that flattens children into
    // a single string (or duplicates them) fails. The rows are pinned by
    // a `data-slot="menu-category-row"` marker on each row (load-bearing).
    const tree = serialize(MenuView({ categories: UNORDERED_CATEGORIES }));
    const rowSlots = flatten(tree)
      .map((n) => {
        if (n === null || "text" in n) return null;
        const ds = n.props["data-slot"];
        return typeof ds === "string" ? ds : null;
      })
      .filter((s): s is string => s !== null)
      .filter((s) => s === "menu-category-row");
    expect(rowSlots).toHaveLength(UNORDERED_CATEGORIES.length);
  });

  // -------------------------------------------------------------------------
  // F-MENU-10 (#254) — header « Publier » + badge + « Aperçu » activation
  // -------------------------------------------------------------------------
  // The header pair (« Aperçu » + « Publier ») and the « modifications non
  // publiées » badge are placeholders until the page wires three new props:
  //   - `onPublish` (bound to `useTenantMutation(api.lib.menu.publication.publishMenu)`),
  //   - `hasUnpublishedChanges` (read from
  //     `useTenantQuery(api.lib.menu.publication.hasUnpublishedChanges)`),
  //   - `previewHref` (URL the « Aperçu » button opens — see page.test.ts
  //     for the wiring contract).
  // When `onPublish` is wired, the « Publier » button becomes enabled and
  // fires the callback on click; while `publishLoading` is true, the button
  // re-disables and surfaces a loading affordance (load-bearing for the AC
  // « loading state + success/error toasts »). When `previewHref` is wired,
  // the « Aperçu » button becomes enabled (rendered as a link). When
  // `hasUnpublishedChanges` is `true`, the badge becomes visible (active
  // styling); when `false` (or `undefined`), the badge stays hidden — ADR
  // 0015 « disparaît après publication réussie ».

  it("F-MENU-10 — without `onPublish`, the « Publier » button stays disabled (no half-wired publish path)", () => {
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
      }),
    );
    const matches = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-publish-button";
    }) as Array<{
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    }>;
    expect(matches).toHaveLength(1);
    expect(matches[0].props["disabled"]).toBe(true);
  });

  it("F-MENU-10 — with `onPublish` wired, the « Publier » button is enabled and fires the callback on click", () => {
    const onPublish = vi.fn();
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        onPublish,
      }),
    );
    const matches = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-publish-button";
    }) as Array<{
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    }>;
    expect(matches).toHaveLength(1);
    const btn = matches[0];
    expect(btn.props["disabled"]).toBeFalsy();
    const onClick = btn.props["onClick"] as (() => void) | undefined;
    expect(typeof onClick).toBe("function");
    onClick?.();
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("F-MENU-10 — `publishLoading` true re-disables the « Publier » button (loading state, ADR 0015 « loading »)", () => {
    // While the mutation is in flight, the button must NOT be re-clickable —
    // a second click would fire `publishMenu` again, which is wasteful (the
    // backend is idempotent at the snapshot level but the round-trip cost is
    // real) and confusing UX (double toasts). The page tracks the in-flight
    // state and forwards it as `publishLoading`.
    const onPublish = vi.fn();
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        onPublish,
        publishLoading: true,
      }),
    );
    const matches = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-publish-button";
    }) as Array<{
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    }>;
    expect(matches).toHaveLength(1);
    expect(matches[0].props["disabled"]).toBe(true);
  });

  it("F-MENU-10 — without `previewHref`, the « Aperçu » button stays disabled", () => {
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        onPublish: () => {},
      }),
    );
    const matches = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-preview-button";
    }) as Array<{
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    }>;
    expect(matches).toHaveLength(1);
    expect(matches[0].props["disabled"]).toBe(true);
  });

  it("F-MENU-10 — with `previewHref`, the « Aperçu » button surfaces an enabled link to that URL (opens the draft rendering)", () => {
    const previewHref = "/t/tenant_test/menu/preview";
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        onPublish: () => {},
        previewHref,
      }),
    );
    const matches = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-preview-button";
    }) as Array<{
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    }>;
    expect(matches).toHaveLength(1);
    const node = matches[0];
    // Either a real <a> with href, or a button-as-link wrapping an <a>; we
    // pin the URL surfaces somewhere under the preview slot.
    const subtree = flatten(node);
    const hasHref = subtree.some((n) => {
      if (n === null || "text" in n) return false;
      return n.props["href"] === previewHref;
    });
    expect(hasHref).toBe(true);
    // And the surface is NOT disabled (a disabled link wouldn't navigate).
    expect(node.props["disabled"]).toBeFalsy();
  });

  it("F-MENU-10 — `hasUnpublishedChanges` undefined or false → badge hidden (clean slate)", () => {
    // ADR 0015 « disparaît après publication réussie » : tant qu'il n'y a
    // rien à publier, le badge ne doit pas s'afficher (sinon il devient du
    // bruit visuel).
    for (const props of [
      { hasUnpublishedChanges: undefined as boolean | undefined },
      { hasUnpublishedChanges: false },
    ]) {
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
          ...props,
        }),
      );
      const badges = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-unpublished-badge";
      });
      expect(badges).toHaveLength(0);
    }
  });

  it("F-MENU-10 — `hasUnpublishedChanges` true → badge visible with the « modifications non publiées » copy", () => {
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        hasUnpublishedChanges: true,
      }),
    );
    const badges = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-unpublished-badge";
    });
    expect(badges).toHaveLength(1);
    const text = allText(tree);
    expect(text).toMatch(/modifications non publi[ée]es/i);
    // The visible badge MUST NOT carry the read-only `aria-disabled="true"`
    // marker (that flag was the placeholder semantic from F-MENU-01 — once
    // wired, it announces an actionable state, not a frozen one).
    const badge = badges[0] as {
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    };
    expect(badge.props["aria-disabled"]).not.toBe("true");
  });
});
