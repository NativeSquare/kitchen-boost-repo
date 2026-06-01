import type { Infer } from "convex/values";
import { Marked } from "marked";
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
 * Inline CSS for the rendered contract — kept minimal so the iframe (sandbox="")
 * surfaces a readable, printable document without external assets. System font,
 * centered narrow column, comfortable line-height, gentle headings. The style is
 * inlined inside the `<head>` so the HTML is self-contained (one `srcDoc` value,
 * no cross-origin fetch — sandbox-safe).
 */
const CONTRACT_STYLE = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #111111;
    background: #ffffff;
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
    line-height: 1.5;
    font-size: 14px;
  }
  h1, h2, h3, h4 { color: #111111; margin-top: 1.6em; margin-bottom: 0.6em; line-height: 1.25; }
  h1 { font-size: 1.6em; }
  h2 { font-size: 1.3em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.2em; }
  h3 { font-size: 1.1em; }
  p { margin: 0.6em 0; }
  ul, ol { padding-left: 1.4em; }
  li { margin: 0.25em 0; }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1.6em 0; }
  strong { color: #111111; }
  code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; }
  blockquote { border-left: 3px solid #1B7A3D; padding-left: 0.8em; color: #374151; }
`;

/**
 * Render the resolved + filled Markdown to HTML body content. We use a LOCAL
 * `Marked` instance (no global config mutation — keeps the function pure and
 * idempotent: same input → same output, no cross-call state). GFM stays on for
 * tables / strikethrough; `breaks: true` so the template's hard line-breaks
 * (e.g. the Concédant identity block lines) render as visible breaks rather
 * than being collapsed into a paragraph.
 *
 * `marked.parse` accepts a `string` overload (sync) when `async` is not enabled.
 * We assert through `String(...)` to keep the signature `string → string`.
 */
function markdownToHtml(md: string): string {
  const marked = new Marked({ gfm: true, breaks: true, async: false });
  const html = marked.parse(md) as string;
  return html;
}

/**
 * Wrap the rendered HTML body in a self-contained `<!doctype html>` document
 * with inline CSS. The iframe consumes this as `srcDoc` with `sandbox=""` —
 * no scripts, no remote assets, just a styled readable doc.
 */
function wrapHtmlDocument(bodyHtml: string): string {
  return (
    `<!doctype html>\n` +
    `<html lang="fr">\n` +
    `<head>\n` +
    `<meta charset="utf-8" />\n` +
    `<title>Contrat KitchenBoost</title>\n` +
    `<style>${CONTRACT_STYLE}</style>\n` +
    `</head>\n` +
    `<body>\n${bodyHtml}\n</body>\n</html>`
  );
}

/**
 * Render the contract for a partner + prestation selection (PURE). Resolves the
 * conditional blocks first, then fills the Partenaire placeholders, then converts
 * the resulting Markdown to a self-contained styled HTML document ready to feed
 * directly into the iframe's `srcDoc`. No residual `<!-- BEGIN/END -->` markers,
 * no leftover Partenaire blanks, no raw Markdown syntax in the output.
 *
 * Idempotent: a `Marked` instance is created per call (no shared mutable state),
 * so `generateContractHtml(x) === generateContractHtml(x)` holds.
 */
export function generateContractHtml(input: GenerateContractInput): string {
  const { prestation, partner } = input;
  const resolved = resolveConditionalBlocks(CONTRACT_TEMPLATE_MD, prestation);
  const filled = fillPartnerBlock(resolved, partner);
  const bodyHtml = markdownToHtml(filled);
  return wrapHtmlDocument(bodyHtml);
}
