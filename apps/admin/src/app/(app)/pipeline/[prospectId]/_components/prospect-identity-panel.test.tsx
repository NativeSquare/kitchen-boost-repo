/**
 * F-PIPELINE-CRM 07 (#256) — `ProspectIdentityPanel` test matrix.
 *
 * Pure presentational shell that renders the identity block at the top of
 * the prospect fiche (`/pipeline/[prospectId]`). Same React-tree-serializer
 * pattern as `prospect-fiche-view.test.tsx` — admin vitest runs `node` env
 * (no jsdom). We expand the React tree to plain nodes and assert on text.
 *
 * Issue #256 « Panneau identité (haut de fiche) — Nom, SIRET, adresse,
 *  contact (nom gérant), email, téléphone, Phase courante (badge coloré),
 *  Source d'acquisition, Score, tabletteMode ».
 *
 * Pins:
 *   - all listed fields surface when present
 *   - absent optional fields don't print "undefined" garbage
 *   - phase badge surfaces the canonical phase label
 *   - source label is one of the 4 acquisition channels (PRD 70 §3.3)
 */
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { ProspectIdentityPanel } from "./prospect-identity-panel";
import { allText, serialize } from "../../_components/test-utils";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

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

describe("ProspectIdentityPanel — F-PIPELINE-CRM 07 (#256)", () => {
  it("renders the prospect name", () => {
    const tree = serialize(
      ProspectIdentityPanel({ prospect: makeProspect({ name: "Mon Resto" }) }),
    );
    expect(allText(tree)).toContain("Mon Resto");
  });

  it("renders the phone (always present per schema)", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({ phone: "0712345678" }),
      }),
    );
    expect(allText(tree)).toContain("0712345678");
  });

  it("renders all optional identity fields when present (SIRET, address, contact, email)", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({
          siret: "12345678900012",
          address: "10 rue de la Paix, 75002 Paris",
          contactName: "Jean Dupont",
          email: "contact@lartisan.fr",
        }),
      }),
    );
    const text = allText(tree);
    expect(text).toContain("12345678900012");
    expect(text).toContain("10 rue de la Paix");
    expect(text).toContain("Jean Dupont");
    expect(text).toContain("contact@lartisan.fr");
  });

  it("does NOT render 'undefined' garbage when optional fields are absent", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({
          siret: undefined,
          address: undefined,
          contactName: undefined,
          email: undefined,
          score: undefined,
          tabletteMode: undefined,
        }),
      }),
    );
    const text = allText(tree);
    expect(text).not.toMatch(/undefined/i);
    expect(text).not.toMatch(/NaN/);
  });

  it("renders the phase as a badge — preparation surfaces « Préparation »", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({ phase: "preparation" }),
      }),
    );
    expect(allText(tree)).toMatch(/pr[ée]paration/i);
  });

  it("renders the source label — cold_call → « Cold call »", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({ source: "cold_call" }),
      }),
    );
    expect(allText(tree)).toMatch(/cold\s*call/i);
  });

  it("renders the score when set", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({ score: 7 }),
      }),
    );
    expect(allText(tree)).toContain("7");
  });

  it("renders the tabletteMode label when set — achat_kb surfaces an FR label", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({ tabletteMode: "achat_kb" }),
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/tablette/i);
    expect(text).toMatch(/achat|KB/i);
  });

  it("renders an FR label for tabletteMode=appareil_existant", () => {
    const tree = serialize(
      ProspectIdentityPanel({
        prospect: makeProspect({ tabletteMode: "appareil_existant" }),
      }),
    );
    expect(allText(tree)).toMatch(/appareil|existant|BYOD/i);
  });
});
