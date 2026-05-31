/**
 * F-PARAMETRES-04 (#234) — `ModesEditor`, the section éditeur for « Modes
 * acceptés » (delivery + click & collect) on the tenant Paramètres page.
 *
 * Public contract (frozen by the issue body):
 *   {
 *     value: { delivery?: boolean, clickAndCollect?: boolean },
 *     onSave: (patch: { acceptedModes: { delivery: boolean, clickAndCollect: boolean } }) => Promise<void>,
 *   }
 *
 * Pinned here:
 *   - Stand-alone reusable module — no coupling to tenant context / URL /
 *     backend api (same discipline as branding-editor + coordonnees-editor).
 *   - Owns its OWN `useForm` (user story 9 — save isolé : an error on another
 *     section can't blow away the user's input here).
 *   - Two independent `Switch` toggles (delivery + click & collect).
 *   - GUARD MÉTIER FRONT (user story 5, AC clé) : il est IMPOSSIBLE de
 *     désactiver les deux modes simultanément. Si l'utilisateur tente de
 *     désactiver le dernier mode actif, le toggle est BLOQUÉ et un message
 *     inline explique « Au moins un mode doit rester actif ». L'autre toggle
 *     reste activable.
 *   - Save flow → mutation invoked with `{ acceptedModes: { delivery,
 *     clickAndCollect } }` (toujours LES DEUX flags, jamais un patch
 *     partiel — la mutation backend a un validator non-optionnel sur les
 *     deux champs internes : cf. `tenantSettings.ts` `acceptedModesPatch`).
 *   - Save → on rejection, surfaces an inline form error (page-level toast
 *     is the page's responsibility).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// Same `useForm` mock pattern as `coordonnees-editor.test.tsx` /
// `branding-editor.test.tsx`: a controllable form-state record that tests
// can mutate to simulate user input under `environment: "node"`.
const formMock = {
  registers: [] as string[],
  values: {} as Record<string, unknown>,
  errors: {} as Record<string, { message?: string } | undefined>,
  handleSubmit:
    (fn: (data: Record<string, unknown>) => unknown) => async (e?: unknown) => {
      if (
        e &&
        typeof (e as { preventDefault?: () => void }).preventDefault ===
          "function"
      ) {
        (e as { preventDefault: () => void }).preventDefault();
      }
      await fn(formMock.values);
    },
};

vi.mock("react-hook-form", () => ({
  useForm: vi.fn(
    ({ defaultValues }: { defaultValues?: Record<string, unknown> } = {}) => {
      formMock.values = { ...(defaultValues ?? {}) };
      return {
        register: (name: string) => {
          formMock.registers.push(name);
          return {
            name,
            onChange: (e: { target?: { value?: unknown } }) => {
              if (e?.target?.value !== undefined) {
                formMock.values[name] = e.target.value;
              }
            },
            onBlur: () => {},
            ref: () => {},
          };
        },
        watch: (name?: string) =>
          name === undefined ? formMock.values : formMock.values[name],
        setValue: (name: string, value: unknown) => {
          formMock.values[name] = value;
        },
        getValues: (name?: string) =>
          name === undefined ? formMock.values : formMock.values[name],
        handleSubmit: formMock.handleSubmit,
        formState: {
          errors: formMock.errors,
          isSubmitting: false,
        },
        reset: (next?: Record<string, unknown>) => {
          formMock.values = { ...(next ?? {}) };
        },
      };
    },
  ),
}));

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
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

const { ModesEditor } = await import("./modes-editor");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (same shape as the sibling editors' tests).
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

function dataSlots(n: SerializedNode): string[] {
  return flatten(n)
    .map((x) => {
      if (x === null || "text" in x) return null;
      const ds = x.props["data-slot"];
      return typeof ds === "string" ? ds : null;
    })
    .filter((s): s is string => s !== null);
}

function findBySlot(n: SerializedNode, slot: string): SerializedNode | null {
  const all = flatten(n);
  for (const node of all) {
    if (
      node !== null &&
      !("text" in node) &&
      node.props["data-slot"] === slot
    ) {
      return node;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
type AcceptedModesPatch = {
  acceptedModes: { delivery: boolean; clickAndCollect: boolean };
};

function makeProps(
  overrides: {
    value?: { delivery?: boolean; clickAndCollect?: boolean };
    onSave?: (patch: AcceptedModesPatch) => Promise<void>;
  } = {},
) {
  return {
    value: overrides.value ?? {},
    onSave: overrides.onSave ?? vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Source-level pins (catches an editor that secretly couples to the
// tenant context / URL / backend api — reusability guard).
// ---------------------------------------------------------------------------
const EDITOR_SOURCE = readFileSync(
  path.resolve(__dirname, "./modes-editor.tsx"),
  "utf8",
);

function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("ModesEditor — F-PARAMETRES-04 (#234) module contract", () => {
  it("is a stand-alone module — no coupling to URL / tenant context / backend api", () => {
    const code = stripNonCode(EDITOR_SOURCE);
    expect(code).not.toMatch(/useCurrentTenantId/);
    expect(code).not.toMatch(/useTenantQuery/);
    expect(code).not.toMatch(/useTenantMutation/);
    expect(code).not.toMatch(/useParams/);
    expect(code).not.toMatch(/api\.lib\.admin\.tenantSettings/);
    expect(code).not.toMatch(/\buseMutation\b/);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("uses react-hook-form's `useForm` (isolated per-section form, user story 9)", () => {
    const code = stripNonCode(EDITOR_SOURCE);
    expect(code).toMatch(/useForm\b/);
    expect(EDITOR_SOURCE).toMatch(/from\s+["']react-hook-form["']/);
  });

  it("exports the public contract { value, onSave } via a typed Props", () => {
    expect(EDITOR_SOURCE).toMatch(/ModesEditorProps/);
    expect(EDITOR_SOURCE).toMatch(/onSave/);
  });

  it("uses the shadcn `Switch` primitive (the canonical toggle component per the issue body: « 2 toggles (components/ui/switch) »)", () => {
    expect(EDITOR_SOURCE).toMatch(/from\s+["']@\/components\/ui\/switch["']/);
  });
});

// ---------------------------------------------------------------------------
// Rendering branches
// ---------------------------------------------------------------------------
describe("ModesEditor — rendering branches", () => {
  it("renders the labels « Livraison » and « Click & Collect » + the Enregistrer button", () => {
    const tree = serialize(ModesEditor(makeProps()));
    const text = allText(tree);
    expect(text).toMatch(/Livraison/);
    expect(text).toMatch(/Click ?& ?Collect/i);
    expect(text).toMatch(/Enregistrer/);
  });

  it("renders a stable data-slot on each load-bearing element (form / delivery toggle / click&collect toggle / save button)", () => {
    const tree = serialize(ModesEditor(makeProps()));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-modes-form");
    expect(slots).toContain("parametres-modes-delivery-toggle");
    expect(slots).toContain("parametres-modes-click-and-collect-toggle");
    expect(slots).toContain("parametres-modes-save");
  });

  it("seeds the form with the persisted value (delivery + clickAndCollect)", () => {
    serialize(
      ModesEditor(
        makeProps({ value: { delivery: true, clickAndCollect: false } }),
      ),
    );
    expect(formMock.values.delivery).toBe(true);
    expect(formMock.values.clickAndCollect).toBe(false);
  });

  it("when `value` is empty (fresh tenant) defaults to BOTH modes enabled — at least one mode must remain active, two enabled is the safe default", () => {
    serialize(ModesEditor(makeProps({ value: {} })));
    expect(formMock.values.delivery).toBe(true);
    expect(formMock.values.clickAndCollect).toBe(true);
  });

  it("surfaces the help text « Au moins un mode doit rester actif » so the gérant understands the guardrail before he hits it", () => {
    const tree = serialize(ModesEditor(makeProps()));
    const text = allText(tree);
    expect(text).toMatch(/Au moins un mode doit rester actif/i);
  });
});

// ---------------------------------------------------------------------------
// GUARD MÉTIER FRONT — « au moins un mode actif » (AC clé)
// ---------------------------------------------------------------------------
describe("ModesEditor — guard « au moins un mode actif » (user story 5, AC clé)", () => {
  it("when only delivery is currently active, the delivery toggle is DISABLED (impossible de désactiver le dernier mode actif)", () => {
    // Live form state: only delivery enabled. The user would turn delivery
    // off — which would leave both modes off. The toggle must refuse.
    const tree = serialize(
      ModesEditor(
        makeProps({ value: { delivery: true, clickAndCollect: false } }),
      ),
    );
    const deliveryToggle = findBySlot(tree, "parametres-modes-delivery-toggle");
    expect(deliveryToggle).not.toBeNull();
    if (deliveryToggle !== null && !("text" in deliveryToggle)) {
      expect(deliveryToggle.props["disabled"]).toBe(true);
    }
    // The OTHER toggle (click & collect, currently off) stays activable —
    // turning it on is the legal escape from the « last active mode » state.
    const ccToggle = findBySlot(
      tree,
      "parametres-modes-click-and-collect-toggle",
    );
    expect(ccToggle).not.toBeNull();
    if (ccToggle !== null && !("text" in ccToggle)) {
      expect(ccToggle.props["disabled"]).not.toBe(true);
    }
  });

  it("when only click & collect is currently active, the click & collect toggle is DISABLED, delivery stays activable", () => {
    const tree = serialize(
      ModesEditor(
        makeProps({ value: { delivery: false, clickAndCollect: true } }),
      ),
    );
    const ccToggle = findBySlot(
      tree,
      "parametres-modes-click-and-collect-toggle",
    );
    expect(ccToggle).not.toBeNull();
    if (ccToggle !== null && !("text" in ccToggle)) {
      expect(ccToggle.props["disabled"]).toBe(true);
    }
    const deliveryToggle = findBySlot(tree, "parametres-modes-delivery-toggle");
    expect(deliveryToggle).not.toBeNull();
    if (deliveryToggle !== null && !("text" in deliveryToggle)) {
      expect(deliveryToggle.props["disabled"]).not.toBe(true);
    }
  });

  it("when BOTH modes are active, NEITHER toggle is disabled (the user can freely turn off either — turning off one is legal)", () => {
    const tree = serialize(
      ModesEditor(
        makeProps({ value: { delivery: true, clickAndCollect: true } }),
      ),
    );
    const deliveryToggle = findBySlot(tree, "parametres-modes-delivery-toggle");
    const ccToggle = findBySlot(
      tree,
      "parametres-modes-click-and-collect-toggle",
    );
    if (deliveryToggle !== null && !("text" in deliveryToggle)) {
      expect(deliveryToggle.props["disabled"]).not.toBe(true);
    }
    if (ccToggle !== null && !("text" in ccToggle)) {
      expect(ccToggle.props["disabled"]).not.toBe(true);
    }
  });

  it("when only delivery is active, surfaces an inline message « Au moins un mode doit rester actif » via a data-slot the consumer can target", () => {
    const tree = serialize(
      ModesEditor(
        makeProps({ value: { delivery: true, clickAndCollect: false } }),
      ),
    );
    expect(dataSlots(tree)).toContain("parametres-modes-guard-message");
  });

  it("the disabled-toggle guard is symmetric — when only click & collect is active, the same `data-slot=parametres-modes-guard-message` surfaces (consistent affordance)", () => {
    const tree = serialize(
      ModesEditor(
        makeProps({ value: { delivery: false, clickAndCollect: true } }),
      ),
    );
    expect(dataSlots(tree)).toContain("parametres-modes-guard-message");
  });

  it("the inline guard message is NOT shown when both modes are active (no false alarm — only surfaces when the guard is engaged)", () => {
    const tree = serialize(
      ModesEditor(
        makeProps({ value: { delivery: true, clickAndCollect: true } }),
      ),
    );
    expect(dataSlots(tree)).not.toContain("parametres-modes-guard-message");
  });

  it("DEFENCE IN DEPTH — on programmatic submit with both flags = false (bypass UI), onSave is NEVER called (re-asserts the rule at submit time, mirrors the disabled toggle)", async () => {
    // The toggle disabled state is the visible guard, but a programmatic
    // submit (or a buggy controlled-toggle round-trip) could theoretically
    // reach the handler with both = false. The editor MUST refuse.
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      ModesEditor(
        makeProps({
          value: { delivery: true, clickAndCollect: false },
          onSave,
        }),
      ),
    );
    formMock.values = { delivery: false, clickAndCollect: false };
    const formNode = findBySlot(tree, "parametres-modes-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).not.toHaveBeenCalled();
    formMock.values = {};
  });
});

// ---------------------------------------------------------------------------
// Save flow — full patch shape + isolation + diff
// ---------------------------------------------------------------------------
describe("ModesEditor — save flow", () => {
  it("AC save with both flags set — onSave receives `{ acceptedModes: { delivery, clickAndCollect } }` (the backend mutation REQUIRES both booleans — never a partial patch)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      ModesEditor(
        makeProps({
          value: { delivery: true, clickAndCollect: true },
          onSave,
        }),
      ),
    );
    formMock.values = { delivery: false, clickAndCollect: true };
    const formNode = findBySlot(tree, "parametres-modes-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      acceptedModes: { delivery: false, clickAndCollect: true },
    });
    formMock.values = {};
  });

  it("AC no diff vs `value` — no-op (no onSave call when nothing changed)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      ModesEditor(
        makeProps({
          value: { delivery: true, clickAndCollect: false },
          onSave,
        }),
      ),
    );
    formMock.values = { delivery: true, clickAndCollect: false };
    const formNode = findBySlot(tree, "parametres-modes-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).not.toHaveBeenCalled();
    formMock.values = {};
  });

  it("AC save error → inline error surfaced via local state (no swallow, no crash, AC: « inline form errors »)", async () => {
    const failure = new Error("FORBIDDEN: no access to this tenant");
    const onSave = vi.fn(async () => {
      throw failure;
    });
    const tree = serialize(
      ModesEditor(
        makeProps({
          value: { delivery: true, clickAndCollect: true },
          onSave,
        }),
      ),
    );
    formMock.values = { delivery: false, clickAndCollect: true };
    const formNode = findBySlot(tree, "parametres-modes-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await expect(
        onSubmit?.({ preventDefault: () => {} }),
      ).resolves.not.toThrow();
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    formMock.values = {};
  });

  it("AC save fresh tenant (no value) — the form defaults to both = true and the diff vs `{}` always emits the patch (the backend stamps the row on first save)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(ModesEditor(makeProps({ value: {}, onSave })));
    // Defaults seeded: both = true. The user toggles delivery off → leaves
    // click & collect on. Save must commit BOTH flags.
    formMock.values = { delivery: false, clickAndCollect: true };
    const formNode = findBySlot(tree, "parametres-modes-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      acceptedModes: { delivery: false, clickAndCollect: true },
    });
    formMock.values = {};
  });
});
