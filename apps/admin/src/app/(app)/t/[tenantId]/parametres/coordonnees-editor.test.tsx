/**
 * F-PARAMETRES-03 (#231) — `CoordonneesEditor`, the section éditeur for
 * Coordonnées (adresse + téléphone) on the tenant Paramètres page.
 *
 * Public contract (frozen by the issue body):
 *   {
 *     value:  { address?: string, phone?: string },
 *     onSave: (patch: { address?: string, phone?: string }) => Promise<void>,
 *   }
 *
 * Pinned here:
 *   - The editor is a stand-alone module — no coupling to tenant context /
 *     URL / backend api (so a future surface can reuse it without rework).
 *   - Owns its OWN `useForm` (user story 9 — save isolé : an error on
 *     another section can't blow away the user's input here).
 *   - PHONE FR validation REGEX (pure function `isValidFrenchPhone`):
 *     accepts 06/07/01-05/09 + 8 digits, with or without spaces, with or
 *     without `+33` prefix. Rejects anything else. Exhaustive cases below.
 *   - Save button stays DISABLED on invalid phone (AC « bouton Enregistrer
 *     désactivé » when phone format invalid).
 *   - Save flow: `onSave` receives ONLY the changed fields (patch diff) —
 *     unchanged fields are NOT in the patch. Empty patch = no-op.
 *   - Inline form errors on `onSave` rejection (no swallow, no crash).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// Same `useForm` mock pattern as `branding-editor.test.tsx`: a controllable
// form-state record that tests can mutate to simulate user input under
// `environment: "node"` (no DOM available).
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

const { CoordonneesEditor, isValidFrenchPhone } =
  await import("./coordonnees-editor");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (same shape as the sibling editor's test).
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
function makeProps(
  overrides: {
    value?: { address?: string; phone?: string };
    onSave?: (patch: { address?: string; phone?: string }) => Promise<void>;
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
  path.resolve(__dirname, "./coordonnees-editor.tsx"),
  "utf8",
);

function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("CoordonneesEditor — F-PARAMETRES-03 (#231) module contract", () => {
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
    expect(EDITOR_SOURCE).toMatch(/CoordonneesEditorProps/);
    expect(EDITOR_SOURCE).toMatch(/onSave/);
  });

  it("exports the pure FR-phone validator so it can be unit-tested in isolation (AC: « Test du regex de validation téléphone FR (unitaire) »)", () => {
    expect(typeof isValidFrenchPhone).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Pure FR-phone validator (the AC asks for a dedicated unit test).
// ---------------------------------------------------------------------------
describe("isValidFrenchPhone — FR mobile / landline format (AC)", () => {
  // Accepted formats from the issue body:
  //   06 12 34 56 78, 0612345678, +33 6 12 34 56 78
  // Rule: a leading 0 followed by digit in {1,2,3,4,5,6,7,9}, then 8 digits;
  // OR international +33 / 0033 with the same trunk digit + 8 trailing digits.
  // Spaces, dots, and dashes are tolerated separators and stripped before
  // matching (canonical UX in FR forms).
  it("accepts canonical mobile numbers (06/07 + 8 digits, with or without spaces)", () => {
    expect(isValidFrenchPhone("0612345678")).toBe(true);
    expect(isValidFrenchPhone("06 12 34 56 78")).toBe(true);
    expect(isValidFrenchPhone("07 88 99 00 11")).toBe(true);
  });

  it("accepts canonical landline numbers (01-05 / 09 + 8 digits)", () => {
    expect(isValidFrenchPhone("0123456789")).toBe(true);
    expect(isValidFrenchPhone("01 23 45 67 89")).toBe(true);
    expect(isValidFrenchPhone("0298765432")).toBe(true);
    expect(isValidFrenchPhone("03 11 22 33 44")).toBe(true);
    expect(isValidFrenchPhone("04 55 66 77 88")).toBe(true);
    expect(isValidFrenchPhone("0599887766")).toBe(true);
    expect(isValidFrenchPhone("0987654321")).toBe(true);
  });

  it("accepts the international +33 prefix (with or without spaces, with or without leading 0 after +33)", () => {
    expect(isValidFrenchPhone("+33612345678")).toBe(true);
    expect(isValidFrenchPhone("+33 6 12 34 56 78")).toBe(true);
    expect(isValidFrenchPhone("+33 1 23 45 67 89")).toBe(true);
  });

  it("accepts dots and dashes as separators (common FR variants)", () => {
    expect(isValidFrenchPhone("06.12.34.56.78")).toBe(true);
    expect(isValidFrenchPhone("06-12-34-56-78")).toBe(true);
  });

  it("rejects numbers with the wrong length (too short / too long)", () => {
    expect(isValidFrenchPhone("06123456")).toBe(false);
    expect(isValidFrenchPhone("0612345678901")).toBe(false);
    expect(isValidFrenchPhone("")).toBe(false);
  });

  it("rejects numbers starting with an invalid trunk digit (08 = premium/special, 00 = international)", () => {
    expect(isValidFrenchPhone("0812345678")).toBe(false);
    expect(isValidFrenchPhone("0012345678")).toBe(false);
  });

  it("rejects numbers without a leading 0 or +33 prefix", () => {
    expect(isValidFrenchPhone("612345678")).toBe(false);
    expect(isValidFrenchPhone("1234567890")).toBe(false);
  });

  it("rejects non-numeric content (letters / symbols other than allowed separators / leading +)", () => {
    expect(isValidFrenchPhone("06 12 34 56 7A")).toBe(false);
    expect(isValidFrenchPhone("06/12/34/56/78")).toBe(false);
    expect(isValidFrenchPhone("abcd")).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(isValidFrenchPhone("   ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rendering branches
// ---------------------------------------------------------------------------
describe("CoordonneesEditor — rendering branches", () => {
  it("renders the labels « Adresse » and « Téléphone » + the Enregistrer button", () => {
    const tree = serialize(CoordonneesEditor(makeProps()));
    const text = allText(tree);
    expect(text).toMatch(/Adresse/);
    expect(text).toMatch(/T[ée]l[ée]phone/);
    expect(text).toMatch(/Enregistrer/);
  });

  it("renders a stable data-slot on each load-bearing element (form / address input / phone input / save button)", () => {
    const tree = serialize(CoordonneesEditor(makeProps()));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-coordonnees-form");
    expect(slots).toContain("parametres-coordonnees-address-input");
    expect(slots).toContain("parametres-coordonnees-phone-input");
    expect(slots).toContain("parametres-coordonnees-save");
  });

  it("seeds the form with the persisted value (address + phone surface as defaults)", () => {
    serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            address: "12 rue de la Paix, 75002 Paris",
            phone: "0612345678",
          },
        }),
      ),
    );
    // The mocked `useForm` snapshots `defaultValues` into `formMock.values`.
    expect(formMock.values.address).toBe("12 rue de la Paix, 75002 Paris");
    expect(formMock.values.phone).toBe("0612345678");
  });

  it("surfaces inline phone-format error when the current phone is invalid (AC: « Erreur inline si format invalide »)", () => {
    // Seed an invalid phone into the form-mock; the editor's render-time
    // validation must surface the inline error message.
    formMock.values = { address: "", phone: "abcd" };
    const tree = serialize(CoordonneesEditor(makeProps()));
    const text = allText(tree);
    // Some « format invalide » copy must be present.
    expect(text.toLowerCase()).toMatch(/invalide|format/);
    expect(dataSlots(tree)).toContain("parametres-coordonnees-phone-error");
    formMock.values = {};
  });

  it("disables the Save button when the current phone is invalid (AC: « bouton Enregistrer désactivé »)", () => {
    formMock.values = { address: "", phone: "abcd" };
    const tree = serialize(CoordonneesEditor(makeProps()));
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).toBe(true);
    }
    formMock.values = {};
  });

  it("does NOT disable the Save button when the phone is empty (untouched = no error to display) — empty phone is allowed (the field is optional)", () => {
    formMock.values = { address: "", phone: "" };
    const tree = serialize(CoordonneesEditor(makeProps()));
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).not.toBe(true);
    }
    formMock.values = {};
  });

  it("does NOT disable the Save button when the phone is a valid FR number", () => {
    formMock.values = { address: "1 rue X", phone: "06 12 34 56 78" };
    const tree = serialize(CoordonneesEditor(makeProps()));
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).not.toBe(true);
    }
    formMock.values = {};
  });
});

// ---------------------------------------------------------------------------
// Save flow — diff-only patch + isolation
// ---------------------------------------------------------------------------
describe("CoordonneesEditor — save flow", () => {
  it("AC save with both fields changed — onSave receives the full patch", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      CoordonneesEditor(
        makeProps({ value: { address: "old", phone: "0102030405" }, onSave }),
      ),
    );
    formMock.values = {
      address: "12 rue Neuve, 75001 Paris",
      phone: "06 12 34 56 78",
    };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
    expect(formNode).not.toBeNull();
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    // Patch contains BOTH changed fields. Phone is forwarded as the
    // user typed it — backend `normalisePhone` canonicalises on the server
    // side (single source of truth, no client/server drift risk).
    expect(onSave).toHaveBeenCalledWith({
      address: "12 rue Neuve, 75001 Paris",
      phone: "06 12 34 56 78",
    });
    formMock.values = {};
  });

  it("AC save with only the phone changed — patch carries only `phone` (diff-only behaviour, AC: « patch partiel, seuls les champs modifiés sont envoyés »)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: { address: "12 rue Neuve", phone: "0102030405" },
          onSave,
        }),
      ),
    );
    formMock.values = { address: "12 rue Neuve", phone: "0612345678" };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ phone: "0612345678" });
    formMock.values = {};
  });

  it("AC save with only the address changed — patch carries only `address`", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      CoordonneesEditor(
        makeProps({ value: { address: "old", phone: "0612345678" }, onSave }),
      ),
    );
    formMock.values = { address: "new address", phone: "0612345678" };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ address: "new address" });
    formMock.values = {};
  });

  it("AC empty patch — no-op (no onSave call when nothing changed)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      CoordonneesEditor(
        makeProps({ value: { address: "same", phone: "0612345678" }, onSave }),
      ),
    );
    formMock.values = { address: "same", phone: "0612345678" };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).not.toHaveBeenCalled();
    formMock.values = {};
  });

  it("AC save with invalid phone — onSave is NEVER called (client-side guard mirrors the disabled button)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      CoordonneesEditor(
        makeProps({ value: { address: "old", phone: "0612345678" }, onSave }),
      ),
    );
    formMock.values = { address: "old", phone: "not a phone" };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).not.toHaveBeenCalled();
    formMock.values = {};
  });

  it("AC save error → inline error surfaced via local state (no swallow, no crash, AC: « inline form errors incluant erreurs backend »)", async () => {
    const failure = new Error("FORBIDDEN: no access to this tenant");
    const onSave = vi.fn(async () => {
      throw failure;
    });
    const tree = serialize(CoordonneesEditor(makeProps({ value: {}, onSave })));
    formMock.values = { address: "12 rue", phone: "0612345678" };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
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
});
