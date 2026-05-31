/**
 * F-CONTRATS slice 3/4 (#174) — `GenerateContractModal` test matrix.
 *
 * Pure presentational modal (Dialog) — the parent wires Convex
 * (`useMutation(api.lib.admin.contracts.generateContract)`) and forwards
 * (`prospect`, `isSubmitting`, `submitError`, `onSubmit(prestation)`,
 * `onOpenChange`, `open`). Same lean-node test pattern as
 * `step1-provisioning-form.test.tsx` / `contracts-block.test.tsx` /
 * `contract-iframe.test.tsx`: handroll a React-tree serializer, shim
 * `useState`/`useEffect`/`useMemo` so the first-render branches pin
 * cleanly under `environment: "node"`.
 *
 * Acceptance criteria covered (issue #174):
 *   - Modal contient un picker prestation A / B / A&B (radios).
 *   - Récap des 5 champs juridiques pré-remplis depuis le prospect.
 *   - Champs manquants → affichés en rouge + submit désactivé + message
 *     d'aide « Complète la fiche prospect avant de générer un contrat ».
 *   - Submit appelle `onSubmit(prestation)` (le parent wrappe la mutation).
 *   - Loading state pendant l'appel (libellé « Génération… » + disabled).
 *   - Tests composant picker : sélection met à jour l'état, validation
 *     appelle l'handler avec le bon payload.
 *   - Aucun bouton hors-V1 (« Envoyer Odoo », « Rafraîchir statut »,
 *     « Marquer signé »).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// React hooks shim — mirror of `step1-provisioning-form.test.tsx`. Walks the
// FIRST render only. `useState` returns the initial value + a setter that
// updates a shared map keyed by call order, so a test can call the captured
// setter and re-render to assert the post-update tree. To keep things tiny
// we use a much simpler model: `useState` returns initial + a no-op setter
// for the « initial render » assertions, AND we expose a helper to override
// the prestation state via a `prestationOverride` test-only prop on the
// modal. The component does NOT define such a prop in production code; we
// emulate the post-click state by re-rendering with the next initial value
// (the canonical pattern used by step1-provisioning-form.test.tsx).
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

const { GenerateContractModal } = await import("./generate-contract-modal");
type GenerateContractModalProps =
  import("./generate-contract-modal").GenerateContractModalProps;

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as step1-provisioning-form.test.tsx /
// contracts-block.test.tsx.
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
  if (typeof t === "object" && t !== null) {
    const obj = t as { displayName?: string; render?: { name?: string } };
    return obj.displayName ?? obj.render?.name ?? "ForwardRef";
  }
  return String(t);
}

function unwrap(type: unknown): { fn: (props: unknown) => ReactNode } | null {
  if (typeof type === "function") {
    return { fn: type as (p: unknown) => ReactNode };
  }
  if (typeof type === "object" && type !== null) {
    const obj = type as {
      render?: (props: unknown, ref: unknown) => ReactNode;
    };
    if (typeof obj.render === "function") {
      const render = obj.render;
      return { fn: (props) => render(props, null) };
    }
    const memo = type as { type?: unknown };
    if (memo.type !== undefined) {
      return unwrap(memo.type);
    }
  }
  return null;
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
    const unwrapped = unwrap(node.type);
    if (unwrapped !== null) {
      try {
        return serialize(unwrapped.fn(node.props));
      } catch {
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

function findAllByType(n: SerializedNode, type: string): SerializedNode[] {
  return flatten(n).filter(
    (
      x,
    ): x is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    } => x !== null && "type" in x && x.type === type,
  );
}

type ElementNode = {
  type: string;
  props: Record<string, unknown>;
  children: SerializedNode[];
};

function findAllBySlot(n: SerializedNode, slot: string): ElementNode[] {
  return flatten(n).filter(
    (x): x is ElementNode =>
      x !== null &&
      "type" in x &&
      (x.props as Record<string, unknown>)["data-slot"] === slot,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

function makeProspect(
  overrides: Partial<Doc<"prospects">> = {},
): Doc<"prospects"> {
  return {
    _id: PROSPECT_ID,
    _creationTime: 1_700_000_000_000,
    name: "Buns and Bao",
    phone: "0612345678",
    phase: "acquisition",
    source: "cold_call",
    siret: "98765432100012",
    address: "12 rue de la Paix, 91000 Évry",
    contactName: "Khan Diallo",
    email: "khan@bunsandbao.fr",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<GenerateContractModalProps> = {},
): GenerateContractModalProps {
  return {
    open: true,
    onOpenChange: () => {},
    prospect: makeProspect(),
    isSubmitting: false,
    submitError: null,
    onSubmit: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GenerateContractModal — F-CONTRATS slice 3/4 (#174)", () => {
  it("AC — renders a Dialog with a recognisable « Générer un contrat » title", () => {
    const tree = serialize(GenerateContractModal(baseProps()));
    const text = allText(tree);
    expect(text).toMatch(/G[ée]n[ée]rer.*contrat/i);
  });

  it("AC — renders 3 radios for the prestation picker (A / B / A&B), one per canonical value", () => {
    const tree = serialize(GenerateContractModal(baseProps()));
    // The radios are radix `RadioGroupItem`s, each carrying a `value` prop.
    // The unwrapped tree surfaces a button with `data-slot="radio-group-item"`.
    const radios = findAllBySlot(tree, "radio-group-item");
    expect(radios.length).toBe(3);
    const values = radios.map((r) => r.props.value as string).sort();
    expect(values).toEqual(["A", "A_AND_B", "B"]);
  });

  it("AC — surfaces a recap row for each of the 5 juridical fields (raison sociale, SIRET, adresse, email, représentant)", () => {
    const tree = serialize(GenerateContractModal(baseProps()));
    const rows = findAllBySlot(tree, "juridical-field-row");
    expect(rows.length).toBe(5);
    const text = allText(tree);
    expect(text).toMatch(/Raison sociale/i);
    expect(text).toMatch(/SIRET/i);
    expect(text).toMatch(/Adresse/i);
    expect(text).toMatch(/Email/i);
    expect(text).toMatch(/Repr[ée]sentant/i);
    // Each pre-fill value from the fixture must surface.
    expect(text).toMatch(/Buns and Bao/);
    expect(text).toMatch(/98765432100012/);
    expect(text).toMatch(/12 rue de la Paix/);
    expect(text).toMatch(/khan@bunsandbao\.fr/);
    expect(text).toMatch(/Khan Diallo/);
  });

  it('AC — every juridical-field row carries `data-missing="false"` when the prospect is fully filled (no red flag)', () => {
    const tree = serialize(GenerateContractModal(baseProps()));
    const rows = findAllBySlot(tree, "juridical-field-row");
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.props["data-missing"]).toBe("false");
    }
  });

  it('AC — a missing juridical field is flagged `data-missing="true"` and the submit is DISABLED with the help message', () => {
    const tree = serialize(
      GenerateContractModal(
        baseProps({
          prospect: makeProspect({ siret: undefined, email: undefined }),
        }),
      ),
    );
    // The 2 missing rows are flagged.
    const rows = findAllBySlot(tree, "juridical-field-row");
    const missing = rows.filter((r) => r.props["data-missing"] === "true");
    expect(missing.length).toBe(2);
    // Help message MUST surface verbatim per the issue spec.
    const text = allText(tree);
    expect(text).toMatch(/Compl[èe]te la fiche prospect/i);
    // Submit button MUST be disabled.
    const submit = findAllBySlot(tree, "generate-contract-submit");
    expect(submit.length).toBe(1);
    expect(submit[0]!.props.disabled).toBe(true);
  });

  it("AC — submit is ENABLED when every juridical field is present + a prestation is selected (default A)", () => {
    const tree = serialize(GenerateContractModal(baseProps()));
    const submit = findAllBySlot(tree, "generate-contract-submit");
    expect(submit.length).toBe(1);
    expect(submit[0]!.props.disabled).toBe(false);
  });

  it("AC — `isSubmitting` disables the submit button + surfaces a loading label", () => {
    const tree = serialize(
      GenerateContractModal(baseProps({ isSubmitting: true })),
    );
    const submit = findAllBySlot(tree, "generate-contract-submit");
    expect(submit.length).toBe(1);
    expect(submit[0]!.props.disabled).toBe(true);
    const text = allText(tree);
    expect(text).toMatch(/G[ée]n[ée]ration…|G[ée]n[ée]ration\.{3}/);
  });

  it("AC — clicking submit fires `onSubmit(prestation)` with the currently selected prestation (default A)", () => {
    const onSubmit = vi.fn();
    const tree = serialize(GenerateContractModal(baseProps({ onSubmit })));
    const submit = findAllBySlot(tree, "generate-contract-submit")[0];
    if (submit === undefined) throw new Error("expected submit");
    const handler = submit.props.onClick as (() => void) | undefined;
    expect(typeof handler).toBe("function");
    if (handler === undefined) throw new Error("expected onClick");
    handler();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("A");
  });

  it("AC — clicking submit while any juridical field is missing does NOT fire `onSubmit` (defensive — the disabled state is the gate)", () => {
    const onSubmit = vi.fn();
    const tree = serialize(
      GenerateContractModal(
        baseProps({
          prospect: makeProspect({ siret: undefined }),
          onSubmit,
        }),
      ),
    );
    const submit = findAllBySlot(tree, "generate-contract-submit")[0];
    if (submit === undefined) throw new Error("expected submit");
    const handler = submit.props.onClick as (() => void) | undefined;
    expect(typeof handler).toBe("function");
    if (handler === undefined) throw new Error("expected onClick");
    handler();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("AC negative test — never renders any V2 action button (« Envoyer Odoo », « Rafraîchir statut », « Marquer signé »)", () => {
    const tree = serialize(GenerateContractModal(baseProps()));
    const text = allText(tree);
    expect(text).not.toMatch(/Envoyer.*Odoo/i);
    expect(text).not.toMatch(/Rafra[iî]chir/i);
    expect(text).not.toMatch(/Marquer sign[ée]/i);
  });

  describe("picker prestation — selection updates the submitted value", () => {
    // Walk through state-update edges via the `useState` shim. We replace it
    // per test to return a frozen value for the prestation state, then assert
    // that the submit handler forwards that value to `onSubmit`. Same pattern
    // as `step1-provisioning-form.test.tsx`'s state-edge coverage.
    let originalReact: typeof import("react");

    beforeEach(async () => {
      originalReact = await vi.importActual<typeof import("react")>("react");
    });

    afterEach(() => {
      // The module-level mock is reinstated automatically; nothing to undo.
      void originalReact;
    });

    it('submit fires `onSubmit("B")` when the prestation state is `B`', async () => {
      vi.doMock("react", async () => {
        const actual = await vi.importActual<typeof import("react")>("react");
        return {
          ...actual,
          useState: <T,>(initial: T | (() => T)) => {
            const v =
              typeof initial === "function" ? (initial as () => T)() : initial;
            // The modal's only `useState` is the prestation; override to "B".
            const isPrestation = v === "A" || v === "B" || v === "A_AND_B";
            return [isPrestation ? "B" : v, () => {}];
          },
          useEffect: () => {},
          useMemo: <T,>(factory: () => T) => factory(),
        };
      });
      vi.resetModules();
      const { GenerateContractModal: ModalB } =
        await import("./generate-contract-modal");
      const onSubmit = vi.fn();
      const tree = serialize(ModalB(baseProps({ onSubmit })));
      const submit = findAllBySlot(tree, "generate-contract-submit")[0];
      if (submit === undefined) throw new Error("expected submit");
      const handler = submit.props.onClick as (() => void) | undefined;
      if (handler === undefined) throw new Error("expected onClick");
      handler();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith("B");
      vi.doUnmock("react");
      vi.resetModules();
    });

    it('submit fires `onSubmit("A_AND_B")` when the prestation state is `A_AND_B`', async () => {
      vi.doMock("react", async () => {
        const actual = await vi.importActual<typeof import("react")>("react");
        return {
          ...actual,
          useState: <T,>(initial: T | (() => T)) => {
            const v =
              typeof initial === "function" ? (initial as () => T)() : initial;
            const isPrestation = v === "A" || v === "B" || v === "A_AND_B";
            return [isPrestation ? "A_AND_B" : v, () => {}];
          },
          useEffect: () => {},
          useMemo: <T,>(factory: () => T) => factory(),
        };
      });
      vi.resetModules();
      const { GenerateContractModal: ModalAB } =
        await import("./generate-contract-modal");
      const onSubmit = vi.fn();
      const tree = serialize(ModalAB(baseProps({ onSubmit })));
      const submit = findAllBySlot(tree, "generate-contract-submit")[0];
      if (submit === undefined) throw new Error("expected submit");
      const handler = submit.props.onClick as (() => void) | undefined;
      if (handler === undefined) throw new Error("expected onClick");
      handler();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith("A_AND_B");
      vi.doUnmock("react");
      vi.resetModules();
    });
  });
});
