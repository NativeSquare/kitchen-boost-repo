/**
 * F-PRICING-2 (#245) — `RuleBuilderModal` test contract (CREATE only).
 *
 * Second tracer-bullet of F-PRICING (#146). Pins the load-bearing contract of
 * the rule builder modal:
 *
 *   - The condition picker is a CLOSED-list `<Select>` listing EXACTLY the 6 V1
 *     condition kinds (libellés FR from `labels.ts` — single source of truth).
 *   - The action picker is a CLOSED-list `<Select>` listing EXACTLY the 3 V1
 *     action kinds (libellés FR from `labels.ts`). `livraison_offerte_client` is
 *     ABSENT (Q35-Q1 — KB does not subsidise V1).
 *   - Selecting a condition kind renders ONLY the fields appropriate to that
 *     kind (switch by `kind`). Pinned for all 6 kinds.
 *   - Selecting an action kind renders ONLY the fields appropriate to that kind.
 *     Pinned for all 3 kinds.
 *   - « + Ajouter une condition » grows the conditions list; « Supprimer » per
 *     row shrinks it.
 *   - « Enregistrer » calls `onSubmit` with a typed payload (`conditions`,
 *     `action`) — the unit conversion (€ → centimes, % stays integer) happens
 *     INSIDE the modal so the page just forwards to `api.lib.pricing.rules.create`.
 *   - `submitError` prop (the page-derived `ConvexError.data.message` for
 *     `CONTRADICTORY_CONDITIONS`) surfaces in an inline error zone under the
 *     submit button. No toast (page-level discipline differs from F-MENU-05).
 *
 * NO drag-handle anywhere (priority is auto, ADR 0013). NO `evaluate` import.
 * Pinned MODULE-WIDE by `guardrails.test.ts` — these here are the local AC.
 *
 * Under `environment: "node"` (no jsdom, no Convex provider) — same React
 * hooks shim + tree serializer as `modifier-group-modal.test.tsx`.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// ---------------------------------------------------------------------------
// React hooks shim — first render only, no state-transition simulation.
// State changes are exercised by RE-RENDERING the component with new props
// or by calling the rendered handler and re-serialising a freshly-rendered
// tree (mock useState picks up the new "initial" because we re-mount).
//
// For tests that DO need to mutate state across calls (e.g. "selecting a
// kind switches the fields"), we use `setMockInitialState` to override the
// next useState initial value — same pattern other modals use here.
// ---------------------------------------------------------------------------
const mockStateOverrides = new Map<number, unknown>();
let stateCallCounter = 0;

function resetStateMock() {
  mockStateOverrides.clear();
  stateCallCounter = 0;
}

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const idx = stateCallCounter++;
      if (mockStateOverrides.has(idx)) {
        return [mockStateOverrides.get(idx) as T, () => {}];
      }
      const v =
        typeof initial === "function" ? (initial as () => T)() : initial;
      return [v, () => {}];
    },
    useEffect: () => {},
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

/**
 * Reset ONLY the useState call counter without clearing the overrides map.
 * Call this between two `serialize(RuleBuilderModal(...))` invocations
 * inside the same test so state[0] in the SECOND render reads from
 * `mockStateOverrides.get(0)` (not state[N] where N counted from the first
 * render). Equivalent to a fresh « mount » of the component.
 */
function resetCounterOnly() {
  stateCallCounter = 0;
}

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

const { RuleBuilderModal } = await import("./rule-builder-modal");
const { CONDITION_KIND_LABELS, ACTION_KIND_LABELS } = await import("./labels");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (mirror of modifier-group-modal.test.tsx).
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

// Minimal default props — every callback is a vi.fn() spy.
function defaultProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    submitError: null as string | null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("RuleBuilderModal — F-PRICING-2 (#245)", () => {
  describe("Condition picker (6 closed kinds)", () => {
    it("AC — lists EXACTLY the 6 FR labels, one for each backend condition kind", () => {
      resetStateMock();
      const tree = serialize(RuleBuilderModal(defaultProps()));
      // « + Ajouter une condition » → click handler grows the list.
      const addBtn = findBySlot(tree, "pricing-rule-builder-condition-add")[0];
      expect(addBtn, "the add-condition CTA must exist").toBeDefined();
      // Source-of-truth: the labels map. The test enumerates from the map so
      // a future drift on either side (schema kind added without label,
      // label added without kind) breaks here.
      // We assert the 6 FR labels appear as options of EVERY condition kind
      // <Select>. Conditions start with ZERO rows, so we need to render with
      // ONE pre-set row to inspect the picker options.
      mockStateOverrides.set(0, [
        { kind: "total_panier", operator: "gte", valueCents: 0 },
      ]);
      resetCounterOnly();
      const treeWithRow = serialize(RuleBuilderModal(defaultProps()));
      const options = findBySlot(
        treeWithRow,
        "pricing-rule-builder-condition-kind-option",
      );
      // 6 unique labels (one row × 6 options = 6 options at minimum).
      const labels = options.map((o) => allText(o).trim());
      for (const expected of Object.values(CONDITION_KIND_LABELS)) {
        expect(
          labels,
          `expected « ${expected} » to be one of the 6 condition options`,
        ).toContain(expected);
      }
      // EXACTLY 6 — no « champ libre » that would let the user type a kind.
      expect(new Set(labels).size).toBe(6);
    });

    it("AC — picking `total_panier` renders an operator (≥/≤) and a euros input", () => {
      resetStateMock();
      // Seed state[0] = conditions = one row with kind=total_panier.
      mockStateOverrides.set(0, [
        { kind: "total_panier", operator: "gte", valueCents: 2500 },
      ]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      // Per-kind fields scoped under a slot named after the kind.
      const fieldsRoot = findBySlot(
        tree,
        "pricing-rule-builder-condition-fields-total_panier",
      );
      expect(fieldsRoot).toHaveLength(1);
      // Operator picker exists (≥/≤). Pin via slot.
      const opSelect = findBySlot(
        tree,
        "pricing-rule-builder-condition-total_panier-operator",
      );
      expect(opSelect).toHaveLength(1);
      // Euros input exists.
      const eurosInput = findBySlot(
        tree,
        "pricing-rule-builder-condition-total_panier-euros",
      );
      expect(eurosInput).toHaveLength(1);
    });

    it("AC — picking `premiere_cmd_client` renders a toggle (oui/non), no operator", () => {
      resetStateMock();
      mockStateOverrides.set(0, [{ kind: "premiere_cmd_client", value: true }]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const fields = findBySlot(
        tree,
        "pricing-rule-builder-condition-fields-premiere_cmd_client",
      );
      expect(fields).toHaveLength(1);
      const toggle = findBySlot(
        tree,
        "pricing-rule-builder-condition-premiere_cmd_client-toggle",
      );
      expect(toggle).toHaveLength(1);
      // No operator picker leaks in for the boolean kind.
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-premiere_cmd_client-operator",
        ),
      ).toHaveLength(0);
    });

    it("AC — picking `nombre_cmds_client` renders an operator (≥/≤) and a count input", () => {
      resetStateMock();
      mockStateOverrides.set(0, [
        { kind: "nombre_cmds_client", operator: "gte", value: 3 },
      ]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-fields-nombre_cmds_client",
        ),
      ).toHaveLength(1);
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-nombre_cmds_client-operator",
        ),
      ).toHaveLength(1);
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-nombre_cmds_client-count",
        ),
      ).toHaveLength(1);
    });

    it("AC — picking `plage_horaire` renders start + end inputs (HH:MM)", () => {
      resetStateMock();
      mockStateOverrides.set(0, [
        { kind: "plage_horaire", start: "11:30", end: "14:00" },
      ]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-fields-plage_horaire"),
      ).toHaveLength(1);
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-plage_horaire-start"),
      ).toHaveLength(1);
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-plage_horaire-end"),
      ).toHaveLength(1);
    });

    it("AC — picking `jour_semaine` renders the 7 day toggles (LU..DI)", () => {
      resetStateMock();
      mockStateOverrides.set(0, [{ kind: "jour_semaine", days: ["LU", "MA"] }]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-fields-jour_semaine"),
      ).toHaveLength(1);
      // Exactly 7 day toggles — one per LU/MA/ME/JE/VE/SA/DI.
      const toggles = findBySlot(
        tree,
        "pricing-rule-builder-condition-jour_semaine-day",
      );
      expect(toggles).toHaveLength(7);
      // Each toggle exposes `data-day` so the test can confirm coverage.
      const days = toggles.map((t) => t.props["data-day"]).sort();
      expect(days).toEqual(["DI", "JE", "LU", "MA", "ME", "SA", "VE"]);
    });

    it("AC — picking `contient_item` renders a category input AND an itemId input (both optional)", () => {
      resetStateMock();
      mockStateOverrides.set(0, [
        { kind: "contient_item", category: "burger", itemId: undefined },
      ]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-fields-contient_item"),
      ).toHaveLength(1);
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-contient_item-category",
        ),
      ).toHaveLength(1);
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-contient_item-itemId"),
      ).toHaveLength(1);
    });
  });

  describe("Action picker (3 closed kinds, NO livraison_offerte_client)", () => {
    it("AC — lists EXACTLY the 3 FR labels, one for each backend action kind", () => {
      resetStateMock();
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const options = findBySlot(
        tree,
        "pricing-rule-builder-action-kind-option",
      );
      const labels = options.map((o) => allText(o).trim());
      for (const expected of Object.values(ACTION_KIND_LABELS)) {
        expect(
          labels,
          `expected « ${expected} » to be one of the 3 action options`,
        ).toContain(expected);
      }
      expect(new Set(labels).size).toBe(3);
    });

    it("AC — `livraison_offerte_client` is NEVER listed (KB does not subsidise V1, Q35-Q1)", () => {
      resetStateMock();
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const options = findBySlot(
        tree,
        "pricing-rule-builder-action-kind-option",
      );
      // Check both the option VALUE attribute and the visible label.
      for (const opt of options) {
        const value = opt.props["value"];
        const text = allText(opt).toLowerCase();
        expect(String(value)).not.toBe("livraison_offerte_client");
        expect(text).not.toMatch(/offerte\s+par\s+kitchen|offerte.*client/i);
      }
      // And no slot anywhere named after that banned kind.
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-action-fields-livraison_offerte_client",
        ),
      ).toHaveLength(0);
    });

    it("AC — picking `livraison_offerte_resto` renders no extra field", () => {
      resetStateMock();
      mockStateOverrides.set(0, []); // conditions
      mockStateOverrides.set(1, { kind: "livraison_offerte_resto" }); // action
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const fields = findBySlot(
        tree,
        "pricing-rule-builder-action-fields-livraison_offerte_resto",
      );
      // Slot exists (so the switch dispatched) but it has no input siblings.
      expect(fields).toHaveLength(1);
      const inputs = findBySlot(
        tree,
        "pricing-rule-builder-action-livraison_offerte_resto-value",
      );
      expect(inputs).toHaveLength(0);
    });

    it("AC — picking `frais_livraison_part_resto_fixe` renders a euros input", () => {
      resetStateMock();
      mockStateOverrides.set(0, []);
      mockStateOverrides.set(1, {
        kind: "frais_livraison_part_resto_fixe",
        valueCents: 250,
      });
      const tree = serialize(RuleBuilderModal(defaultProps()));
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-action-fields-frais_livraison_part_resto_fixe",
        ),
      ).toHaveLength(1);
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-action-frais_livraison_part_resto_fixe-euros",
        ),
      ).toHaveLength(1);
    });

    it("AC — picking `frais_livraison_part_resto_pourcentage_panier` renders a percent input", () => {
      resetStateMock();
      mockStateOverrides.set(0, []);
      mockStateOverrides.set(1, {
        kind: "frais_livraison_part_resto_pourcentage_panier",
        percent: 30,
      });
      const tree = serialize(RuleBuilderModal(defaultProps()));
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-action-fields-frais_livraison_part_resto_pourcentage_panier",
        ),
      ).toHaveLength(1);
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-action-frais_livraison_part_resto_pourcentage_panier-percent",
        ),
      ).toHaveLength(1);
    });
  });

  describe("Conditions list — add / remove rows", () => {
    it("AC — empty by default; « + Ajouter une condition » is rendered", () => {
      resetStateMock();
      const tree = serialize(RuleBuilderModal(defaultProps()));
      // No condition row at first render (conditions = []).
      const rows = findBySlot(tree, "pricing-rule-builder-condition-row");
      expect(rows).toHaveLength(0);
      const addBtn = findBySlot(tree, "pricing-rule-builder-condition-add")[0];
      expect(addBtn).toBeDefined();
      // The CTA is a button with a useful onClick (not a no-op).
      expect(typeof addBtn.props["onClick"]).toBe("function");
    });

    it("AC — every condition row exposes a « Supprimer » affordance", () => {
      resetStateMock();
      mockStateOverrides.set(0, [
        { kind: "total_panier", operator: "gte", valueCents: 0 },
        { kind: "premiere_cmd_client", value: true },
      ]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const rows = findBySlot(tree, "pricing-rule-builder-condition-row");
      expect(rows).toHaveLength(2);
      const removes = findBySlot(tree, "pricing-rule-builder-condition-remove");
      expect(removes).toHaveLength(2);
    });

    it("AC — visual rappel « Toutes les conditions doivent être vraies » (AND, V1 only)", () => {
      resetStateMock();
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const text = allText(tree);
      expect(text).toMatch(/Toutes les conditions doivent être vraies/i);
      // No OR-toggle (V1 is strictly AND — explicit ban).
      expect(text).not.toMatch(/\bOU\b/);
    });
  });

  describe("Submit + error surface", () => {
    it("AC — clicking « Enregistrer » with action=livraison_offerte_resto and ONE total_panier condition fires onSubmit with the typed payload (€ → centimes)", () => {
      resetStateMock();
      // conditions = [{ total_panier, gte, 2500 cents }] — UI shows « 25 »
      mockStateOverrides.set(0, [
        { kind: "total_panier", operator: "gte", valueCents: 2500 },
      ]);
      mockStateOverrides.set(1, { kind: "livraison_offerte_resto" });
      const onSubmit = vi.fn();
      const tree = serialize(RuleBuilderModal({ ...defaultProps(), onSubmit }));
      const submit = findBySlot(tree, "pricing-rule-builder-submit")[0];
      expect(submit).toBeDefined();
      const handler = submit.props["onClick"] as undefined | (() => void);
      expect(typeof handler).toBe("function");
      handler?.();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        conditions: [
          { kind: "total_panier", operator: "gte", valueCents: 2500 },
        ],
        action: { kind: "livraison_offerte_resto" },
      });
    });

    it("AC — `submitError` prop surfaces as inline error text under the submit button (FR, no toast)", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          submitError:
            "Conditions contradictoires sur total_panier : minimum (5000) supérieur au maximum (3000).",
        }),
      );
      const errorZone = findBySlot(
        tree,
        "pricing-rule-builder-submit-error",
      )[0];
      expect(errorZone, "the inline error slot must be rendered").toBeDefined();
      expect(allText(errorZone)).toMatch(
        /Conditions contradictoires sur total_panier/i,
      );
    });

    it("AC — when `submitError` is null, the inline error slot is NOT rendered (no empty zone)", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({ ...defaultProps(), submitError: null }),
      );
      expect(
        findBySlot(tree, "pricing-rule-builder-submit-error"),
      ).toHaveLength(0);
    });
  });

  describe("F-PRICING-3 (#248) — edit mode (existingRule pre-fill + update)", () => {
    // The builder is REUSED for edit by passing the persisted rule via the
    // `existingRule` prop. The `useState` initializer hydrates from it (the
    // test's `useState` mock honours the function-initializer branch when no
    // override is set — see top of file). Cents/percent stay in their schema
    // units inside state; the per-kind input converts to UI representation at
    // render time (centsToEuroDisplay / String(percent)). What we pin here:
    //   - the modal title flips to « Modifier la règle » in edit mode,
    //   - the conditions list reflects the persisted shape (1 row per
    //     persisted condition, EACH with the right `data-slot` fields-for-kind
    //     and the persisted operator/value),
    //   - the action picker reflects the persisted kind and renders the
    //     matching per-kind field,
    //   - clicking « Enregistrer » forwards the SAME conditions+action shape
    //     the page will hand to `api.lib.pricing.rules.update`.
    // The page wires `existingRule` and decides update-vs-create — but the
    // modal is one component, no duplication (issue body « Pas de duplication
    // de composant »).

    /** Minimal fixture: a persisted rule with 2 conditions and 1 fixed-€ action. */
    function makeExistingRule() {
      return {
        _id: "rule_to_edit" as unknown as import("@packages/backend/convex/_generated/dataModel").Id<"pricingRules">,
        _creationTime: 0,
        tenantId:
          "tenant_test" as unknown as import("@packages/backend/convex/_generated/dataModel").Id<"tenants">,
        conditions: [
          {
            kind: "total_panier" as const,
            operator: "gte" as const,
            valueCents: 2500,
          },
          { kind: "premiere_cmd_client" as const, value: true },
        ],
        action: {
          kind: "frais_livraison_part_resto_fixe" as const,
          valueCents: 250,
        },
        active: true,
        createdAt: 0,
        updatedAt: 0,
      };
    }

    it("AC — when `existingRule` is provided, title becomes « Modifier la règle »", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: makeExistingRule(),
        }),
      );
      const text = allText(tree);
      expect(text).toMatch(/Modifier la règle/i);
      // Sanity: the create-mode title MUST NOT also appear in the same render
      // (the modal is one or the other — not both).
      expect(text).not.toMatch(/Nouvelle règle de pricing/i);
    });

    it("AC — without `existingRule`, the create-mode title « Nouvelle règle de pricing » still renders (backward compat with F-PRICING-2)", () => {
      resetStateMock();
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const text = allText(tree);
      expect(text).toMatch(/Nouvelle règle de pricing/i);
    });

    it("AC — `existingRule` with 2 conditions hydrates 2 rows, each with the right per-kind fields", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: makeExistingRule(),
        }),
      );
      // 2 persisted conditions → 2 rendered rows.
      const rows = findBySlot(tree, "pricing-rule-builder-condition-row");
      expect(rows).toHaveLength(2);
      // First row was `total_panier` → operator picker + euros input slots are present.
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-fields-total_panier"),
      ).toHaveLength(1);
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-total_panier-operator",
        ),
      ).toHaveLength(1);
      expect(
        findBySlot(tree, "pricing-rule-builder-condition-total_panier-euros"),
      ).toHaveLength(1);
      // Second row was `premiere_cmd_client` → toggle slot is present.
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-fields-premiere_cmd_client",
        ),
      ).toHaveLength(1);
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-condition-premiere_cmd_client-toggle",
        ),
      ).toHaveLength(1);
    });

    it("AC — `existingRule` with `total_panier valueCents=2500` pre-fills the euros input with « 25 » (cents → € for UI)", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: makeExistingRule(),
        }),
      );
      const eurosInput = findBySlot(
        tree,
        "pricing-rule-builder-condition-total_panier-euros",
      )[0];
      expect(eurosInput).toBeDefined();
      // The input's `value` prop is the FR-formatted euros (2500 cents → "25").
      // Pinned via `value` prop (the input is a controlled React `<Input>`).
      expect(String(eurosInput.props["value"])).toBe("25");
    });

    it("AC — `existingRule` with action `frais_livraison_part_resto_fixe valueCents=250` pre-fills euros input with « 2,50 » (cents → €,UI)", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: makeExistingRule(),
        }),
      );
      // Action picker reflects the persisted kind.
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-action-fields-frais_livraison_part_resto_fixe",
        ),
      ).toHaveLength(1);
      const eurosInput = findBySlot(
        tree,
        "pricing-rule-builder-action-frais_livraison_part_resto_fixe-euros",
      )[0];
      expect(eurosInput).toBeDefined();
      // 250 cents → « 2,50 » FR display (centsToEuroDisplay uses comma).
      expect(String(eurosInput.props["value"])).toBe("2,50");
    });

    it("AC — `existingRule` with action `frais_livraison_part_resto_pourcentage_panier percent=30` pre-fills the percent input with « 30 »", () => {
      resetStateMock();
      const existing = makeExistingRule();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: {
            ...existing,
            action: {
              kind: "frais_livraison_part_resto_pourcentage_panier",
              percent: 30,
            },
          },
        }),
      );
      expect(
        findBySlot(
          tree,
          "pricing-rule-builder-action-fields-frais_livraison_part_resto_pourcentage_panier",
        ),
      ).toHaveLength(1);
      const percentInput = findBySlot(
        tree,
        "pricing-rule-builder-action-frais_livraison_part_resto_pourcentage_panier-percent",
      )[0];
      expect(percentInput).toBeDefined();
      expect(String(percentInput.props["value"])).toBe("30");
    });

    it("AC — `existingRule` pre-fills the action select with the persisted action kind", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: makeExistingRule(),
        }),
      );
      const actionSelect = findBySlot(
        tree,
        "pricing-rule-builder-action-kind",
      )[0];
      expect(actionSelect).toBeDefined();
      // The select's controlled `value` prop is the persisted kind literal.
      expect(actionSelect.props["value"]).toBe(
        "frais_livraison_part_resto_fixe",
      );
    });

    it("AC — clicking « Enregistrer » in edit mode forwards the unchanged persisted shape to onSubmit (cents stay cents, percent stays percent)", () => {
      resetStateMock();
      const existing = makeExistingRule();
      const onSubmit = vi.fn();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          onSubmit,
          existingRule: existing,
        }),
      );
      const submit = findBySlot(tree, "pricing-rule-builder-submit")[0];
      expect(submit).toBeDefined();
      const handler = submit.props["onClick"] as undefined | (() => void);
      expect(typeof handler).toBe("function");
      handler?.();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      // Payload mirrors the persisted rule's conditions + action — the page
      // adds `ruleId` from `existingRule._id` before calling `update`.
      expect(onSubmit).toHaveBeenCalledWith({
        conditions: existing.conditions,
        action: existing.action,
      });
    });

    it("AC — in edit mode the submit button label flips to « Enregistrer les modifications »", () => {
      // Distinguishes the two modes visibly so the gérant knows what they
      // are doing. The page-level mutation choice (create vs update) is the
      // load-bearing branch — this is the visible UX echo.
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: makeExistingRule(),
        }),
      );
      const submit = findBySlot(tree, "pricing-rule-builder-submit")[0];
      expect(submit).toBeDefined();
      expect(allText(submit)).toMatch(/Enregistrer les modifications/i);
    });

    it("AC — create mode keeps the « Enregistrer » label (no « modifications » leak)", () => {
      resetStateMock();
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const submit = findBySlot(tree, "pricing-rule-builder-submit")[0];
      expect(submit).toBeDefined();
      const txt = allText(submit);
      expect(txt).toMatch(/Enregistrer/);
      expect(txt).not.toMatch(/modifications/i);
    });

    it("AC — `submitError` prop also surfaces inline in edit mode (same CONTRADICTORY_CONDITIONS UX as create)", () => {
      resetStateMock();
      const tree = serialize(
        RuleBuilderModal({
          ...defaultProps(),
          existingRule: makeExistingRule(),
          submitError:
            "Conditions contradictoires sur total_panier : minimum (5000) supérieur au maximum (3000).",
        }),
      );
      const errorZone = findBySlot(
        tree,
        "pricing-rule-builder-submit-error",
      )[0];
      expect(errorZone).toBeDefined();
      expect(allText(errorZone)).toMatch(
        /Conditions contradictoires sur total_panier/i,
      );
    });
  });

  describe("Guardrails — closed list, no `evaluate`, no drag", () => {
    it("GUARDRAIL — no `draggable=true` element anywhere", () => {
      resetStateMock();
      mockStateOverrides.set(0, [
        { kind: "total_panier", operator: "gte", valueCents: 0 },
      ]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      const draggables = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return (
          n.props["draggable"] === true ||
          n.props["draggable"] === "true" ||
          n.props["draggable"] === ""
        );
      });
      expect(draggables).toHaveLength(0);
    });

    it("GUARDRAIL — the condition kind picker has NO free-text input that would let the user type an arbitrary kind", () => {
      resetStateMock();
      mockStateOverrides.set(0, [
        { kind: "total_panier", operator: "gte", valueCents: 0 },
      ]);
      const tree = serialize(RuleBuilderModal(defaultProps()));
      // The picker is a <select> or <option>-bearing tree, never an <input
      // type="text"> named/labelled « kind ».
      const inputs = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        if (typeof n.type !== "string") return false;
        if (n.type.toLowerCase() !== "input") return false;
        const name = n.props["name"];
        return name === "kind" || name === "conditionKind";
      });
      expect(inputs).toHaveLength(0);
    });
  });
});
