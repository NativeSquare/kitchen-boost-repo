/**
 * F-PIPELINE-CRM 08 (#263) — `EditProspectIdentityModal` test matrix.
 *
 * Pure presentational modal — V1 = formulaire global, pas d'édition inline
 * cellule-par-cellule (issue spec verbatim). Wraps `api.lib.onboarding.crm.editProspect`
 * via a connected wrapper (`EditProspectIdentityLauncher`) — the modal itself
 * is hook-free so it expands in the lean `node` env.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { EditProspectIdentityModal } from "./edit-prospect-identity-modal";
import { allText, flatten, serialize } from "../../_components/test-utils";

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
  overrides: Partial<Parameters<typeof EditProspectIdentityModal>[0]> = {},
) {
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
    // The form inputs carry the value either in their `value`/`defaultValue`
    // prop OR in the rendered tree text. Either way the prospect's current
    // values must be reachable from the serialized form.
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
