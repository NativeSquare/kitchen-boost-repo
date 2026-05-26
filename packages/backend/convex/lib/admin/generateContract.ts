import type { Infer } from "convex/values";
import type { contractPrestation } from "../../table/contracts";
import { CONTRACT_TEMPLATE_MD } from "./contractTemplate";

/**
 * 2.9-D — the PURE TypeScript port of `generate_contract.py` (PRD 70 §3.5,
 * kb-admin CONTEXT "Contrat HTML"). Convex can't run Python, so the canonical
 * `docs/legal/contrat_template.md` (bundled byte-faithful in `contractTemplate.ts`)
 * is rendered here. NO legal wording, marker, or placeholder is invented — this
 * is a faithful transcription of the template's two transformations:
 *
 *  1. CONDITIONAL BLOCKS — `<!-- BEGIN prestation_A -->` / `<!-- END prestation_A -->`
 *     (and `_B`) are kept or dropped according to the selected `prestation`. The
 *     markers NEST (a `prestation_A` block sits inside a `prestation_B` paragraph
 *     in §1.3 and §3.1), so inclusion is decided by a STACK: a span survives iff
 *     EVERY enclosing condition is selected.
 *  2. PARTENAIRE PLACEHOLDERS — the 5 blanks of the Partenaire identity block
 *     (raison sociale / SIRET / représentant / email / adresse) are filled from
 *     the partner fiche. Values are HTML-escaped (no injection). The signature-time
 *     blanks (lieu/date/signature, and the Concédant's own représentant) are NOT
 *     fiche data — they are completed at signature on Odoo (PRD 70 §3.5: "Pas de
 *     signature dans KB direct") — so they are deliberately left in place.
 *
 * The function is PURE (input → HTML; no DB, no ctx), so it is unit-testable in
 * isolation and reusable by the `generateContract` mutation (slice lifecycle).
 */

/** The prestation bundle to render (table/contracts.ts `contractPrestation`). */
export type Prestation = Infer<typeof contractPrestation>;

/**
 * The partner fiche fields that fill the Partenaire identity block (PRD 70 §3.5
 * "Inputs pré-remplis : raison sociale, SIRET, adresse, email, représentant").
 */
export type PartnerFiche = {
  raisonSociale: string;
  siret: string;
  adresse: string;
  email: string;
  representant: string;
};

export type GenerateContractInput = {
  prestation: Prestation;
  partner: PartnerFiche;
};

/** Which prestation_X conditions are active for a selection (handles A_AND_B). */
function activeConditions(prestation: Prestation): {
  A: boolean;
  B: boolean;
} {
  return {
    A: prestation === "A" || prestation === "A_AND_B",
    B: prestation === "B" || prestation === "A_AND_B",
  };
}

const MARKER_RE = /<!-- (BEGIN|END) prestation_(A|B) -->/g;

/**
 * Resolve the conditional markers against the selection. Walks the template with
 * a STACK of the conditions currently open; text is emitted only while EVERY open
 * condition is selected — so nested markers are honoured (an A block inside an
 * unselected B block is dropped with its parent). Throws if the markers are not
 * balanced (defence: never emit a half-resolved contract).
 */
function resolveConditionalBlocks(
  template: string,
  prestation: Prestation,
): string {
  const active = activeConditions(prestation);
  const stack: ("A" | "B")[] = [];
  // True iff every currently-open condition is selected.
  const allOpenSelected = () => stack.every((c) => active[c]);

  let out = "";
  let cursor = 0;
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null = MARKER_RE.exec(template);
  while (match !== null) {
    const [marker, kind, cond] = match;
    const condition = cond as "A" | "B";
    // Emit the text since the previous marker, only if currently visible.
    if (allOpenSelected()) {
      out += template.slice(cursor, match.index);
    }
    if (kind === "BEGIN") {
      stack.push(condition);
    } else {
      const top = stack.pop();
      if (top !== condition) {
        throw new Error(
          `Unbalanced conditional markers in contract template (END prestation_${condition}).`,
        );
      }
    }
    cursor = match.index + marker.length;
    match = MARKER_RE.exec(template);
  }
  if (stack.length !== 0) {
    throw new Error(
      "Unbalanced conditional markers in contract template (unclosed BEGIN).",
    );
  }
  // Trailing text after the last marker (top-level — always visible).
  out += template.slice(cursor);
  return out;
}

/** Minimal HTML-entity escaping for fiche values (no injection into the doc). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The Partenaire identity block is a fixed 5-line sequence in the template,
 * uniquely anchored by the `(raison sociale)` line (the Concédant block above it
 * has its values already filled, so it carries no such anchor). We rewrite the
 * whole block deterministically rather than matching each blank run (several
 * fields share the SAME blank pattern, so a blind blank-replace would be
 * ambiguous). The anchor lines are taken verbatim from contrat_template.md.
 */
const PARTENAIRE_BLOCK_RE =
  /\\_(?:\\_)* \(raison sociale\),\nSIRET : \\_(?:\\_)*\nReprésentée par : \\_(?:\\_)*\nEmail : \\_(?:\\_)*\nAdresse : \\_(?:\\_)*/;

function fillPartnerBlock(text: string, partner: PartnerFiche): string {
  if (!PARTENAIRE_BLOCK_RE.test(text)) {
    // The canonical block must be present — never silently emit unfilled blanks.
    throw new Error(
      "Partenaire identity block not found in contract template (template drift?).",
    );
  }
  // The value REPLACES the blank; the `(raison sociale)` hint annotation is
  // dropped (it only labelled the blank — the filled value carries the meaning).
  const filled =
    `${escapeHtml(partner.raisonSociale)},\n` +
    `SIRET : ${escapeHtml(partner.siret)}\n` +
    `Représentée par : ${escapeHtml(partner.representant)}\n` +
    `Email : ${escapeHtml(partner.email)}\n` +
    `Adresse : ${escapeHtml(partner.adresse)}`;
  return text.replace(PARTENAIRE_BLOCK_RE, filled);
}

/**
 * Render the contract for a partner + prestation selection (PURE). Resolves the
 * conditional blocks first, then fills the Partenaire placeholders, returning the
 * contract body (Markdown-derived HTML-safe text). No residual `<!-- BEGIN/END -->`
 * markers and no leftover Partenaire blanks remain.
 */
export function generateContractHtml(input: GenerateContractInput): string {
  const { prestation, partner } = input;
  const resolved = resolveConditionalBlocks(CONTRACT_TEMPLATE_MD, prestation);
  return fillPartnerBlock(resolved, partner);
}
