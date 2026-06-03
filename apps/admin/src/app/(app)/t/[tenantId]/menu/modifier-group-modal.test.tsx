/**
 * F-MENU-08 (#242) — `ModifierGroupModal` test contract.
 *
 * The modal is the load-bearing CRUD surface for a REUSABLE modifier group
 * (CONTEXT kb-admin « Personnalisations » : a group created ONCE and attached
 * to N items, model Uber Eats — see `packages/backend/convex/lib/menu/modifiers.ts`
 * head comment). Same modal in create AND edit (DRY: same form, same validation,
 * same fields). Scope (#242) forbids inventing fields not on the schema
 * (`packages/backend/convex/table/modifierGroups.ts`): `name`, `minSelect`,
 * `maxSelect`, `options` (`{label, priceDelta}`). NO V1 discount (`priceDelta ≥ 0`)
 * NO "dish-as-option" V1 (issue body « pas de dish-as-option V1 »).
 *
 * Validation contract (LOCAL guard before mutation — mirror of
 * `assertGroupBounds` in `packages/backend/convex/lib/menu/modifiers.ts`):
 *   - `minSelect` must be an integer ≥ 0 (`minSelect = -1` rejected),
 *   - `maxSelect` must be an integer ≥ 1 (`maxSelect = 0` rejected — AC),
 *   - `maxSelect` must be ≥ max(1, minSelect) (an unsatisfiable mandatory
 *     group is rejected, #106-d),
 *   - every option `priceDelta` must be an integer ≥ 0 (centimes, no
 *     discount V1, AC).
 *
 * The local guard is what we pin here; the backend's `INVALID_MODIFIER` is
 * the safety net (any bypass surfaces as `toast.error(getConvexErrorMessage(...))`
 * at the page level — same discipline as F-MENU-02/05).
 *
 * EDIT mode — impact-aware delete (issue body « Avant édit/suppression,
 * afficher la liste des items qui réutilisent ce groupe »): the delete button
 * surfaces a confirmation `AlertDialog` listing the names of every item the
 * group is attached to (« sera détaché de N items »). The cascade — detach
 * the N-N edges WITHOUT removing the items — happens backend-side
 * (`removeGroup` invariant pinned by `packages/backend/convex/lib/menu/modifiers.test.ts`).
 *
 * Under `environment: "node"`: re-use the React hooks shim + the React-tree
 * serializer pattern of `item-modal.test.tsx`. We walk the FIRST render only —
 * state transitions are simulated by re-rendering with new props.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// React hooks shim (mirror of item-modal.test.tsx)
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

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactNode => children ?? null;
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogClose: passthrough,
    DialogTrigger: passthrough,
    DialogPortal: passthrough,
    DialogOverlay: passthrough,
  };
});

vi.mock("@/components/ui/alert-dialog", () => {
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactNode => children ?? null;
  return {
    AlertDialog: passthrough,
    AlertDialogContent: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogAction: ({
      children,
      onClick,
      ...rest
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      [k: string]: unknown;
    }) => {
      const props: Record<string, unknown> = {
        ...rest,
        onClick,
        "data-slot":
          (rest["data-slot"] as string | undefined) ?? "alert-dialog-action",
      };
      return {
        type: "button",
        props: { ...props, children: children ?? null },
        $$typeof: Symbol.for("react.element"),
      } as unknown as React.ReactNode;
    },
    AlertDialogCancel: passthrough,
  };
});

const { ModifierGroupModal } = await import("./modifier-group-modal");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (mirror of item-modal.test.tsx)
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
type Item = Doc<"menuItems">;

function makeGroup(partial: Partial<Group> & { name: string }): Group {
  return {
    _id: `mg_${partial.name}` as Group["_id"],
    _creationTime: 0,
    tenantId: "tenant_test" as Group["tenantId"],
    name: partial.name,
    minSelect: partial.minSelect ?? 1,
    maxSelect: partial.maxSelect ?? 1,
    options: partial.options ?? [
      { label: "Ketchup", priceDelta: 0 },
      { label: "Bacon", priceDelta: 150 },
    ],
    createdAt: 0,
  };
}

function makeItem(name: string): Item {
  return {
    _id: `item_${name}` as Item["_id"],
    _creationTime: 0,
    tenantId: "tenant_test" as Item["tenantId"],
    categoryId: "cat_x" as Item["categoryId"],
    name,
    description: "",
    basePrice: 1000,
    allergens: [],
    available: true,
    order: 0,
    createdAt: 0,
  };
}

const EXISTING_GROUP: Group = makeGroup({
  name: "Sauce",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { label: "Ketchup", priceDelta: 0 },
    { label: "Bacon", priceDelta: 150 },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ModifierGroupModal — F-MENU-08 (#242)", () => {
  describe("CREATE mode", () => {
    it("AC2 — surfaces a « Créer » primary action (no autosave in create mode — race-free)", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "create",
          open: true,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const submitButtons = findBySlot(tree, "menu-modifier-modal-submit");
      expect(submitButtons).toHaveLength(1);
      expect(allText(submitButtons[0])).toMatch(/cr[ée]er/i);
    });

    it("AC2 — does NOT surface a delete button (create has nothing to delete yet)", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "create",
          open: true,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      expect(findBySlot(tree, "menu-modifier-modal-delete")).toHaveLength(0);
    });

    it("AC2 — name + minSelect + maxSelect inputs are rendered (empty / sane defaults in create mode)", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "create",
          open: true,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      expect(findBySlot(tree, "menu-modifier-modal-name-input")).toHaveLength(
        1,
      );
      expect(
        findBySlot(tree, "menu-modifier-modal-min-select-input"),
      ).toHaveLength(1);
      expect(
        findBySlot(tree, "menu-modifier-modal-max-select-input"),
      ).toHaveLength(1);
    });

    it("AC2 — defaults are within bounds: minSelect=0, maxSelect=1 (the « optional, single-choice » group, schema-compatible)", () => {
      // The defaults pre-fill the form so a fresh-clicked « + Créer » with
      // ONLY a name typed would succeed against the schema:
      //   minSelect: 0 (optional), maxSelect: 1 (single-choice), options: [].
      // « 0 / 1 » is the only pair that satisfies both « ≥ 0 / ≥ 1 / max ≥ max(1,min) »
      // without forcing the gérant to type a number on first open.
      const tree = serialize(
        ModifierGroupModal({
          mode: "create",
          open: true,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const minInput = findBySlot(
        tree,
        "menu-modifier-modal-min-select-input",
      )[0];
      const maxInput = findBySlot(
        tree,
        "menu-modifier-modal-max-select-input",
      )[0];
      const minVal = (minInput.props["value"] ??
        minInput.props["defaultValue"]) as string | number | undefined;
      const maxVal = (maxInput.props["value"] ??
        maxInput.props["defaultValue"]) as string | number | undefined;
      expect(String(minVal)).toBe("0");
      expect(String(maxVal)).toBe("1");
    });

    it("AC2 — « Créer » is DISABLED when the name is empty (schema requires a string and there's no UI for « anonymous » groups)", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "create",
          open: true,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const submit = findBySlot(tree, "menu-modifier-modal-submit")[0];
      expect(submit.props["disabled"]).toBe(true);
    });
  });

  describe("EDIT mode", () => {
    it("AC1/AC2 — pre-fills every field from the group doc (name, minSelect, maxSelect, options)", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const name = findBySlot(tree, "menu-modifier-modal-name-input")[0];
      const minInput = findBySlot(
        tree,
        "menu-modifier-modal-min-select-input",
      )[0];
      const maxInput = findBySlot(
        tree,
        "menu-modifier-modal-max-select-input",
      )[0];
      const nameVal = (name.props["value"] ?? name.props["defaultValue"]) as
        | string
        | undefined;
      const minVal = (minInput.props["value"] ??
        minInput.props["defaultValue"]) as string | number | undefined;
      const maxVal = (maxInput.props["value"] ??
        maxInput.props["defaultValue"]) as string | number | undefined;
      expect(nameVal).toBe(EXISTING_GROUP.name);
      expect(String(minVal)).toBe(String(EXISTING_GROUP.minSelect));
      expect(String(maxVal)).toBe(String(EXISTING_GROUP.maxSelect));
    });

    it("AC3 — renders one option row per group option (labels + priceDelta pre-filled)", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const optionRows = findBySlot(tree, "menu-modifier-modal-option-row");
      expect(optionRows).toHaveLength(EXISTING_GROUP.options.length);
      // Each row exposes a label input + a price-delta input (the AC asks for
      // « ajout/édition/suppression d options » — pinning the read shape here).
      const labels = findBySlot(tree, "menu-modifier-modal-option-label-input");
      const prices = findBySlot(tree, "menu-modifier-modal-option-price-input");
      expect(labels).toHaveLength(EXISTING_GROUP.options.length);
      expect(prices).toHaveLength(EXISTING_GROUP.options.length);
      // Each row carries a « remove » affordance so the gérant can prune
      // options inside the form.
      const removeBtns = findBySlot(tree, "menu-modifier-modal-option-remove");
      expect(removeBtns).toHaveLength(EXISTING_GROUP.options.length);
    });

    it("AC3 — surfaces a « + Option » affordance to grow the options list", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      expect(findBySlot(tree, "menu-modifier-modal-option-add")).toHaveLength(
        1,
      );
    });

    it("AC4 — surfaces a delete button with data-slot=menu-modifier-modal-delete", () => {
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      expect(findBySlot(tree, "menu-modifier-modal-delete")).toHaveLength(1);
    });

    it("AC4 — clicking delete does NOT call onDelete directly (confirmation gate, mirrors item delete)", () => {
      // The confirmation dialog is the load-bearing safety: a misclick must
      // NOT detach this group from N items. The button toggles the dialog;
      // only the dialog's « Confirmer » action fires `onDelete`.
      const onDelete = vi.fn();
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete,
        }),
      );
      const delBtn = findBySlot(tree, "menu-modifier-modal-delete")[0];
      const onClick = delBtn.props["onClick"] as (() => void) | undefined;
      if (typeof onClick === "function") onClick();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("AC4 — the confirmation dialog « Confirmer » action calls onDelete with the group id", () => {
      const onDelete = vi.fn();
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete,
        }),
      );
      const confirm = findBySlot(tree, "menu-modifier-modal-delete-confirm")[0];
      expect(confirm).toBeDefined();
      const onClick = confirm.props["onClick"] as (() => void) | undefined;
      expect(typeof onClick).toBe("function");
      onClick?.();
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith(EXISTING_GROUP._id);
    });

    it("AC4 — when `impactItems` is provided, the confirmation surfaces every item name (« sera détaché de N items »)", () => {
      // Issue body: « Suppression : afficher d abord listGroupItems (impact)
      // puis confirmer ». The page resolves `listGroupItems` and passes the
      // list down; the modal surfaces every item name in the confirmation
      // body so the gérant knows what's about to be detached.
      const impactItems = [makeItem("Smash"), makeItem("Tacos")];
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          impactItems,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const impact = findBySlot(tree, "menu-modifier-modal-delete-impact")[0];
      expect(impact).toBeDefined();
      const text = allText(impact);
      expect(text).toMatch(/Smash/);
      expect(text).toMatch(/Tacos/);
    });

    it("AC1 — when `impactItems` is provided AND non-empty, the modal surfaces the impact panel (« réutilisé par N items »)", () => {
      // Issue body: « Avant édit/suppression, afficher la liste des items qui
      // réutilisent ce groupe ». The impact panel is rendered in the modal
      // body (not only inside the delete confirmation) so the gérant knows
      // an edit will reflect on N items BEFORE committing — that's load-bearing
      // safety for a reusable group.
      const impactItems = [makeItem("Smash"), makeItem("Tacos")];
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: EXISTING_GROUP,
          impactItems,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const panel = findBySlot(tree, "menu-modifier-modal-impact")[0];
      expect(panel).toBeDefined();
      const text = allText(panel);
      expect(text).toMatch(/Smash/);
      expect(text).toMatch(/Tacos/);
    });
  });

  describe("Validation — local guard (mirror of `assertGroupBounds`, INVALID_MODIFIER on the wire)", () => {
    it("AC5 — surfaces a visible bounds error when `maxSelect = 0` (must be ≥ 1)", () => {
      // The schema invariant: `maxSelect ≥ 1` (mandatory or optional, but
      // never zero — a zero-cap group can never let the user pick anything).
      // We pin the front guard: rendering the modal with a bogus group whose
      // `maxSelect = 0` surfaces the inline error AND the « Créer » /
      // « Sauvegarder » call paths refuse to fire (mirror of the price-error
      // pattern in `item-modal.tsx`).
      const badGroup = makeGroup({
        name: "Bug",
        minSelect: 0,
        maxSelect: 0,
      });
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: badGroup,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const errors = findBySlot(tree, "menu-modifier-modal-bounds-error");
      expect(errors.length).toBeGreaterThanOrEqual(1);
      // The user-facing message must hint at the « ≥ 1 / max ≥ min » rule —
      // the AC asks for « INVALID_MODIFIER » derived UX (no raw backend code).
      expect(allText(errors[0])).toMatch(
        /(≥|>=|au moins|maximum|max|minimum|min)/i,
      );
    });

    it("AC5 — surfaces a visible bounds error when `maxSelect < minSelect` (#106-d unsatisfiable mandatory)", () => {
      // The schema invariant: `maxSelect ≥ max(1, minSelect)` — a mandatory
      // group can never cap below its own minimum. Pinned here as the second
      // bounds-error path (the first one was the « max=0 » case).
      const badGroup = makeGroup({
        name: "Bug",
        minSelect: 3,
        maxSelect: 2,
      });
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: badGroup,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const errors = findBySlot(tree, "menu-modifier-modal-bounds-error");
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it("AC5 — surfaces a visible option price error when an option `priceDelta < 0` (no discount V1)", () => {
      // The schema invariant: every option `priceDelta ≥ 0` (« no discount
      // V1 », CONTEXT kb-admin « Personnalisations »). The front guard
      // surfaces an inline error tied to the offending option row.
      const badGroup = makeGroup({
        name: "Bug",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "Reduction", priceDelta: -50 }],
      });
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group: badGroup,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const optionErrors = findBySlot(
        tree,
        "menu-modifier-modal-option-price-error",
      );
      expect(optionErrors.length).toBeGreaterThanOrEqual(1);
      expect(allText(optionErrors[0])).toMatch(/(≥|>=|positif|0|n[ée]gatif)/i);
    });
  });

  describe("Euro formatting + 2 decimals (Alex E2E manuel — UX prix)", () => {
    it("displays a 150-cents priceDelta as « 1,50 » in the input (FR comma, 2 decimals)", () => {
      // Alex E2E manuel: « il faut que les prix apparaissent bien en Euros
      // avec option de gérer les centimes d'euros (2 décimales) ». Backend
      // stores cents (cf. `packages/backend/convex/table/modifierGroups.ts`
      // line 33 — `priceDelta: v.number()`, ≥ 0); the modal must surface
      // the human-readable euros with a comma separator and exactly two
      // fractional digits so the gérant can read AND edit centimes.
      const group = makeGroup({
        name: "Sauce",
        options: [
          { label: "Ketchup", priceDelta: 0 },
          { label: "Bacon", priceDelta: 150 },
        ],
      });
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
      const priceInputs = findBySlot(
        tree,
        "menu-modifier-modal-option-price-input",
      );
      expect(priceInputs).toHaveLength(2);
      // 0-cents row falls back to « 0,00 » (NEVER « 0 » alone — the gérant
      // must SEE the unit, same loud-zero discipline as `formatPriceCentimes`).
      const ketchupValue = (priceInputs[0].props["value"] ??
        priceInputs[0].props["defaultValue"]) as string | undefined;
      expect(ketchupValue).toBe("0,00");
      // 150 cents → « 1,50 » — pinned round-trip with `centimesToEuroInput`.
      const baconValue = (priceInputs[1].props["value"] ??
        priceInputs[1].props["defaultValue"]) as string | undefined;
      expect(baconValue).toBe("1,50");
    });

    it("submits priceDelta=50 when the user typed « 0,50 » (FR comma → centimes round-trip)", () => {
      // Reuses `parsePriceEuros` (single source of truth, mirror of
      // item-modal). The submit path reads `priceDelta` cached on the row,
      // refreshed on every keystroke that parses cleanly. Pinned with a
      // create-mode submit: an option pre-seeded with « 0,50 » (priceDelta 50)
      // must forward `priceDelta: 50` to `onCreate`.
      const onCreate = vi.fn();
      // We bypass the empty-name DISABLED guard by pinning the name; the
      // useState shim returns the initial value AS the « current » value, so
      // we have to render the FORM ALREADY populated. Easiest path: render
      // EDIT mode with a pre-existing group and assert the « Sauvegarder »
      // payload — same round-trip contract.
      const onUpdate = vi.fn();
      const group = makeGroup({
        name: "Sauce",
        options: [{ label: "Bacon", priceDelta: 50 }],
      });
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group,
          onOpenChange: vi.fn(),
          onCreate,
          onUpdate,
          onDelete: vi.fn(),
        }),
      );
      const submit = findBySlot(tree, "menu-modifier-modal-submit")[0];
      expect(submit.props["disabled"]).toBeFalsy();
      const onClick = submit.props["onClick"] as (() => void) | undefined;
      onClick?.();
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const [, payload] = onUpdate.mock.calls[0] as [
        unknown,
        { options: Array<{ priceDelta: number }> },
      ];
      expect(payload.options[0].priceDelta).toBe(50);
    });

    it("disables submit AND surfaces a price error when an option carries a negative value (« -5 »)", () => {
      // Mirror of the AC5 negative-priceDelta path, but pinned as a submit-
      // gate: an option with `priceDelta: -500` (= « -5,00 € ») surfaces the
      // inline error AND the « Sauvegarder » button stays disabled (the
      // backend INVALID_MODIFIER safety net would refuse anyway, but the
      // local guard saves a wasted round-trip).
      const onUpdate = vi.fn();
      const group = makeGroup({
        name: "Bug",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "Reduction", priceDelta: -500 }],
      });
      const tree = serialize(
        ModifierGroupModal({
          mode: "edit",
          open: true,
          group,
          onOpenChange: vi.fn(),
          onCreate: vi.fn(),
          onUpdate,
          onDelete: vi.fn(),
        }),
      );
      const errors = findBySlot(tree, "menu-modifier-modal-option-price-error");
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const submit = findBySlot(tree, "menu-modifier-modal-submit")[0];
      expect(submit.props["disabled"]).toBe(true);
      // Click-through must NOT fire onUpdate even if the button were enabled.
      const onClick = submit.props["onClick"] as (() => void) | undefined;
      onClick?.();
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  // Mark `Id` import as used so type-only fixtures compile.
  void ({} as Id<"modifierGroups">);
});
