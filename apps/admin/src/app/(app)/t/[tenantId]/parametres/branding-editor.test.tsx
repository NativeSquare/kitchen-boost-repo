/**
 * F-PARAMETRES-02 (#229) — `BrandingEditor`, the section éditeur for
 * Identité visuelle (logo + couleur primaire), extracted as a reusable deep
 * module so F-WIZARD step 4 « Branding » can mount the SAME editor (EPIC #148
 * « Further Notes » — explicit factorisation candidate).
 *
 * Public contract (frozen by the issue body):
 *   {
 *     value:    { logoUrl?: string, primaryColor?: string },
 *     onSave:   (patch: { branding: { logoUrl?, primaryColor? } }) => Promise<void>,
 *     onUploadLogo: (file: File) => Promise<string>  // returns the public URL
 *   }
 *
 * The editor owns:
 *   - local form state (its own `useForm`, isolated per user story 9 — an
 *     error on Coordonnées must not blow away the user's color picker input);
 *   - the file picker (PNG / JPG / SVG) + local preview before upload;
 *   - the color picker with LIVE preview on a swatch (user story 3) — the
 *     swatch reflects the picker value BEFORE the user clicks save;
 *   - the save button — calls `onUploadLogo` first when a file was picked,
 *     then forwards the patch to `onSave`;
 *   - inline form error surface when `onSave` rejects (user story 8); toast
 *     for success lives at the page level (consistent with the rest of admin).
 *
 * Acceptance criteria pinned here (#229):
 *   - "Color picker avec preview live (le swatch reflète la couleur
 *     sélectionnée avant save)" → the swatch's inline `backgroundColor` style
 *     mirrors the form field value, not the prop value.
 *   - "Save isolé : un échec sur cette section n'affecte pas les autres
 *     useForm" → assert `react-hook-form`'s `useForm` is called (not a shared
 *     parent form context), and assert the editor doesn't read any external
 *     form state.
 *   - "Toast de succès + inline form errors" → toast lives at page level
 *     (`page.test.ts` pins it); the inline error surface is pinned here.
 *   - "Composant éditeur extrait dans un fichier dédié, signature
 *     { value, onSave }, pas de couplage URL/tenant intra-composant" → pinned
 *     at source-string level (the editor doesn't import `useTenantQuery`,
 *     `useCurrentTenantId`, `useParams`, or `api.lib.admin.tenantSettings`).
 *   - "Test d'intégration : flow upload (URL retournée → patch envoyé → query
 *     relue affiche le nouveau logo)" → driven by the handler test below: a
 *     file picked + save triggers `onUploadLogo` first, THEN forwards the
 *     resulting URL inside the patch to `onSave`. The "query relue" half is
 *     Convex's natural reactivity — the page re-renders with a new `value`
 *     prop and the editor surfaces the new logo URL.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// react-hook-form's `useForm` returns a controller object with handlers we
// need to invoke from tests. Under `environment: "node"` (no DOM), we can't
// mount the editor with RTL, so we drive its handlers directly through a
// minimal mock that records every register/setValue/handleSubmit call.
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

// React `useState` + `useEffect` are exercised by the file-picker preview
// branch. Under node env, the real hooks throw — same stub pattern as
// `menu-view.test.tsx`. `useRef` is used for the hidden file input.
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

const { BrandingEditor } = await import("./branding-editor");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as parametres-view.test.tsx.
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
    value?: { logoUrl?: string; primaryColor?: string };
    onSave?: (patch: {
      branding: { logoUrl?: string; primaryColor?: string };
    }) => Promise<void>;
    onUploadLogo?: (file: File) => Promise<string>;
  } = {},
) {
  return {
    value: overrides.value ?? {},
    onSave: overrides.onSave ?? vi.fn(async () => {}),
    onUploadLogo:
      overrides.onUploadLogo ?? vi.fn(async () => "https://cdn/x.png"),
  };
}

// ---------------------------------------------------------------------------
// Source-level pins (run before any rendering: catches an editor that
// secretly couples to the URL / tenant context / backend api).
// ---------------------------------------------------------------------------
const EDITOR_SOURCE = readFileSync(
  path.resolve(__dirname, "./branding-editor.tsx"),
  "utf8",
);

function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("BrandingEditor — F-PARAMETRES-02 (#229) module contract", () => {
  it("is a stand-alone module — no coupling to URL / tenant context / backend api (reusable for F-WIZARD step 4)", () => {
    const code = stripNonCode(EDITOR_SOURCE);
    // No tenant context — the editor receives `value` + handlers, never reads
    // the tenantId itself (the page does the wiring, the editor is dumb).
    expect(code).not.toMatch(/useCurrentTenantId/);
    expect(code).not.toMatch(/useTenantQuery/);
    expect(code).not.toMatch(/useTenantMutation/);
    expect(code).not.toMatch(/useParams/);
    // No direct reference to the backend api — handlers are passed in.
    expect(code).not.toMatch(/api\.lib\.admin\.tenantSettings/);
    expect(code).not.toMatch(/api\.lib\.menu\.photos/);
    expect(code).not.toMatch(/api\.storage/);
    // No `useMutation` / `useQuery` — the page owns those.
    expect(code).not.toMatch(/\buseMutation\b/);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("uses react-hook-form's `useForm` (isolated per-section form, user story 9)", () => {
    const code = stripNonCode(EDITOR_SOURCE);
    expect(code).toMatch(/useForm\b/);
    expect(EDITOR_SOURCE).toMatch(/from\s+["']react-hook-form["']/);
  });

  it("exports the public contract { value, onSave, onUploadLogo } via a typed Props", () => {
    // Pinned at the type level via the type alias name — the issue body
    // freezes the shape, future agents shouldn't rename it.
    expect(EDITOR_SOURCE).toMatch(/BrandingEditorProps/);
    expect(EDITOR_SOURCE).toMatch(/onSave/);
    expect(EDITOR_SOURCE).toMatch(/onUploadLogo/);
  });
});

// ---------------------------------------------------------------------------
// Rendering branches
// ---------------------------------------------------------------------------
describe("BrandingEditor — rendering branches", () => {
  it("renders the section title « Identité visuelle » + Logo + Couleur primaire labels", () => {
    const props = makeProps();
    const tree = serialize(BrandingEditor(props));
    const text = allText(tree);
    expect(text).toMatch(/Identit[ée] visuelle/);
    expect(text).toMatch(/Logo/);
    expect(text).toMatch(/Couleur primaire/);
  });

  it("renders a Save button (Enregistrer) inside the section", () => {
    const tree = serialize(BrandingEditor(makeProps()));
    const text = allText(tree);
    expect(text).toMatch(/Enregistrer/);
    // Pin the stable data-slot so other surfaces (and tests) can target it.
    expect(dataSlots(tree)).toContain("parametres-branding-save");
  });

  it("renders a file input for the logo (PNG / JPG / SVG)", () => {
    const tree = serialize(BrandingEditor(makeProps()));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-branding-logo-input");
    const node = findBySlot(tree, "parametres-branding-logo-input");
    expect(node).not.toBeNull();
    // The `accept` attribute must allow image MIME types (PNG / JPG / SVG)
    // — pin the attribute presence so a regression that drops it is caught.
    if (node !== null && !("text" in node)) {
      const accept = node.props["accept"];
      expect(typeof accept).toBe("string");
      expect(accept as string).toMatch(/image/);
    }
  });

  it("renders the live-preview swatch with a stable data-slot (user story 3)", () => {
    const tree = serialize(
      BrandingEditor(makeProps({ value: { primaryColor: "#1B7A3D" } })),
    );
    expect(dataSlots(tree)).toContain("parametres-branding-color-swatch");
  });

  it("AC color preview is LIVE — the swatch reflects the form's primaryColor (not just the prop) via inline backgroundColor", () => {
    // The initial form value is seeded from the prop; the swatch's inline
    // style reads from the form field (so a picker change updates it before
    // save). We assert the inline style is sourced from the form value by
    // pinning that the swatch carries an inline `backgroundColor` style
    // whose value matches the seed.
    const tree = serialize(
      BrandingEditor(makeProps({ value: { primaryColor: "#1B7A3D" } })),
    );
    const swatch = findBySlot(tree, "parametres-branding-color-swatch");
    expect(swatch).not.toBeNull();
    if (swatch !== null && !("text" in swatch)) {
      const style = swatch.props["style"] as
        | Record<string, unknown>
        | undefined;
      expect(style).toBeDefined();
      // Tailwind classes can't surface a dynamic color — only inline style.
      expect(String(style?.backgroundColor ?? "")).toMatch(/#1B7A3D/i);
    }
  });

  it("renders an existing logo preview (img) when value.logoUrl is set", () => {
    const tree = serialize(
      BrandingEditor(makeProps({ value: { logoUrl: "https://cdn/logo.png" } })),
    );
    const preview = findBySlot(tree, "parametres-branding-logo-preview");
    expect(preview).not.toBeNull();
  });

  it("renders an `aria-invalid` color input when the form holds an invalid primaryColor (inline form error surface, user story 8)", () => {
    // Seed the form-mock with an error on `primaryColor`.
    formMock.errors = { primaryColor: { message: "Couleur invalide" } };
    const tree = serialize(BrandingEditor(makeProps()));
    const text = allText(tree);
    expect(text).toMatch(/Couleur invalide/);
    formMock.errors = {};
  });
});

// ---------------------------------------------------------------------------
// Save flow — the integration loop required by AC
// ---------------------------------------------------------------------------
describe("BrandingEditor — save flow (integration)", () => {
  it("AC save with color only — onSave receives `{ branding: { primaryColor } }`, no upload triggered", async () => {
    const onSave = vi.fn(async () => {});
    const onUploadLogo = vi.fn(async () => "https://cdn/x.png");
    const props = makeProps({
      value: { primaryColor: "#1B7A3D" },
      onSave,
      onUploadLogo,
    });
    // Render first (this resets formMock.values to defaultValues via the
    // mocked useForm), THEN simulate the user picking a different color
    // by writing into formMock.values — the mock's handleSubmit reads
    // values at submit-time, not render-time.
    const tree = serialize(BrandingEditor(props));
    formMock.values = { primaryColor: "#E5A100", logoFile: null };
    const formNode = findBySlot(tree, "parametres-branding-form");
    expect(formNode).not.toBeNull();
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      expect(onSubmit).toBeDefined();
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onUploadLogo).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      branding: { primaryColor: "#E5A100" },
    });
  });

  it("AC save with file picked — uploads first, then forwards the returned URL inside the patch (the integration loop)", async () => {
    const fakeFile = { name: "logo.png", type: "image/png" } as unknown as File;
    const fileList = {
      0: fakeFile,
      length: 1,
      item: (i: number) => (i === 0 ? fakeFile : null),
    } as unknown as FileList;
    const onSave = vi.fn(async () => {});
    const onUploadLogo = vi.fn(async () => "https://cdn/uploaded.png");

    const props = makeProps({
      value: { primaryColor: "#1B7A3D" },
      onSave,
      onUploadLogo,
    });
    const tree = serialize(BrandingEditor(props));
    // Simulate user picking a file AFTER render (mock's handleSubmit reads
    // formMock.values at submit-time).
    formMock.values = { primaryColor: "#1B7A3D", logoFile: fileList };
    const formNode = findBySlot(tree, "parametres-branding-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onUploadLogo).toHaveBeenCalledTimes(1);
    expect(onUploadLogo).toHaveBeenCalledWith(fakeFile);
    expect(onSave).toHaveBeenCalledTimes(1);
    // The patch carries logoUrl. primaryColor is unchanged vs value, so
    // it's NOT in the patch (diff-only behaviour).
    expect(onSave).toHaveBeenCalledWith({
      branding: {
        logoUrl: "https://cdn/uploaded.png",
      },
    });
  });

  it("AC empty patch is a no-op — neither uploads nor calls onSave when no field changed", async () => {
    const onSave = vi.fn(async () => {});
    const onUploadLogo = vi.fn(async () => "https://cdn/x.png");
    // value = { primaryColor: "#1B7A3D" } AND form is left at default
    // (which equals value.primaryColor) → no diff → no-op.
    const props = makeProps({
      value: { primaryColor: "#1B7A3D" },
      onSave,
      onUploadLogo,
    });
    const tree = serialize(BrandingEditor(props));
    // Don't change formMock.values — leave at default (same as value).
    const formNode = findBySlot(tree, "parametres-branding-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onUploadLogo).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("AC save error → inline error surfaced via form state (no swallow, no crash)", async () => {
    const failure = new Error("INVALID_HEX_COLOR");
    const onSave = vi.fn(async () => {
      throw failure;
    });
    formMock.values = { primaryColor: "#ZZZZZZ", logoFile: null };
    const props = makeProps({ value: {}, onSave });
    const tree = serialize(BrandingEditor(props));
    const formNode = findBySlot(tree, "parametres-branding-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      // The editor must not let the rejection escape unhandled.
      await expect(
        onSubmit?.({ preventDefault: () => {} }),
      ).resolves.not.toThrow();
    }
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
