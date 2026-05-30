/**
 * F-MENU-02 (#200) — `CategoryListEditor` test contract.
 *
 * The editor is the CRUD-enabled counterpart of slice 1's pure `CategoryList`:
 * adds inline rename (debounced), delete (with confirmation), and a footer
 * "+ Catégorie" button. It is rendered by `MenuView` when callbacks are wired
 * (page.tsx threads them via `useTenantMutation`), and the read-only
 * `CategoryList` is rendered otherwise. Both paths stay testable here under
 * `environment: "node"` (no jsdom) via the same React-tree-serializer pattern
 * as slice 1 — we walk the rendered tree and assert on `data-slot` markers +
 * the handler props the component exposes (no React event simulation).
 *
 * Acceptance criteria pinned (#200):
 *   - AC1 « + Catégorie crée une catégorie vide en fin de liste, focus auto » →
 *     the footer button is rendered with a `data-slot="menu-category-add"`
 *     marker and an `onClick` that invokes `onCreate`. Focus is delegated to
 *     a `data-autofocus-pending` marker the page sets on the next created
 *     row (see `category-list-editor.tsx` for the contract).
 *   - AC2 « rename inline avec debounce, optimistic UI, rollback + toast »→
 *     each row exposes an editable input bound to a local draft, and a
 *     `onRename` callback fires after a debounce (the debounce mechanism is
 *     pinned by `use-debounced-callback.test.ts`). The local input value is
 *     the user's draft (optimistic), reverts to `category.name` on error.
 *   - AC3 « suppression avec confirmation, cascade backend » → each row
 *     exposes a delete button (`data-slot="menu-category-delete"`) and a
 *     confirmation dialog whose "Confirmer" action calls `onDelete`. Cascade
 *     is the backend's responsibility — not asserted from the front.
 *   - AC4 « pas de drag&drop ici (vient en F-MENU-03) » → asserts no
 *     `data-dnd-handle` marker, no draggable affordance in the rendered
 *     tree.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// React hooks shim — `CategoryRow` uses `useState` / `useEffect` for the
// local rename draft + the confirmation dialog open flag. Under
// `environment: "node"` (no React renderer), the real hooks throw « can't
// dispatch ». We replace them with closure-scoped stubs: `useState`
// returns the initial value + a no-op setter (we never trigger state
// transitions from a test — the assertions only walk the FIRST render);
// `useEffect` is a no-op (cleanup paths are exercised in
// `use-debounced-callback.test.ts`). This is the same shape as how
// `use-tenant-mutation.test.ts` shims `convex/react` for a node-env run.
// ---------------------------------------------------------------------------
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
    // F-MENU-03 (#206) — the editor uses `useMemo` to derive the displayed
    // ordered list (optimistic UI for drag&drop) + the id→doc lookup. Under
    // `environment: "node"` (no React renderer), the real `useMemo` throws
    // « can't read properties of null ». Stub it to call the factory.
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

// F-MENU-03 (#206) — dnd-kit primitives call React hooks internally
// (`useSyncExternalStore`, `useContext`, etc.) which all throw under
// `environment: "node"`. We replace the three load-bearing pieces with thin
// passthroughs so the editor renders to the React element tree we want to
// assert on (the actual drag-and-drop is exercised at e2e level — see the
// PR body « Tests E2E proposés »).
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

const { CategoryListEditor } = await import("./category-list-editor");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (mirror of menu-view.test.tsx — kept duplicated
// on purpose: the two test files are independent unit suites, no shared test
// utility lives under apps/admin/src/test/* yet).
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

const CATEGORIES: Category[] = [
  makeCategory({ name: "Entrées", order: 0 }),
  makeCategory({ name: "Plats", order: 1 }),
  makeCategory({ name: "Desserts", order: 2 }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CategoryListEditor — F-MENU-02 (#200)", () => {
  it("AC1 — renders a « + Catégorie » footer button with data-slot=menu-category-add", () => {
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const addButtons = findBySlot(tree, "menu-category-add");
    expect(addButtons).toHaveLength(1);
    expect(allText(addButtons[0])).toMatch(/cat[ée]gorie/i);
  });

  it("AC1 — the « + Catégorie » button onClick calls onCreate", () => {
    const onCreate = vi.fn();
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate,
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const addButton = findBySlot(tree, "menu-category-add")[0];
    expect(addButton).toBeDefined();
    const onClick = addButton.props["onClick"];
    expect(typeof onClick).toBe("function");
    (onClick as () => void)();
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("AC2 — renders one inline rename input per category, pre-filled with its name", () => {
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const inputs = findBySlot(tree, "menu-category-name-input");
    expect(inputs).toHaveLength(CATEGORIES.length);
    // The default value mirrors the category name (uncontrolled w/ defaultValue
    // OR controlled with value — both surface the value as a string prop).
    const values = inputs
      .map((i) => i.props["defaultValue"] ?? i.props["value"])
      .map((v) => (typeof v === "string" ? v : null))
      .filter((v): v is string => v !== null);
    expect(values).toEqual(["Entrées", "Plats", "Desserts"]);
  });

  it("AC3 — renders one delete button per category, data-slot=menu-category-delete", () => {
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const deleteButtons = findBySlot(tree, "menu-category-delete");
    expect(deleteButtons).toHaveLength(CATEGORIES.length);
    // The delete button carries an aria-label so screen-readers can target it
    // (no visible text — it's an icon button to keep rows compact).
    for (const btn of deleteButtons) {
      const aria = btn.props["aria-label"];
      expect(typeof aria).toBe("string");
      expect(aria as string).toMatch(/supprimer/i);
    }
  });

  it("AC3 — clicking delete does NOT call onDelete directly (confirmation gate)", () => {
    // The confirmation dialog is the load-bearing safety: a misclick MUST NOT
    // wipe a category and orphan its items. The button toggles the dialog
    // (component-local state); only the dialog's "Confirmer" action fires
    // `onDelete`. We assert here that the row button itself has NO direct
    // `onDelete` wiring (e.g. it doesn't pass `onClick={() => onDelete(id)}`).
    const onDelete = vi.fn();
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete,
      }),
    );
    const deleteButtons = findBySlot(tree, "menu-category-delete");
    expect(deleteButtons).toHaveLength(CATEGORIES.length);
    for (const btn of deleteButtons) {
      const onClick = btn.props["onClick"] as (() => void) | undefined;
      if (typeof onClick === "function") onClick();
    }
    // The direct row-button click MUST NOT have invoked onDelete — the
    // confirmation dialog is what does.
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("F-MENU-03 (#206) — exposes a drag handle per row when onReorder is wired (a11y keyboard sortable)", () => {
    // The drag handle is the load-bearing affordance for the « réordonnable au
    // clavier » a11y requirement (apps/admin = outil pro). It's a button-like
    // element with `data-slot="menu-category-drag-handle"` carrying an
    // aria-label that mentions « Réordonner » so screen readers announce it.
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onReorder: vi.fn(),
      }),
    );
    const handles = findBySlot(tree, "menu-category-drag-handle");
    expect(handles).toHaveLength(CATEGORIES.length);
    for (const h of handles) {
      const aria = h.props["aria-label"];
      expect(typeof aria).toBe("string");
      expect(aria as string).toMatch(/r[ée]ordonner/i);
    }
  });

  it("F-MENU-03 (#206) — no drag handle without an onReorder callback (read-only-ordering preserved)", () => {
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const handles = findBySlot(tree, "menu-category-drag-handle");
    expect(handles).toHaveLength(0);
  });

  it("renders ONE row per category, matched on data-slot=menu-category-row", () => {
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const rows = findBySlot(tree, "menu-category-row");
    expect(rows).toHaveLength(CATEGORIES.length);
  });

  it("rows are sorted by `order` regardless of input order (defensive resort, mirrors slice 1)", () => {
    const unordered: Category[] = [
      makeCategory({ name: "Desserts", order: 2 }),
      makeCategory({ name: "Entrées", order: 0 }),
      makeCategory({ name: "Plats", order: 1 }),
    ];
    const tree = serialize(
      CategoryListEditor({
        categories: unordered,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const inputs = findBySlot(tree, "menu-category-name-input");
    const names = inputs
      .map((i) => i.props["defaultValue"] ?? i.props["value"])
      .map((v) => (typeof v === "string" ? v : null))
      .filter((v): v is string => v !== null);
    expect(names).toEqual(["Entrées", "Plats", "Desserts"]);
  });

  it("each rename input is keyed to its category id so React doesn't recycle drafts across rows", () => {
    // If React recycles the input element between rows (no key, or key by
    // index), the user's in-flight rename on row 1 would visually attach to
    // row 0 after a delete or reorder. Pin the key contract via the input's
    // own data-slot suffix — each input carries a `data-category-id` matching
    // its category._id.
    const tree = serialize(
      CategoryListEditor({
        categories: CATEGORIES,
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const inputs = findBySlot(tree, "menu-category-name-input");
    const ids = inputs
      .map((i) => i.props["data-category-id"])
      .map((v) => (typeof v === "string" ? v : null))
      .filter((v): v is string => v !== null);
    expect(ids).toEqual(CATEGORIES.map((c) => c._id as unknown as string));
  });

  it("AC1/edge — empty list still renders the « + Catégorie » footer button (the only path to add one)", () => {
    const tree = serialize(
      CategoryListEditor({
        categories: [],
        onCreate: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    const addButtons = findBySlot(tree, "menu-category-add");
    expect(addButtons).toHaveLength(1);
    const rows = findBySlot(tree, "menu-category-row");
    expect(rows).toHaveLength(0);
  });

  // Mark `Id` import as used so the type-only fixture compiles in node env.
  void ({} as Id<"menuCategories">);
});
