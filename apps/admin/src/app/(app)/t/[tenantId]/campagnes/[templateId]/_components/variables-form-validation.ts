/**
 * F-CAMPAGNES [3/7] (#205) — pure validation module for the per-template
 * variable form (parent EPIC #145, ADR 0006 / PRD 80 §4).
 *
 * MIRROR, not duplicate, of the SEND-TIME backend re-check
 * (`findRenderedViolation` inside `sendTenantCampaign`): this module's job
 * is to PRE-EMPT the obvious mistakes at the input edge so the
 * « Envoyer maintenant » button stays disabled until everything is clean
 * (issue body AC), and the gérant sees inline what's wrong before they
 * hit a server-side `TEMPLATE_BOUND_VIOLATION`. The hard barrier remains
 * the backend.
 *
 * Pure — no React, no Convex, no I/O. Imported by `VariablesForm.tsx`.
 *
 * Constants
 *   - `MAX_INPUT_LENGTH = 80` — conservative per-field cap so a single
 *     long input still leaves room for boilerplate under
 *     `MAX_RENDERED_LENGTH = 200` (backend `templateBounds.ts`).
 *   - `FORBIDDEN_ALCOHOL_WORDS` — closed FR short list, ADR 0006 « pas de
 *     mention alcool ». Word-boundary matched so « vinaigrette » (which
 *     contains « vin ») is NOT a false positive.
 *
 * Bounds
 *   - text variables: length ≤ 80; no FR alcohol word.
 *   - `discount`: integer 0..50 (mirror of `MAX_DISCOUNT_PERCENT`).
 *   - `heure_debut` / `heure_fin`: valid 24h HH:MM.
 *
 * Empty string is a benign blank everywhere (mirror of `renderTemplate`,
 * which substitutes a missing value with the empty string).
 */

// Import from the pure submodule, not the barrel: the barrel re-exports
// `engine.ts` which transitively pulls in `getCurrentActor.ts` (defines
// `whoAmI = query(...)`), so any value-import from the barrel forces the
// browser bundler to evaluate server-only Convex code. `templateBounds.ts`
// is a pure module with no Convex ctx — safe for client surfaces.
import { MAX_DISCOUNT_PERCENT } from "@packages/backend/convex/lib/notifications/templateBounds";

/**
 * Conservative per-field length cap (chars). The send-time rendered cap on
 * the backend is 200 (`MAX_RENDERED_LENGTH`); we cap each individual input
 * at 80 so even worst-case interpolation (one long input + boilerplate)
 * stays well under the rendered cap.
 */
export const MAX_INPUT_LENGTH = 80;

/**
 * Canonical FR short list of forbidden alcohol words (ADR 0006). Closed V1
 * set — kept explicit so an expansion is a code change (and reviewed)
 * rather than a config drift. Includes both accented and non-accented
 * forms (« bière » / « biere ») so the matcher catches both regardless of
 * how the gérant typed it.
 */
export const FORBIDDEN_ALCOHOL_WORDS = [
  "vin",
  "bière",
  "biere",
  "alcool",
  "champagne",
  "whisky",
  "vodka",
  "rhum",
  "cocktail",
] as const;

/** A bound violation reason, or `null` when the value respects every bound. */
export type VariableValidationViolation =
  | "INPUT_TOO_LONG"
  | "ALCOHOL_NOT_ALLOWED"
  | "DISCOUNT_TOO_HIGH"
  | "DISCOUNT_INVALID"
  | "TIME_INVALID";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Word-boundary-aware alcohol matcher. We can't rely on `\b` for accented
 * chars (it treats `é` / `è` as non-word in JS regex), so we manually scan
 * for each forbidden word delimited by either string edges or characters
 * that are NEITHER letters NOR digits.
 *
 * Returns `true` iff at least one forbidden alcohol word appears as a full
 * word in `text` (case-insensitive). « vinaigrette » does NOT match « vin »
 * because the next char (`a`) is a letter — extends the word boundary.
 */
function containsForbiddenAlcoholWord(text: string): boolean {
  const lower = text.toLowerCase();
  const isLetterOrDigit = (ch: string): boolean => {
    if (ch === undefined) return false;
    // Latin letters (incl. accented FR chars), digits.
    return /[\p{L}\p{N}]/u.test(ch);
  };
  for (const word of FORBIDDEN_ALCOHOL_WORDS) {
    const w = word.toLowerCase();
    let from = 0;
    while (from <= lower.length - w.length) {
      const idx = lower.indexOf(w, from);
      if (idx === -1) break;
      const before = idx === 0 ? "" : lower[idx - 1];
      const after = idx + w.length >= lower.length ? "" : lower[idx + w.length];
      if (!isLetterOrDigit(before) && !isLetterOrDigit(after)) {
        return true;
      }
      from = idx + 1;
    }
  }
  return false;
}

/**
 * Validate a single variable value against its bounds. Returns the FIRST
 * violation reason, or `null` if everything passes. Empty string is always
 * accepted (benign blank — mirror of `renderTemplate`).
 *
 * The `name` parameter is the variable identifier (e.g. `"discount"`,
 * `"prenom_client"`); branching on it picks the right rule set. Unknown
 * names fall through as text inputs — the form only ever calls this with
 * a declared template variable (closed V1 set).
 */
export function validateVariableValue(
  name: string,
  value: string,
): VariableValidationViolation | null {
  if (value === "") return null;

  if (name === "discount") {
    const n = Number(value);
    if (!Number.isFinite(n) || !/^[0-9]+$/.test(value)) {
      return "DISCOUNT_INVALID";
    }
    if (n > MAX_DISCOUNT_PERCENT) return "DISCOUNT_TOO_HIGH";
    return null;
  }

  if (name === "heure_debut" || name === "heure_fin") {
    return TIME_PATTERN.test(value) ? null : "TIME_INVALID";
  }

  // Text inputs: prenom_client, nom_resto, item_hero, nom_plat, jour.
  if (value.length > MAX_INPUT_LENGTH) return "INPUT_TOO_LONG";
  if (containsForbiddenAlcoholWord(value)) return "ALCOHOL_NOT_ALLOWED";
  return null;
}
