/**
 * F-PARAMETRES-03 (#231) + Address-first slice 2 (2026-06-11) —
 * `CoordonneesEditor`, the section éditeur for Coordonnées (adresse + téléphone)
 * on the tenant Paramètres page.
 *
 * Public contract (extended for slice 2 — Google Places autocomplete):
 *   {
 *     value:  {
 *       address?: string,                // formattedAddress (display)
 *       addressLat?: number,             // Google Places `location.lat()`
 *       addressLng?: number,             // Google Places `location.lng()`
 *       addressComponents?: {            // parsed Uber components
 *         streetAddress: string,
 *         city: string,
 *         zipCode: string,
 *         country: string,
 *       },
 *       phone?: string,
 *     },
 *     onSave: (patch: {
 *       address?: string,
 *       addressLat?: number,
 *       addressLng?: number,
 *       addressComponents?: { ... },
 *       phone?: string,
 *     }) => Promise<void>,
 *   }
 *
 * Pinned here:
 *   - Stand-alone module — no coupling to tenant context / URL / backend api.
 *   - Owns its OWN `useForm` (user story 9 — save isolé).
 *   - PHONE FR validation REGEX (pure function `isValidFrenchPhone`).
 *   - Save button DISABLED on invalid phone (AC).
 *   - **Slice 2** — Save button DISABLED until a Google Places selection has
 *     happened OR no diff vs `value` (free-typing forbidden; the address text
 *     input is read-only outside Places selection).
 *   - **Slice 2** — On Places select, the editor parses `addressComponents`
 *     into the Uber-shaped `{streetAddress, city, zipCode, country}` 4-tuple.
 *     If the parser rejects (non-FR country, zipCode not 5 digits, empty
 *     street), an inline error surfaces and NO state mutation happens.
 *   - **Slice 2** — Patch sent to `onSave` carries the COMPLETE 4-tuple (the
 *     backend slice 1 mutation `tenant.updateSettings` requires all-or-nothing,
 *     a half-patch with only `address` throws `INVALID_ADDRESS_PAYLOAD`).
 *   - **Slice 2** — When `value.address` is present but `value.addressLat` is
 *     `undefined` (legacy pre-slice-1 tenant), a yellow warning banner is
 *     rendered and the Save button stays disabled until the user re-selects
 *     a Places suggestion.
 *   - Inline form errors on `onSave` rejection (no swallow, no crash).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// Same `useForm` mock pattern as `branding-editor.test.tsx`.
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

// Mutable `useState` mock — slice 2 needs to drive `placesSelection` /
// `placesError` from tests. Each `useState` call gets a deterministic slot
// keyed by call order within a render; tests can set values BEFORE rendering
// by populating `stateSeeds` (consumed FIFO).
const stateMock = {
  seeds: [] as unknown[],
  initials: [] as unknown[],
  setters: [] as Array<(v: unknown) => void>,
};

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const seedAvailable = stateMock.seeds.length > 0;
      const v: T = seedAvailable
        ? (stateMock.seeds.shift() as T)
        : typeof initial === "function"
          ? (initial as () => T)()
          : initial;
      stateMock.initials.push(v);
      const setter = (next: T) => {
        stateMock.initials[stateMock.initials.length - 1] = next;
      };
      stateMock.setters.push(setter as (v: unknown) => void);
      return [v, setter];
    },
    useEffect: () => {},
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

const {
  CoordonneesEditor,
  isValidFrenchPhone,
  parseGooglePlacesToUberComponents,
} = await import("./coordonnees-editor");

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
type CoordonneesValueShape = {
  address?: string;
  addressLat?: number;
  addressLng?: number;
  addressComponents?: {
    streetAddress: string;
    city: string;
    zipCode: string;
    country: string;
  };
  phone?: string;
};

type CoordonneesPatchShape = CoordonneesValueShape;

function makeProps(
  overrides: {
    value?: CoordonneesValueShape;
    onSave?: (patch: CoordonneesPatchShape) => Promise<void>;
  } = {},
) {
  return {
    value: overrides.value ?? {},
    onSave: overrides.onSave ?? vi.fn(async () => {}),
  };
}

/**
 * Seed the `useState` mock for the next render. Call order matches the
 * editor's `useState` call order — slice 2 introduces three state slots:
 *  1. `submitError: string | null`
 *  2. `placesSelection: { address, addressLat, addressLng, addressComponents } | null`
 *  3. `placesError: string | null`
 *
 * Pass `undefined` to defer to the editor's default initial value for that
 * slot.
 */
function seedState(...values: unknown[]): void {
  stateMock.seeds.push(...values);
}

function resetStateMock(): void {
  stateMock.seeds.length = 0;
  stateMock.initials.length = 0;
  stateMock.setters.length = 0;
}

const PARIS_VALID = {
  address: "12 rue de la Paix, 75002 Paris, France",
  addressLat: 48.869,
  addressLng: 2.331,
  addressComponents: {
    streetAddress: "12 rue de la Paix",
    city: "Paris",
    zipCode: "75002",
    country: "FR",
  },
};

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

  it("exports the pure FR-phone validator so it can be unit-tested in isolation", () => {
    expect(typeof isValidFrenchPhone).toBe("function");
  });

  it("exports the pure Google Places → Uber components parser (slice 2)", () => {
    expect(typeof parseGooglePlacesToUberComponents).toBe("function");
  });

  it("Slice 2 — uses Google Places via dynamic import in a useEffect (NEVER a top-level static import) — required for SSR (cf. googlemaps-loader-ssr-bug memory)", () => {
    const code = stripNonCode(EDITOR_SOURCE);
    // No top-level static `import` of @googlemaps/js-api-loader. Allow the
    // dynamic `import("@googlemaps/js-api-loader")` form only.
    expect(code).not.toMatch(
      /^import[^;\n]+from\s+["']@googlemaps\/js-api-loader["']/m,
    );
    // BUT the editor MUST reference the loader at some point (sanity check
    // that the slice was actually wired).
    expect(code).toMatch(/@googlemaps\/js-api-loader/);
  });
});

// ---------------------------------------------------------------------------
// Pure FR-phone validator (unchanged from slice F-PARAMETRES-03).
// ---------------------------------------------------------------------------
describe("isValidFrenchPhone — FR mobile / landline format (AC)", () => {
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

  it("accepts the international +33 prefix", () => {
    expect(isValidFrenchPhone("+33612345678")).toBe(true);
    expect(isValidFrenchPhone("+33 6 12 34 56 78")).toBe(true);
    expect(isValidFrenchPhone("+33 1 23 45 67 89")).toBe(true);
  });

  it("accepts dots and dashes as separators", () => {
    expect(isValidFrenchPhone("06.12.34.56.78")).toBe(true);
    expect(isValidFrenchPhone("06-12-34-56-78")).toBe(true);
  });

  it("rejects wrong-length numbers", () => {
    expect(isValidFrenchPhone("06123456")).toBe(false);
    expect(isValidFrenchPhone("0612345678901")).toBe(false);
    expect(isValidFrenchPhone("")).toBe(false);
  });

  it("rejects 08 / 00 prefixes", () => {
    expect(isValidFrenchPhone("0812345678")).toBe(false);
    expect(isValidFrenchPhone("0012345678")).toBe(false);
  });

  it("rejects missing 0 / +33 prefix", () => {
    expect(isValidFrenchPhone("612345678")).toBe(false);
    expect(isValidFrenchPhone("1234567890")).toBe(false);
  });

  it("rejects non-numeric content", () => {
    expect(isValidFrenchPhone("06 12 34 56 7A")).toBe(false);
    expect(isValidFrenchPhone("06/12/34/56/78")).toBe(false);
    expect(isValidFrenchPhone("abcd")).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(isValidFrenchPhone("   ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Slice 2 — Pure Google Places → Uber components parser
// ---------------------------------------------------------------------------
type FakeComponent = {
  types: string[];
  longText: string | null;
  shortText: string | null;
};

function comp(
  types: string[],
  longText: string | null,
  shortText?: string | null,
): FakeComponent {
  return { types, longText, shortText: shortText ?? longText };
}

describe("parseGooglePlacesToUberComponents — slice 2", () => {
  it("parses a valid Paris address: street_number + route → streetAddress, locality → city, postal_code → zipCode, country shortText → country", () => {
    const result = parseGooglePlacesToUberComponents([
      comp(["street_number"], "12"),
      comp(["route"], "rue de la Paix"),
      comp(["locality", "political"], "Paris"),
      comp(["postal_code"], "75002"),
      comp(["country", "political"], "France", "FR"),
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        streetAddress: "12 rue de la Paix",
        city: "Paris",
        zipCode: "75002",
        country: "FR",
      },
    });
  });

  it("falls back to postal_town when `locality` is absent (UK-style addresses surface this in FR border edge cases)", () => {
    const result = parseGooglePlacesToUberComponents([
      comp(["street_number"], "5"),
      comp(["route"], "rue du Test"),
      comp(["postal_town"], "Strasbourg"),
      comp(["postal_code"], "67000"),
      comp(["country", "political"], "France", "FR"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.city).toBe("Strasbourg");
    }
  });

  it("rejects a non-FR country (US shortText)", () => {
    const result = parseGooglePlacesToUberComponents([
      comp(["street_number"], "1"),
      comp(["route"], "Infinite Loop"),
      comp(["locality"], "Cupertino"),
      comp(["postal_code"], "95014"),
      comp(["country"], "United States", "US"),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.toLowerCase()).toMatch(/france|fr|non livrable/);
    }
  });

  it("rejects an empty streetAddress (no street_number AND no route)", () => {
    const result = parseGooglePlacesToUberComponents([
      comp(["locality"], "Paris"),
      comp(["postal_code"], "75002"),
      comp(["country"], "France", "FR"),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects a zipCode not matching the FR 5-digit pattern", () => {
    const result = parseGooglePlacesToUberComponents([
      comp(["street_number"], "12"),
      comp(["route"], "rue de la Paix"),
      comp(["locality"], "Paris"),
      comp(["postal_code"], "750AB"),
      comp(["country"], "France", "FR"),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects when zipCode is missing entirely", () => {
    const result = parseGooglePlacesToUberComponents([
      comp(["street_number"], "12"),
      comp(["route"], "rue de la Paix"),
      comp(["locality"], "Paris"),
      comp(["country"], "France", "FR"),
    ]);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rendering branches
// ---------------------------------------------------------------------------
describe("CoordonneesEditor — rendering branches", () => {
  it("renders the labels « Adresse » and « Téléphone » + the Enregistrer button", () => {
    resetStateMock();
    const tree = serialize(CoordonneesEditor(makeProps()));
    const text = allText(tree);
    expect(text).toMatch(/Adresse/);
    expect(text).toMatch(/T[ée]l[ée]phone/);
    expect(text).toMatch(/Enregistrer/);
  });

  it("renders a stable data-slot on each load-bearing element (form / places container / phone input / save button)", () => {
    resetStateMock();
    const tree = serialize(CoordonneesEditor(makeProps()));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-coordonnees-form");
    expect(slots).toContain("parametres-coordonnees-places-container");
    expect(slots).toContain("parametres-coordonnees-phone-input");
    expect(slots).toContain("parametres-coordonnees-save");
  });

  it("seeds the form with the persisted phone value (address is mounted as a Places element, not a controlled input)", () => {
    resetStateMock();
    serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            ...PARIS_VALID,
            phone: "0612345678",
          },
        }),
      ),
    );
    expect(formMock.values.phone).toBe("0612345678");
  });

  it("surfaces inline phone-format error when the current phone is invalid", () => {
    resetStateMock();
    const tree = serialize(
      CoordonneesEditor(makeProps({ value: { phone: "abcd" } })),
    );
    const text = allText(tree);
    expect(text.toLowerCase()).toMatch(/invalide|format/);
    expect(dataSlots(tree)).toContain("parametres-coordonnees-phone-error");
  });

  it("Slice 2 — Save button DISABLED when the value is empty (no Places selection yet, no phone diff)", () => {
    resetStateMock();
    const tree = serialize(CoordonneesEditor(makeProps({ value: {} })));
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).toBe(true);
    }
  });

  it("Slice 2 — Save button DISABLED when phone is invalid (even with a Places selection cached)", () => {
    resetStateMock();
    // submitError=null, placesSelection=valid Paris, placesError=null
    seedState(null, PARIS_VALID, null);
    const tree = serialize(
      CoordonneesEditor(makeProps({ value: { phone: "abcd" } })),
    );
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).toBe(true);
    }
  });

  it("Slice 2 — Save button ENABLED when a Places selection has been made AND phone is valid", () => {
    resetStateMock();
    // submitError=null, placesSelection=valid Paris, placesError=null
    seedState(null, PARIS_VALID, null);
    const tree = serialize(
      CoordonneesEditor(makeProps({ value: { phone: "06 12 34 56 78" } })),
    );
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).not.toBe(true);
    }
  });

  it("Slice 2 — Save button ENABLED when only the phone has changed (existing 4-tuple address already in `value`)", () => {
    resetStateMock();
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            ...PARIS_VALID,
            phone: "0102030405",
          },
        }),
      ),
    );
    // No Places selection has been made; only the phone was edited.
    formMock.values = { phone: "0612345678" };
    // Re-render to consult the latest form values.
    resetStateMock();
    const reTree = serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            ...PARIS_VALID,
            phone: "0102030405",
          },
        }),
      ),
    );
    const saveBtn = findBySlot(reTree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).not.toBe(true);
    }
    formMock.values = {};
  });

  it("Slice 2 — Save button DISABLED when nothing has changed (4-tuple matches `value` AND phone unchanged)", () => {
    resetStateMock();
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            ...PARIS_VALID,
            phone: "0612345678",
          },
        }),
      ),
    );
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).toBe(true);
    }
  });

  it("Slice 2 — Renders a legacy warning banner when `value.address` is present but `value.addressLat` is undefined (pre-slice-1 tenant)", () => {
    resetStateMock();
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: { address: "12 rue legacy, Paris" },
        }),
      ),
    );
    expect(dataSlots(tree)).toContain("parametres-coordonnees-legacy-warning");
    const text = allText(tree);
    expect(text.toLowerCase()).toMatch(/re-?saisir|recherche|livraison/);
  });

  it("Slice 2 — Save button DISABLED while the legacy warning is showing AND no Places selection has been made", () => {
    resetStateMock();
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            address: "12 rue legacy, Paris",
            phone: "0612345678",
          },
        }),
      ),
    );
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).toBe(true);
    }
  });

  it("Slice 2 — Save button ENABLED while the legacy warning is showing AND a Places selection has been made", () => {
    resetStateMock();
    seedState(null, PARIS_VALID, null);
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            address: "12 rue legacy, Paris",
            phone: "0612345678",
          },
        }),
      ),
    );
    const saveBtn = findBySlot(tree, "parametres-coordonnees-save");
    expect(saveBtn).not.toBeNull();
    if (saveBtn !== null && !("text" in saveBtn)) {
      expect(saveBtn.props["disabled"]).not.toBe(true);
    }
  });

  it("Slice 2 — Surfaces the placesError banner when set (non-FR rejection feedback)", () => {
    resetStateMock();
    seedState(
      null,
      null,
      "Adresse non livrable (France métropolitaine uniquement).",
    );
    const tree = serialize(CoordonneesEditor(makeProps()));
    expect(dataSlots(tree)).toContain("parametres-coordonnees-places-error");
    const text = allText(tree);
    expect(text.toLowerCase()).toMatch(/non livrable|france/);
  });
});

// ---------------------------------------------------------------------------
// Save flow — 4-tuple all-or-nothing
// ---------------------------------------------------------------------------
describe("CoordonneesEditor — save flow (slice 2 — 4-tuple)", () => {
  it("Slice 2 — onSave receives the COMPLETE 4-tuple when a Places selection has been made (address+lat+lng+components together)", async () => {
    resetStateMock();
    const onSave = vi.fn(async () => {});
    // submitError=null, placesSelection=valid Paris, placesError=null.
    seedState(null, PARIS_VALID, null);
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: { phone: "0612345678" },
          onSave,
        }),
      ),
    );
    formMock.values = { phone: "0612345678" };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      address: PARIS_VALID.address,
      addressLat: PARIS_VALID.addressLat,
      addressLng: PARIS_VALID.addressLng,
      addressComponents: PARIS_VALID.addressComponents,
    });
    formMock.values = {};
  });

  it("Slice 2 — onSave includes phone when phone changed AND a Places selection happened (full 5-tuple)", async () => {
    resetStateMock();
    const onSave = vi.fn(async () => {});
    seedState(null, PARIS_VALID, null);
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: { phone: "0102030405" },
          onSave,
        }),
      ),
    );
    formMock.values = { phone: "06 12 34 56 78" };
    const formNode = findBySlot(tree, "parametres-coordonnees-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      address: PARIS_VALID.address,
      addressLat: PARIS_VALID.addressLat,
      addressLng: PARIS_VALID.addressLng,
      addressComponents: PARIS_VALID.addressComponents,
      phone: "06 12 34 56 78",
    });
    formMock.values = {};
  });

  it("Slice 2 — onSave receives ONLY phone when the address 4-tuple matches `value` (no Places re-pick needed)", async () => {
    resetStateMock();
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            ...PARIS_VALID,
            phone: "0102030405",
          },
          onSave,
        }),
      ),
    );
    formMock.values = { phone: "0612345678" };
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

  it("Slice 2 — onSave is NEVER called on empty patch (no change)", async () => {
    resetStateMock();
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      CoordonneesEditor(
        makeProps({
          value: {
            ...PARIS_VALID,
            phone: "0612345678",
          },
          onSave,
        }),
      ),
    );
    formMock.values = { phone: "0612345678" };
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

  it("Slice 2 — onSave is NEVER called when phone is invalid (mirrors the disabled button — defense in depth)", async () => {
    resetStateMock();
    const onSave = vi.fn(async () => {});
    seedState(null, PARIS_VALID, null);
    const tree = serialize(
      CoordonneesEditor(makeProps({ value: { phone: "0612345678" }, onSave })),
    );
    formMock.values = { phone: "not a phone" };
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

  it("Slice 2 — onSave rejection surfaces an inline error (no swallow, no crash)", async () => {
    resetStateMock();
    const failure = new Error("FORBIDDEN: no access to this tenant");
    const onSave = vi.fn(async () => {
      throw failure;
    });
    seedState(null, PARIS_VALID, null);
    const tree = serialize(CoordonneesEditor(makeProps({ value: {}, onSave })));
    formMock.values = { phone: "0612345678" };
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
