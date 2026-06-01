/**
 * F-PIPELINE-CRM 08 (#263) — `EditProspectIdentityModal` test matrix.
 *
 * Pure presentational modal — V1 = formulaire global, pas d'édition inline
 * cellule-par-cellule (issue spec verbatim). Wraps
 * `api.lib.onboarding.crm.editProspect` via a connected wrapper
 * (`EditProspectIdentityLauncher`) — the modal itself is hook-using
 * (`useState` for the form fields) so the test shims `useState` to a
 * first-render-only stub, same pattern as `generate-contract-modal.test.tsx`.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

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

const { EditProspectIdentityModal } =
  await import("./edit-prospect-identity-modal");
type EditProspectIdentityModalProps =
  import("./edit-prospect-identity-modal").EditProspectIdentityModalProps;

const { allText, flatten, serialize } =
  await import("../../_components/test-utils");

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

type SerializedShape = ReturnType<typeof serialize>;

function makeProspect(
  overrides: Partial<Doc<"prospects">> = {},
): Doc<"prospects"> {
  return {
    _id: PROSPECT_ID,
    _creationTime: 1_700_000_000_000,
    name: "L'Artisan",
    phone: "0612345678",
    phase: "acquisition",
    source: "cold_call",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<EditProspectIdentityModalProps> = {},
): EditProspectIdentityModalProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    prospect: makeProspect(),
    isSubmitting: false,
    submitError: null,
    onSubmit: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("EditProspectIdentityModal — F-PIPELINE-CRM 08 (#263)", () => {
  it("pre-fills the form inputs with the prospect's current values", () => {
    const tree = serialize(
      EditProspectIdentityModal(
        baseProps({
          prospect: makeProspect({
            name: "Mon Resto",
            siret: "12345678900012",
            address: "10 rue de la Paix",
            contactName: "Jean Dupont",
            email: "x@y.fr",
            phone: "0612345678",
            score: 7,
          }),
        }),
      ),
    );
    const text = allText(tree);
    // Pre-filled `value` props of the inputs surface via the serialized tree
    // (each input slot carries a `value` prop seeded by the prospect doc).
    expect(JSON.stringify(tree)).toContain("Mon Resto");
    expect(JSON.stringify(tree)).toContain("12345678900012");
    expect(JSON.stringify(tree)).toContain("Jean Dupont");
    expect(JSON.stringify(tree)).toContain("x@y.fr");
    expect(text).toMatch(/[ée]diter|identit[ée]/i);
  });

  it("renders all editable identity inputs (name/siret/address/contact/email/phone/source/score/tabletteMode)", () => {
    const tree = serialize(EditProspectIdentityModal(baseProps()));
    const slots = flatten(tree)
      .filter(
        (
          n,
        ): n is {
          type: string;
          props: Record<string, unknown>;
          children: SerializedShape[];
        } =>
          n !== null &&
          "type" in n &&
          typeof (n.props as Record<string, unknown>)["data-slot"] === "string",
      )
      .map((n) => n.props["data-slot"] as string);
    expect(slots).toContain("edit-prospect-name");
    expect(slots).toContain("edit-prospect-siret");
    expect(slots).toContain("edit-prospect-address");
    expect(slots).toContain("edit-prospect-contact-name");
    expect(slots).toContain("edit-prospect-email");
    expect(slots).toContain("edit-prospect-phone");
    expect(slots).toContain("edit-prospect-source");
    expect(slots).toContain("edit-prospect-score");
    expect(slots).toContain("edit-prospect-tablette-mode");
  });

  it("surfaces submitError inline when set", () => {
    const tree = serialize(
      EditProspectIdentityModal(baseProps({ submitError: "Server boom" })),
    );
    expect(allText(tree)).toContain("Server boom");
  });

  it("disables the submit button when isSubmitting is true", () => {
    const tree = serialize(
      EditProspectIdentityModal(baseProps({ isSubmitting: true })),
    );
    const submitBtns = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedShape[];
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "edit-prospect-submit",
    );
    expect(submitBtns[0]?.props["disabled"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wiring contract — pins the connected wrapper's mutation symbol.
// ---------------------------------------------------------------------------
const SOURCE = readFileSync(
  path.resolve(__dirname, "./edit-prospect-identity-modal.tsx"),
  "utf8",
);

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

const CODE = stripNonCode(SOURCE);

describe("EditProspectIdentityModal — F-PIPELINE-CRM 08 (#263) wiring", () => {
  it("the connected wrapper fires `api.lib.onboarding.crm.editProspect`", () => {
    expect(CODE).toMatch(/api\.lib\.onboarding\.crm\.editProspect/);
    expect(CODE).toMatch(/useMutation\(/);
  });

  it("never imports from `apps/web` or `apps/native` (scope discipline)", () => {
    expect(CODE).not.toMatch(/apps\/web/);
    expect(CODE).not.toMatch(/apps\/native/);
  });
});
