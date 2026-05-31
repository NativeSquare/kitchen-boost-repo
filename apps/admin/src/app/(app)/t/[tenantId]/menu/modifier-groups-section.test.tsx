/**
 * F-MENU-08 (#242) — `ModifierGroupsSection` test contract.
 *
 * The section is the « Gérer les personnalisations » zone of the menu page
 * (issue body « accessible depuis (a) un lien/bouton dans une zone dédiée de
 * la page menu listant tous les groupes du tenant »). It is a presentational
 * shell that takes:
 *   - the list of REUSABLE modifier groups for the tenant (`listGroups`),
 *     bucketing the THREE async sentinel branches the rest of the menu page
 *     already pins (`undefined` → skeletons / `[]` → empty CTA / else → rows),
 *   - three callbacks (`onCreateGroup` / `onEditGroup` / `onDeleteGroup`) the
 *     page wires to the three `modifiers.*` tenantMutations + the modal-open
 *     state.
 *
 * Each row exposes:
 *   - the group `name` (Uber Eats-style header),
 *   - a one-line summary of the bounds (« choix unique » / « 1-3 obligatoires »
 *     / etc. — derived from `minSelect` / `maxSelect`),
 *   - the option count (« N options »),
 *   - an edit affordance (click-on-row OR explicit button) that calls
 *     `onEditGroup(group._id)`.
 *
 * Under `environment: "node"`: re-use the React hooks shim + the React-tree
 * serializer pattern of the other menu tests.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// React hooks shim
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
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

const { ModifierGroupsSection } = await import("./modifier-groups-section");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer
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
type Group = Doc<"modifierGroups">;

function makeGroup(partial: Partial<Group> & { name: string }): Group {
  return {
    _id: `mg_${partial.name}` as Group["_id"],
    _creationTime: 0,
    tenantId: "tenant_test" as Group["tenantId"],
    name: partial.name,
    minSelect: partial.minSelect ?? 1,
    maxSelect: partial.maxSelect ?? 1,
    options: partial.options ?? [{ label: "Ketchup", priceDelta: 0 }],
    createdAt: 0,
  };
}

const GROUPS: Group[] = [
  makeGroup({
    name: "Sauce",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { label: "Ketchup", priceDelta: 0 },
      { label: "Mayo", priceDelta: 0 },
    ],
  }),
  makeGroup({
    name: "Suppléments",
    minSelect: 0,
    maxSelect: 3,
    options: [
      { label: "Bacon", priceDelta: 150 },
      { label: "Cheddar", priceDelta: 100 },
      { label: "Œuf", priceDelta: 100 },
    ],
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ModifierGroupsSection — F-MENU-08 (#242)", () => {
  it("AC1 — section header surfaces the « Personnalisations » title", () => {
    const tree = serialize(
      ModifierGroupsSection({
        groups: GROUPS,
        onCreateGroup: vi.fn(),
        onEditGroup: vi.fn(),
        onDeleteGroup: vi.fn(),
      }),
    );
    const section = findBySlot(tree, "menu-modifier-groups-section")[0];
    expect(section).toBeDefined();
    expect(allText(section)).toMatch(/personnalisation/i);
  });

  it("AC1 — surfaces a « + Personnalisation » primary action (calls onCreateGroup with no args)", () => {
    const onCreateGroup = vi.fn();
    const tree = serialize(
      ModifierGroupsSection({
        groups: GROUPS,
        onCreateGroup,
        onEditGroup: vi.fn(),
        onDeleteGroup: vi.fn(),
      }),
    );
    const addBtn = findBySlot(tree, "menu-modifier-group-add")[0];
    expect(addBtn).toBeDefined();
    const onClick = addBtn.props["onClick"] as (() => void) | undefined;
    expect(typeof onClick).toBe("function");
    onClick?.();
    expect(onCreateGroup).toHaveBeenCalledTimes(1);
  });

  it("AC1 — loading branch (groups === undefined) surfaces skeletons (no blank flash)", () => {
    const tree = serialize(
      ModifierGroupsSection({
        groups: undefined,
        onCreateGroup: vi.fn(),
        onEditGroup: vi.fn(),
        onDeleteGroup: vi.fn(),
      }),
    );
    expect(
      findBySlot(tree, "menu-modifier-groups-skeleton").length,
    ).toBeGreaterThanOrEqual(1);
    // No row, no empty state when loading.
    expect(findBySlot(tree, "menu-modifier-group-row")).toHaveLength(0);
    expect(findBySlot(tree, "menu-modifier-groups-empty")).toHaveLength(0);
  });

  it("AC1 — empty branch (groups === []) surfaces a distinct empty state (NOT skeletons)", () => {
    const tree = serialize(
      ModifierGroupsSection({
        groups: [],
        onCreateGroup: vi.fn(),
        onEditGroup: vi.fn(),
        onDeleteGroup: vi.fn(),
      }),
    );
    expect(findBySlot(tree, "menu-modifier-groups-empty")).toHaveLength(1);
    expect(findBySlot(tree, "menu-modifier-groups-skeleton")).toHaveLength(0);
    expect(findBySlot(tree, "menu-modifier-group-row")).toHaveLength(0);
  });

  it("AC1 — populated branch renders one row per group (count + names)", () => {
    const tree = serialize(
      ModifierGroupsSection({
        groups: GROUPS,
        onCreateGroup: vi.fn(),
        onEditGroup: vi.fn(),
        onDeleteGroup: vi.fn(),
      }),
    );
    const rows = findBySlot(tree, "menu-modifier-group-row");
    expect(rows).toHaveLength(GROUPS.length);
    const text = allText(tree);
    for (const g of GROUPS) {
      expect(text).toContain(g.name);
    }
  });

  it("AC1 — each row surfaces the option count (« N options »)", () => {
    const tree = serialize(
      ModifierGroupsSection({
        groups: GROUPS,
        onCreateGroup: vi.fn(),
        onEditGroup: vi.fn(),
        onDeleteGroup: vi.fn(),
      }),
    );
    const rows = findBySlot(tree, "menu-modifier-group-row");
    expect(rows[0]).toBeDefined();
    expect(allText(rows[0])).toMatch(/2\s+options?/i);
    expect(allText(rows[1])).toMatch(/3\s+options?/i);
  });

  it("AC2 — clicking the row's edit affordance fires `onEditGroup(group._id)`", () => {
    const onEditGroup = vi.fn();
    const tree = serialize(
      ModifierGroupsSection({
        groups: GROUPS,
        onCreateGroup: vi.fn(),
        onEditGroup,
        onDeleteGroup: vi.fn(),
      }),
    );
    const editButtons = findBySlot(tree, "menu-modifier-group-edit");
    expect(editButtons).toHaveLength(GROUPS.length);
    const onClick = editButtons[0].props["onClick"] as (() => void) | undefined;
    expect(typeof onClick).toBe("function");
    onClick?.();
    expect(onEditGroup).toHaveBeenCalledTimes(1);
    expect(onEditGroup).toHaveBeenCalledWith(GROUPS[0]._id);
  });
});
