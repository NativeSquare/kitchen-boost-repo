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
    // « + Ajouter une catégorie » UX — CategoryRow uses `useRef` for the
    // input element (autofocus + select-all on first mount). Real `useRef`
    // throws under `environment: "node"`. Stub to a fresh object per call.
    useRef: <T,>(initial: T) => ({ current: initial }),
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

// Refonte tabs Menu (2026-06-03) — The view now wraps its body in a `<Tabs>`
// (radix-ui). Radix-ui's primitives call internal React hooks (`useContext`,
// `useState`, `useId`…) — those throw under `environment: "node"`. We replace
// the four exports with thin passthroughs that:
//   - render only the `<TabsContent>` whose `value` matches the active `<Tabs>`
//     value, so the serializer doesn't walk every tab's content (which would
//     double-count category rows + leak drag handles into the « Catégories »
//     tab assertions etc.) — same shape as the real client behaviour.
//   - keep the `<TabsList>` + `<TabsTrigger>` markers visible so the trigger
//     count + click handlers stay testable.
vi.mock("@/components/ui/tabs", async () => {
  const { createElement, isValidElement, Children } =
    await vi.importActual<typeof import("react")>("react");
  type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

  function TabsContent({
    value,
    children,
    ...rest
  }: AnyProps & { value?: string }) {
    return createElement(
      "div",
      { "data-slot": "tabs-content", "data-value": value, ...rest },
      children,
    );
  }
  function Tabs({ value, children, ...rest }: AnyProps & { value?: string }) {
    // Keep ONLY the `<TabsContent>` whose `value` matches the active tab so
    // the serializer doesn't walk every tab's body (which would double-count
    // category rows etc.). Filter by reference (the mock module is the single
    // source of truth — both the JSX <TabsContent ...> elements and our local
    // `TabsContent` symbol resolve here).
    const filtered: React.ReactNode[] = [];
    Children.forEach(children, (child) => {
      if (
        isValidElement(child) &&
        (child as { type?: unknown }).type === TabsContent
      ) {
        const cv = (child.props as { value?: string }).value;
        if (cv === value) filtered.push(child);
        return;
      }
      filtered.push(child);
    });
    return createElement(
      "div",
      { "data-slot": "tabs", "data-value": value, ...rest },
      filtered,
    );
  }
  function TabsList({ children, ...rest }: AnyProps) {
    return createElement(
      "div",
      { "data-slot": "tabs-list", ...rest },
      children,
    );
  }
  function TabsTrigger({
    value,
    children,
    ...rest
  }: AnyProps & { value?: string }) {
    return createElement(
      "button",
      { "data-slot": "tabs-trigger", "data-value": value, ...rest },
      children,
    );
  }
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

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
    // Refonte tabs Menu (2026-06-03) — the tab triggers also carry the word
    // « Plats » (the « Plats » tab label), so we narrow the assertion to the
    // category rows themselves rather than the full page text.
    const tree = serialize(MenuView({ categories: UNORDERED_CATEGORIES }));
    const rows = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return n.props["data-slot"] === "menu-category-row";
    });
    const rowNames = rows.map((r) => allText(r));
    // Find the index of each category name in the rendered row list.
    const entreesRow = rowNames.findIndex((t) => t.includes("Entrées"));
    const platsRow = rowNames.findIndex((t) => t.includes("Plats"));
    const dessertsRow = rowNames.findIndex((t) => t.includes("Desserts"));
    expect(entreesRow).toBeGreaterThanOrEqual(0);
    expect(platsRow).toBeGreaterThan(entreesRow);
    expect(dessertsRow).toBeGreaterThan(platsRow);
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
    // The « + Catégorie » CTA lives in the « Catégories » tab (the structural
    // spine surface — single source of truth for category creation; the « Plats »
    // tab is items-only since Alex fix M-B 2026-06-03).
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        currentTab: "categories",
        onTabChange: () => {},
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
    // Drag handles on categories live in the « Catégories » tab (since Alex
    // fix M-B 2026-06-03: the « Plats » tab is items-only and the category
    // header is read-only with no drag handle — reorder happens from the
    // « Catégories » tab, single source of truth for the spine).
    const tree = serialize(
      MenuView({
        categories: UNORDERED_CATEGORIES,
        onCreateCategory: () => {},
        onRenameCategory: () => {},
        onDeleteCategory: () => {},
        onReorderCategories: () => {},
        currentTab: "categories",
        onTabChange: () => {},
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

  // ---------------------------------------------------------------------------
  // Refonte tabs Menu (Alex, 2026-06-03) — 3-tab navigation
  // ---------------------------------------------------------------------------
  // The view now wraps its body in a `<Tabs>` with three tabs (Catégories /
  // Plats / Personnalisations). The page persists the active tab in the URL
  // via `?tab=...` and forwards `currentTab` + `onTabChange` down. Without
  // `currentTab` wired, the view falls back to the default tab (« Plats »,
  // the daily-use surface — rupture toggles + item edits).
  //
  // The header (badge + Publier + Aperçu) stays OUTSIDE the tabs container,
  // so all three tab states keep them visible.
  describe("Refonte tabs Menu (2026-06-03)", () => {
    it("renders three tab triggers with the canonical labels and data-slots", () => {
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
        }),
      );
      const triggers = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        const ds = n.props["data-slot"];
        return (
          ds === "menu-tab-trigger-categories" ||
          ds === "menu-tab-trigger-items" ||
          ds === "menu-tab-trigger-modifiers"
        );
      });
      expect(triggers).toHaveLength(3);
      const text = allText(tree);
      expect(text).toMatch(/Catégories/);
      expect(text).toMatch(/Plats/);
      expect(text).toMatch(/Personnalisations/);
    });

    it("defaults to the « Plats » tab when `currentTab` is not wired (daily-use surface)", () => {
      // Without a `currentTab` prop, the view falls back to DEFAULT_MENU_TAB
      // (`"items"`). We assert the items-tab content is the one rendered —
      // the items section (« Ajouter un item » CTA, surfaced ONLY in
      // `with-items` mode of CategoryListEditor) is present.
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
          itemsByCategory: {},
          onToggleItemAvailability: () => {},
          onCreateItem: () => {},
          onItemClick: () => {},
        }),
      );
      const itemAdders = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-item-add";
      });
      // Items tab is active → each category surfaces its « + Item » CTA.
      expect(itemAdders.length).toBeGreaterThan(0);
    });

    it("Tab « Catégories » (list-only) does NOT render item rows", () => {
      // The spec: « Tab Catégories en mode list-only ne render PAS d'items ».
      // We provide a full items map + the toggle handler — the list-only mode
      // must still strip them. Pin via the canonical item-row data-slot.
      type Item = Doc<"menuItems">;
      const cat0 = UNORDERED_CATEGORIES[0]._id as string;
      const itemsByCategory: Record<string, Item[]> = {
        [cat0]: [
          {
            _id: "item_x" as Item["_id"],
            _creationTime: 0,
            tenantId: "tenant_test" as Item["tenantId"],
            categoryId: cat0 as Item["categoryId"],
            name: "Tiramisu",
            description: "",
            basePrice: 0,
            allergens: [],
            available: true,
            order: 0,
            createdAt: 0,
          } as Item,
        ],
      };
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
          currentTab: "categories",
          onTabChange: () => {},
        }),
      );
      const itemRows = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-item-row";
      });
      expect(itemRows).toHaveLength(0);
      // The category rows ARE still rendered (the list-only spine).
      const categoryRows = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-row";
      });
      expect(categoryRows).toHaveLength(UNORDERED_CATEGORIES.length);
      // And the « + Item » CTA must NOT surface in list-only mode (no item
      // creation path from the Catégories tab).
      const itemAdders = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-item-add";
      });
      expect(itemAdders).toHaveLength(0);
    });

    it("Tab « Plats » (items-only) renders item rows + « + Item » per category", () => {
      type Item = Doc<"menuItems">;
      const cat0 = UNORDERED_CATEGORIES[0]._id as string;
      const cat1 = UNORDERED_CATEGORIES[1]._id as string;
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
        [cat1]: [makeItem("Salade", cat1, 0)],
      };
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
          currentTab: "items",
          onTabChange: () => {},
        }),
      );
      const itemRows = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-item-row";
      });
      expect(itemRows.length).toBeGreaterThanOrEqual(2);
      // One « + Item » CTA per category (3 categories in UNORDERED_CATEGORIES).
      const itemAdders = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-item-add";
      });
      expect(itemAdders).toHaveLength(UNORDERED_CATEGORIES.length);
    });

    // -------------------------------------------------------------------------
    // Alex fix M-B (2026-06-03) — Tab « Plats » headers must be READ-ONLY
    // -------------------------------------------------------------------------
    // « dans le menu, je dois pas pouvoir éditer les catégories si je suis dans
    // la catégorie « Plat ». Les catégories doivent juste apparaître en toutes
    // lettres MAJUSCULES, mais pas être éditables. Si on veut éditer les
    // catégories, ça se fait depuis la table « Catégorie ». »
    //
    // Implementation: `CategoryListEditor` got a third `displayMode="items-only"`
    // value that renders the row's header as an uppercase <h3> (no Input, no
    // delete button, no drag handle on the category itself) while keeping the
    // items section + « + Item » CTA below each header.

    it("Alex fix M-B — Tab « Plats » category headers are READ-ONLY (no input, no delete, no drag handle, no « + Catégorie »)", () => {
      type Item = Doc<"menuItems">;
      const cat0 = UNORDERED_CATEGORIES[0]._id as string;
      const itemsByCategory: Record<string, Item[]> = {
        [cat0]: [
          {
            _id: "item_x" as Item["_id"],
            _creationTime: 0,
            tenantId: "tenant_test" as Item["tenantId"],
            categoryId: cat0 as Item["categoryId"],
            name: "Tiramisu",
            description: "",
            basePrice: 0,
            allergens: [],
            available: true,
            order: 0,
            createdAt: 0,
          } as Item,
        ],
      };
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
          // Page-side wiring stays untouched: it always passes the reorder
          // callback. The items-only mode must IGNORE it for the category spine
          // (drag handle on category MUST NOT surface in the Plats tab).
          onReorderCategories: () => {},
          itemsByCategory,
          onToggleItemAvailability: () => {},
          onCreateItem: () => {},
          onItemClick: () => {},
          onReorderItems: () => {},
          currentTab: "items",
          onTabChange: () => {},
        }),
      );
      // No category rename input → editing the spine from Plats is impossible.
      const nameInputs = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-name-input";
      });
      expect(nameInputs).toHaveLength(0);
      // No delete button on the category header.
      const deleteButtons = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-delete";
      });
      expect(deleteButtons).toHaveLength(0);
      // No drag handle on the category header (reorder lives in the Catégories
      // tab exclusively).
      const categoryDragHandles = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-drag-handle";
      });
      expect(categoryDragHandles).toHaveLength(0);
      // No « + Catégorie » footer button (categories are bootstrapped from the
      // Catégories tab — single source of truth).
      const addCategoryButtons = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-add";
      });
      expect(addCategoryButtons).toHaveLength(0);
    });

    it("Alex fix M-B — Tab « Plats » still surfaces each category NAME as an UPPERCASE header (visible structure)", () => {
      // The gérant needs to know WHICH category each items block belongs to —
      // the header text is the visible structural anchor. We pin via the
      // canonical `menu-category-row` slot (data-slot kept stable across the
      // editable Card branch + the read-only <h3> branch — selector continuity
      // for the E2E tests).
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
          currentTab: "items",
          onTabChange: () => {},
        }),
      );
      const rows = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-row";
      });
      expect(rows).toHaveLength(UNORDERED_CATEGORIES.length);
      // Uppercase rendering via CSS `text-transform: uppercase` (Tailwind's
      // `uppercase` utility). We pin the class on every header so a future
      // refactor can't silently regress the rendering. Use allClasses on the
      // row subtree to absorb children class noise.
      for (const row of rows) {
        expect(allClasses(row)).toMatch(/\buppercase\b/);
      }
      // The category names themselves are still rendered as text inside the row.
      const rowsText = rows.map((r) => allText(r)).join(" ");
      for (const c of UNORDERED_CATEGORIES) {
        expect(rowsText).toContain(c.name);
      }
    });

    it("Alex fix M-B — Tab « Catégories » still surfaces EDITABLE headers (rename + delete + drag handle preserved)", () => {
      // Inverse pin of the previous test: the « Catégories » tab is the
      // canonical editing surface for the spine. The list-only mode preserves
      // every existing affordance (input, delete, drag handle, « + Catégorie »).
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
          onReorderCategories: () => {},
          currentTab: "categories",
          onTabChange: () => {},
        }),
      );
      const nameInputs = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-name-input";
      });
      expect(nameInputs).toHaveLength(UNORDERED_CATEGORIES.length);
      const deleteButtons = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-delete";
      });
      expect(deleteButtons).toHaveLength(UNORDERED_CATEGORIES.length);
      const dragHandles = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-drag-handle";
      });
      expect(dragHandles).toHaveLength(UNORDERED_CATEGORIES.length);
      const addCategoryButtons = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-add";
      });
      expect(addCategoryButtons).toHaveLength(1);
    });

    // -------------------------------------------------------------------------
    // Alex fix M-B (2026-06-03) — « Aperçu » header button — visible & linked
    // -------------------------------------------------------------------------
    // Bug Alex E2E manuel : « pour M9, il faut que tu remettes les liens
    // fonctionnels et que tu mettes un raccourci depuis le menu [...] il faut
    // bien ajouter à la fois le bouton pour accéder à la preview dans le menu,
    // et il faut également que la preview fonctionne ».
    //
    // The button + the link were both wired in db8e295 (F-MENU-10 / #254). We
    // lock the contract here so the split-tabs refactor (or a future tab
    // refactor) can never accidentally drop the wiring again.

    it("Alex fix M-B — « Aperçu » header button is ENABLED with an href ending in `/menu/preview` (peu importe tab actif)", () => {
      const previewHref = "/t/tenant_test/menu/preview";
      for (const tab of ["categories", "items", "modifiers"] as const) {
        const tree = serialize(
          MenuView({
            categories: UNORDERED_CATEGORIES,
            onCreateCategory: () => {},
            onRenameCategory: () => {},
            onDeleteCategory: () => {},
            previewHref,
            currentTab: tab,
            onTabChange: () => {},
            modifiersSection: <div>placeholder</div>,
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
        expect(matches, `tab=${tab}`).toHaveLength(1);
        const node = matches[0];
        // Enabled (a disabled link wouldn't navigate) — the wired branch
        // renders an <a>-wrapping Button (asChild), never the disabled
        // placeholder Button.
        expect(node.props["disabled"], `tab=${tab}`).toBeFalsy();
        // The href is the page-built `/t/<tenantId>/menu/preview` URL — pin
        // the suffix so a future refactor that swaps it for the eater PWA
        // host (which would surface the published snapshot, NOT the draft —
        // breaking the load-bearing « Aperçu = brouillon » invariant of
        // ADR 0015) fails loudly.
        const anchorWithHref = flatten(node).find((n) => {
          if (n === null || "text" in n) return false;
          const href = n.props["href"];
          return typeof href === "string" && href.endsWith("/menu/preview");
        });
        expect(anchorWithHref, `tab=${tab}`).toBeDefined();
      }
    });

    it("Tab « Personnalisations » renders the modifiersSection passed by the page", () => {
      // The page mounts `<ModifierGroupsSection ... />` and passes it down as
      // `modifiersSection`; the view renders it inside the « modifiers » tab
      // content. We pin via a sentinel React element (the page-side wiring is
      // pinned by page.test.ts).
      const sentinel = (
        <div data-slot="test-modifiers-sentinel">SENTINEL_MODIFIERS</div>
      );
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
          currentTab: "modifiers",
          onTabChange: () => {},
          modifiersSection: sentinel,
        }),
      );
      const sentinels = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "test-modifiers-sentinel";
      });
      expect(sentinels).toHaveLength(1);
      // And no category rows should be rendered in the modifiers tab (the
      // mocked Tabs only walks the active tab's content).
      const categoryRows = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-category-row";
      });
      expect(categoryRows).toHaveLength(0);
    });

    it("Tab trigger click forwards the new tab id to `onTabChange`", () => {
      const onTabChange = vi.fn();
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
          currentTab: "items",
          onTabChange,
        }),
      );
      // The radix `<Tabs onValueChange>` fires when a trigger is clicked. Our
      // test mock surfaces the change via the same channel. We simulate by
      // walking up to the Tabs root and invoking its `onValueChange`.
      const tabsRoot = flatten(tree).find((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "tabs";
      }) as
        | {
            type: string;
            props: Record<string, unknown>;
            children: SerializedNode[];
          }
        | undefined;
      expect(tabsRoot).toBeDefined();
      const onValueChange = tabsRoot?.props["onValueChange"] as
        | ((next: string) => void)
        | undefined;
      expect(typeof onValueChange).toBe("function");
      onValueChange?.("modifiers");
      expect(onTabChange).toHaveBeenCalledTimes(1);
      expect(onTabChange).toHaveBeenCalledWith("modifiers");
    });

    it("`hasUnpublishedChanges` badge stays visible regardless of the active tab", () => {
      // The header (badge + Publier + Aperçu) lives OUTSIDE the tabs container
      // so all three tab states keep the publication affordances visible — the
      // gérant must always be able to publish, no matter which tab they're on.
      for (const tab of ["categories", "items", "modifiers"] as const) {
        const tree = serialize(
          MenuView({
            categories: UNORDERED_CATEGORIES,
            onCreateCategory: () => {},
            onRenameCategory: () => {},
            onDeleteCategory: () => {},
            hasUnpublishedChanges: true,
            currentTab: tab,
            onTabChange: () => {},
            modifiersSection: <div>placeholder</div>,
          }),
        );
        const badges = flatten(tree).filter((n) => {
          if (n === null || "text" in n) return false;
          return n.props["data-slot"] === "menu-unpublished-badge";
        });
        expect(badges, `tab=${tab}`).toHaveLength(1);
        // Publish + Preview buttons also stay mounted per tab.
        const publishButtons = flatten(tree).filter((n) => {
          if (n === null || "text" in n) return false;
          return n.props["data-slot"] === "menu-publish-button";
        });
        expect(publishButtons, `tab=${tab}`).toHaveLength(1);
        const previewButtons = flatten(tree).filter((n) => {
          if (n === null || "text" in n) return false;
          return n.props["data-slot"] === "menu-preview-button";
        });
        expect(previewButtons, `tab=${tab}`).toHaveLength(1);
      }
    });

    it("Click on an item card (tab Plats) forwards `onItemClick(itemId)` — modal opens at page level", () => {
      // Acceptance criterion #6 from the spec: « Click sur item (tab Plats)
      // ouvre ItemModal — préserve le test existant, juste vérifie que ça
      // marche depuis le tab `items` ». The modal mount is page-level (pinned
      // by page.test.ts); here we only pin that the row click forwards the
      // item id through `onItemClick` when the items tab is the active one.
      type Item = Doc<"menuItems">;
      const cat0 = UNORDERED_CATEGORIES[0]._id as string;
      const itemDoc: Item = {
        _id: "item_tira" as Item["_id"],
        _creationTime: 0,
        tenantId: "tenant_test" as Item["tenantId"],
        categoryId: cat0 as Item["categoryId"],
        name: "Tiramisu",
        description: "",
        basePrice: 0,
        allergens: [],
        available: true,
        order: 0,
        createdAt: 0,
      } as Item;
      const onItemClick = vi.fn();
      const tree = serialize(
        MenuView({
          categories: UNORDERED_CATEGORIES,
          onCreateCategory: () => {},
          onRenameCategory: () => {},
          onDeleteCategory: () => {},
          itemsByCategory: { [cat0]: [itemDoc] },
          onToggleItemAvailability: () => {},
          onCreateItem: () => {},
          onItemClick,
          currentTab: "items",
          onTabChange: () => {},
        }),
      );
      const clickables = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "menu-item-card-clickable";
      }) as Array<{
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      }>;
      // At least the one item we provided must have a clickable surface.
      expect(clickables.length).toBeGreaterThanOrEqual(1);
      const onClick = clickables[0].props["onClick"] as
        | (() => void)
        | undefined;
      expect(typeof onClick).toBe("function");
      onClick?.();
      expect(onItemClick).toHaveBeenCalledTimes(1);
      // The arg is the item id we threaded down.
      expect(onItemClick).toHaveBeenCalledWith("item_tira");
    });
  });
});
