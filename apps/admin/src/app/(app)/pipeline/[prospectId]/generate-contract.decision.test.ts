/**
 * F-CONTRATS slice 3/4 (#174) — `decideGenerateContract` decision matrix.
 *
 * Pure function — pinned in node env, no React. Mirrors the discipline of
 * `prospect-fiche.decision.test.ts` / `provision-launcher.decision.test.ts`.
 *
 * Branches:
 *   - prospect `undefined`                 → `loading`.
 *   - prospect `null`                      → `not-found`.
 *   - prospect hydrated, every juridical
 *     field present                        → `ready { canGenerate: true,
 *                                                     partner: {...} }`.
 *   - prospect hydrated, one+ field missing→ `ready { canGenerate: false,
 *                                                     partner: null,
 *                                                     missingFields: [...] }`.
 *   - prospect hydrated, fields are
 *     whitespace-only                      → treated as missing (trim guard).
 */
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import {
  decideGenerateContract,
  JURIDICAL_FIELDS,
} from "./generate-contract.decision";

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

describe("decideGenerateContract — F-CONTRATS slice 3/4 (#174)", () => {
  it("returns `loading` when the prospect query is in-flight (undefined)", () => {
    const d = decideGenerateContract({ prospect: undefined });
    expect(d.kind).toBe("loading");
  });

  it("returns `not-found` when the prospect doesn't exist (null)", () => {
    const d = decideGenerateContract({ prospect: null });
    expect(d.kind).toBe("not-found");
  });

  it("returns `ready` with `canGenerate: true` + a full partner payload when every juridical field is present", () => {
    const d = decideGenerateContract({ prospect: makeProspect() });
    expect(d.kind).toBe("ready");
    if (d.kind !== "ready") throw new Error("expected ready");
    expect(d.canGenerate).toBe(true);
    expect(d.missingFields).toEqual([]);
    expect(d.partner).toEqual({
      raisonSociale: "Buns and Bao",
      siret: "98765432100012",
      adresse: "12 rue de la Paix, 91000 Évry",
      email: "khan@bunsandbao.fr",
      representant: "Khan Diallo",
    });
  });

  it("returns a recap row for each of the 5 juridical fields, in canonical order", () => {
    const d = decideGenerateContract({ prospect: makeProspect() });
    if (d.kind !== "ready") throw new Error("expected ready");
    expect(d.recap.map((r) => r.field)).toEqual([
      "raisonSociale",
      "siret",
      "adresse",
      "email",
      "representant",
    ]);
    // Order MUST match JURIDICAL_FIELDS (single source of truth).
    expect(d.recap.map((r) => r.field)).toEqual([...JURIDICAL_FIELDS]);
    // Every row is `present` when fully filled.
    expect(d.recap.every((r) => r.present)).toBe(true);
  });

  it("flags `siret` as missing when the prospect has no SIRET (canGenerate: false, partner: null)", () => {
    const d = decideGenerateContract({
      prospect: makeProspect({ siret: undefined }),
    });
    if (d.kind !== "ready") throw new Error("expected ready");
    expect(d.canGenerate).toBe(false);
    expect(d.partner).toBeNull();
    expect(d.missingFields).toEqual(["siret"]);
    const siretRow = d.recap.find((r) => r.field === "siret");
    expect(siretRow?.present).toBe(false);
    expect(siretRow?.value).toBe("");
  });

  it("flags every optional field as missing when the prospect is a fresh CRM stub (only name + phone)", () => {
    const d = decideGenerateContract({
      prospect: makeProspect({
        siret: undefined,
        address: undefined,
        email: undefined,
        contactName: undefined,
      }),
    });
    if (d.kind !== "ready") throw new Error("expected ready");
    expect(d.canGenerate).toBe(false);
    expect(d.partner).toBeNull();
    // `raisonSociale` (← name) is still present; the 4 optional ones are missing.
    expect(d.missingFields).toEqual([
      "siret",
      "adresse",
      "email",
      "representant",
    ]);
    expect(d.recap.find((r) => r.field === "raisonSociale")?.present).toBe(
      true,
    );
  });

  it("treats whitespace-only fields as missing (trim guard against stale CRM data)", () => {
    const d = decideGenerateContract({
      prospect: makeProspect({
        siret: "   ",
        email: "\t\n",
      }),
    });
    if (d.kind !== "ready") throw new Error("expected ready");
    expect(d.canGenerate).toBe(false);
    expect(d.missingFields).toContain("siret");
    expect(d.missingFields).toContain("email");
  });

  it("normalises trimmed values into the partner payload (no surrounding whitespace leaks to the mutation)", () => {
    const d = decideGenerateContract({
      prospect: makeProspect({
        name: "  Buns and Bao  ",
        siret: "  98765432100012  ",
      }),
    });
    if (d.kind !== "ready") throw new Error("expected ready");
    expect(d.canGenerate).toBe(true);
    expect(d.partner?.raisonSociale).toBe("Buns and Bao");
    expect(d.partner?.siret).toBe("98765432100012");
  });
});
