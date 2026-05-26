import { describe, expect, it } from "vitest";
import { generateContractHtml } from "./generateContract";
import type { PartnerFiche } from "./generateContract";

/**
 * 2.9-D — `generateContractHtml` PURE-function tests (PRD 70 §3.5, kb-admin
 * CONTEXT "Contrat HTML", contrat_template.md), written BEFORE the implementation
 * (TDD red).
 *
 * The function is the TypeScript port of the canonical `contrat_template.md`
 * (Convex can't run `generate_contract.py`). It must:
 *  - fill the 5 Partenaire placeholders (raison sociale / SIRET / adresse / email
 *    / représentant) from the partner fiche,
 *  - include/exclude the `prestation_A` / `prestation_B` conditional blocks per the
 *    selected `prestation`, handling the NESTED markers (a `prestation_A` block
 *    sits inside a `prestation_B` block in §1.3 / §3.1),
 *  - leave NO residual `<!-- BEGIN/END -->` markers and NO leftover Partenaire
 *    blanks.
 *
 * Assertions are ROBUST (presence/absence of stable Stripe / Uber-Direct /
 * marque-concédée landmark sentences), not a fragile exact-diff of the whole doc.
 */

// Stable landmark substrings that appear ONLY inside a given conditional block.
// `prestation_A` only — the marque-concédée IP article (Article 4).
const A_ONLY = "Propriété intellectuelle (Prestation A)";
// `prestation_B` only — the Stripe PSP definition (Article 1.1, B block).
const B_ONLY = "STRIPE PAYMENTS EUROPE, LIMITED";
// The NESTED `prestation_A`-inside-`prestation_B` fragment of §3.1 (only present
// when BOTH prestations are selected).
const NESTED_A_IN_B =
  "qu'elles soient passées sous la marque concédée ou sous l'enseigne native du Partenaire";

const partner: PartnerFiche = {
  raisonSociale: "Buns and Bao SARL",
  siret: "98765432100012",
  adresse: "12 rue de la Paix, 91000 Évry",
  email: "khan@bunsandbao.fr",
  representant: "Khan Diallo",
};

describe("2.9-D generateContractHtml — pure template port", () => {
  it("fills every Partenaire placeholder from the fiche", () => {
    const html = generateContractHtml({ prestation: "A_AND_B", partner });
    expect(html).toContain(partner.raisonSociale);
    expect(html).toContain(partner.siret);
    expect(html).toContain(partner.adresse);
    expect(html).toContain(partner.email);
    expect(html).toContain(partner.representant);
  });

  it("leaves NO residual conditional markers", () => {
    for (const prestation of ["A", "B", "A_AND_B"] as const) {
      const html = generateContractHtml({ prestation, partner });
      expect(html).not.toContain("<!-- BEGIN");
      expect(html).not.toContain("<!-- END");
      expect(html).not.toContain("prestation_A");
      expect(html).not.toContain("prestation_B");
    }
  });

  it("leaves NO leftover Partenaire blank runs (the substituted fields)", () => {
    const html = generateContractHtml({ prestation: "A_AND_B", partner });
    // The Partenaire identity block's escaped-underscore blanks must be gone.
    expect(html).not.toContain("(raison sociale)");
    expect(html).not.toMatch(/SIRET\s*:\s*\\?_\\?_/);
    expect(html).not.toMatch(/Email\s*:\s*\\?_\\?_/);
    expect(html).not.toMatch(/Adresse\s*:\s*\\?_\\?_/);
  });

  it("prestation A → contains the A blocks and NONE of the B blocks", () => {
    const html = generateContractHtml({ prestation: "A", partner });
    expect(html).toContain(A_ONLY);
    expect(html).not.toContain(B_ONLY);
    // The nested A-in-B fragment lives inside a B block, so it must be absent.
    expect(html).not.toContain(NESTED_A_IN_B);
    // The unconditional spine survives (Article 2 — Responsabilités du Partenaire).
    expect(html).toContain("Responsabilités du Partenaire");
  });

  it("prestation B → contains the B blocks and NONE of the A blocks", () => {
    const html = generateContractHtml({ prestation: "B", partner });
    expect(html).toContain(B_ONLY);
    expect(html).not.toContain(A_ONLY);
    // The nested A-in-B fragment is an A block; with only B selected it is excluded.
    expect(html).not.toContain(NESTED_A_IN_B);
    // Article 2 ter (titularité base clients, B only) is present.
    expect(html).toContain("Titularité de la base de données clients finaux");
  });

  it("prestation A_AND_B → contains BOTH blocks, including the nested A-in-B fragment", () => {
    const html = generateContractHtml({ prestation: "A_AND_B", partner });
    expect(html).toContain(A_ONLY);
    expect(html).toContain(B_ONLY);
    // Nested marker handling: the A fragment inside the B paragraph survives.
    expect(html).toContain(NESTED_A_IN_B);
  });

  it("is pure — same input yields identical output, no DB / ctx", () => {
    const a = generateContractHtml({ prestation: "A", partner });
    const b = generateContractHtml({ prestation: "A", partner });
    expect(a).toBe(b);
  });

  it("escapes HTML-significant chars in fiche values (no injection)", () => {
    const html = generateContractHtml({
      prestation: "A",
      partner: { ...partner, raisonSociale: "Bad <script>alert(1)</script>" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
