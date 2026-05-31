/**
 * F-WIZARD [6/10] (#270) — `Step4BrandingForm` test matrix.
 *
 * Pure presentational composite of the three reusable editors shipped by
 * F-PARAMETRES — `BrandingEditor` (#229), `CoordonneesEditor` (#231) and
 * `ModesEditor` (#234) — that the wizard's Step 4 mounts (issue spec:
 * « C'est exactement le même form que la page Paramètres tenant §4.8 …
 * réutilise le composant si déjà créé »).
 *
 * The wizard surface differs from Paramètres on two points only:
 *   - the three editors are framed inside the wizard's chrome-less layout
 *     (no global Paramètres header, no Uber Direct read-only block);
 *   - a Précédent / Suivant nav strip is rendered after the editors so the
 *     operator can advance to step 5 once the editors are saved (or skip
 *     ahead and revisit later — step 4 is non-blocking by spec, the
 *     completion gate « primaryColor + logo posés » is owned by
 *     `computeWizardState`).
 *
 * Acceptance criteria covered (issue #270):
 *   - Form renders all 3 editors (Identité visuelle, Coordonnées, Modes).
 *   - Précédent + Suivant nav buttons wired to onPrev / onNext.
 *   - The form delegates submit to the editors' own « Enregistrer » buttons
 *     (each editor calls `tenant.updateSettings` independently with its
 *     section patch — backend deep-merges branding fields).
 *   - Scope guard: no imports from `apps/web` / `apps/native`.
 *
 * Why the Convex wiring is owned by `step-forms.tsx` (not this file):
 * ------------------------------------------------------------------
 * Same pattern as Step 1 / Step 3 — `step-forms.tsx`'s `Step4Form` wrapper
 * is the thin Convex-side adapter (reads the prospect for `tenantId`, mounts
 * `useMutation(updateSettings)`, `useMutation(generateUploadUrl)`,
 * `useConvex().query(getImageUrl)`, threads the three editors' onSave +
 * onUploadLogo handlers). This pure component just composes the editors and
 * the nav strip; the lean `node` vitest env can pin its shape without
 * paying the Convex-runtime tax.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// react-hook-form is used inside each editor (BrandingEditor, CoordonneesEditor,
// ModesEditor). Mirror the mock pattern from the editor's own test suites so
// the lean `node` env can render the composite without a DOM.
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
      formMock.values = { ...formMock.values, ...(defaultValues ?? {}) };
      return {
        register: (name: string) => {
          formMock.registers.push(name);
          return {
            name,
            onChange: (e: {
              target?: { value?: unknown; files?: FileList | null };
            }) => {
              if (e?.target?.files !== undefined) {
                formMock.values[name] = e.target.files;
              } else if (e?.target?.value !== undefined) {
                formMock.values[name] = e.target.value;
              }
            },
            onBlur: () => {},
            ref: () => {},
          };
        },
        watch: (name: string) => formMock.values[name],
        setValue: (name: string, value: unknown) => {
          formMock.values[name] = value;
        },
        getValues: (name?: string) =>
          name === undefined ? formMock.values : formMock.values[name],
        handleSubmit: formMock.handleSubmit,
        formState: { errors: formMock.errors, isSubmitting: false },
      };
    },
  ),
}));

// React hooks shim — same lean shim as Step1 / Step3 tests. Walks the first
// render only; `useState` / `useMemo` invoke their factory / return the
// initial value with a no-op setter.
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

const { Step4BrandingForm } = await import("./step4-branding-form");
type Step4BrandingFormProps =
  import("./step4-branding-form").Step4BrandingFormProps;

// ---------------------------------------------------------------------------
// React-tree serializer — mirror of step1-provisioning-form.test.tsx.
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

function findAll(
  n: SerializedNode,
  predicate: (n: NonNullable<SerializedNode>) => boolean,
): SerializedNode[] {
  return flatten(n).filter(
    (x): x is NonNullable<SerializedNode> => x !== null && predicate(x),
  );
}

function findBySlot(n: SerializedNode, slot: string): SerializedNode | null {
  const matches = findAll(
    n,
    (x) =>
      "props" in x &&
      (x.props as { "data-slot"?: string })["data-slot"] === slot,
  );
  return matches[0] ?? null;
}

function findButtonByText(
  n: SerializedNode,
  label: RegExp,
): SerializedNode | null {
  const candidates = findAll(n, (x) => {
    if (!("props" in x)) return false;
    const text = allText(x);
    return label.test(text);
  });
  const withHandler = candidates.find(
    (x) =>
      x !== null &&
      "props" in x &&
      typeof (x.props as { onClick?: unknown }).onClick === "function",
  );
  if (withHandler !== undefined) return withHandler;
  return candidates[candidates.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function defaultProps(
  overrides: Partial<Step4BrandingFormProps> = {},
): Step4BrandingFormProps {
  return {
    branding: { logoUrl: "https://cdn/x.png", primaryColor: "#1B7A3D" },
    coordonnees: { address: "1 rue de la Paix", phone: "0612345678" },
    acceptedModes: { delivery: true, clickAndCollect: true },
    onSaveBranding: vi.fn().mockResolvedValue(undefined),
    onUploadLogo: vi.fn().mockResolvedValue("https://cdn/x.png"),
    onSaveCoordonnees: vi.fn().mockResolvedValue(undefined),
    onSaveAcceptedModes: vi.fn().mockResolvedValue(undefined),
    onPrev: () => {},
    onNext: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Step4BrandingForm — F-WIZARD [6/10] (#270)", () => {
  it("renders the Identité visuelle (branding) editor section", () => {
    const tree = serialize(Step4BrandingForm(defaultProps()));
    // BrandingEditor stamps `data-slot="parametres-branding-form"` on its
    // root form element — pin via that stable marker (frozen by #229).
    expect(findBySlot(tree, "parametres-branding-form")).not.toBeNull();
  });

  it("renders the Coordonnées (address + phone) editor section", () => {
    const tree = serialize(Step4BrandingForm(defaultProps()));
    // CoordonneesEditor stamps `data-slot="parametres-coordonnees-form"`
    // (frozen by #231).
    expect(findBySlot(tree, "parametres-coordonnees-form")).not.toBeNull();
  });

  it("renders the Modes acceptés (delivery / clickAndCollect) editor section", () => {
    const tree = serialize(Step4BrandingForm(defaultProps()));
    // ModesEditor stamps `data-slot="parametres-modes-form"` (frozen by #234).
    expect(findBySlot(tree, "parametres-modes-form")).not.toBeNull();
  });

  it("renders Précédent + Suivant nav buttons wired to onPrev / onNext", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const tree = serialize(Step4BrandingForm(defaultProps({ onPrev, onNext })));
    const prevBtn = findButtonByText(tree, /Pr[ée]c[ée]dent/i) as {
      props: { onClick?: () => void };
    } | null;
    const nextBtn = findButtonByText(tree, /Suivant/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(prevBtn).not.toBeNull();
    expect(nextBtn).not.toBeNull();
    prevBtn?.props.onClick?.();
    nextBtn?.props.onClick?.();
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("pre-fills the branding editor with the current persisted value (re-visite — issue spec)", () => {
    // Re-visit: the operator comes back to step 4 with a persisted branding.
    // The BrandingEditor's color swatch reflects the seeded primaryColor via
    // its `style.backgroundColor`. We assert that the persisted value reaches
    // the swatch — proof that the wizard's `branding` prop is forwarded.
    const tree = serialize(
      Step4BrandingForm(
        defaultProps({ branding: { primaryColor: "#E5A100" } }),
      ),
    );
    const swatch = findBySlot(tree, "parametres-branding-color-swatch") as {
      props: { style?: { backgroundColor?: string } };
    } | null;
    expect(swatch).not.toBeNull();
    expect(swatch?.props.style?.backgroundColor).toBe("#E5A100");
  });

  it("undefined value props degrade to empty editors (fresh tenant, no persisted settings)", () => {
    // The wizard's Convex wiring may pass `undefined` while the tenant
    // query is loading. The composite must not throw — each editor handles
    // `value ?? {}` gracefully (mirror of `ParametresView`'s contract).
    const tree = serialize(
      Step4BrandingForm(
        defaultProps({
          branding: undefined,
          coordonnees: undefined,
          acceptedModes: undefined,
        }),
      ),
    );
    expect(findBySlot(tree, "parametres-branding-form")).not.toBeNull();
    expect(findBySlot(tree, "parametres-coordonnees-form")).not.toBeNull();
    expect(findBySlot(tree, "parametres-modes-form")).not.toBeNull();
  });

  it("scope discipline: the form module does not import from `apps/web` or `apps/native`", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./step4-branding-form.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });
});
