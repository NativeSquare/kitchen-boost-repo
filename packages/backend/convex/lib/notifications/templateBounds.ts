/**
 * 2.7-A — DECLARATIVE bounds of a pre-validated campaign template (ADR 0006, PRD
 * 80 §4). 2.7-A only LAYS the fields + the declarative bounds; the runtime
 * enforcement at send time (interpolation + final-length check) is slice B. The
 * bound CONSTANTS and the pure checker defined here are the single source of
 * truth shared by the `notificationTemplates` validators (in `table/`) and the
 * later sender, so they cannot drift.
 *
 * The four guardrails are NOT invented — they are verbatim from ADR 0006 / PRD
 * 80 §4: `{discount}` ≤ 50 %, rendered length < 200 chars, French only, no
 * alcohol. The interpolable variable list is the closed V1 set documented in the
 * same sources + the notifications CONTEXT ("Template campagne").
 */

/** `{discount}` cap, anti "-50 % au lieu de -5 %" (ADR 0006 / PRD 80 §4). */
export const MAX_DISCOUNT_PERCENT = 50;

/**
 * Rendered message must stay UNDER this many chars (Wallet push + Web Push
 * coherence, ADR 0006 / PRD 80 §4 "< 200 chars"). A body that already reaches
 * 200 chars before interpolation can only grow, so it is rejected here too.
 */
export const MAX_RENDERED_LENGTH = 200;

/** V1 = French only (ADR 0006 / PRD 80 §4). I18n is V2/V3 (PRD 80 scope). */
export const TEMPLATE_LANGUAGE = "fr" as const;

/**
 * The closed V1 set of interpolable variables (ADR 0006 / PRD 80 §4 + the
 * notifications CONTEXT "Template campagne"). A template body may only reference
 * these names; an unknown `{placeholder}` is a configuration error.
 */
export const ALLOWED_TEMPLATE_VARIABLES = [
  "prenom_client",
  "nom_resto",
  "item_hero",
  "discount",
  "nom_plat",
  "heure_debut",
  "heure_fin",
  "jour",
] as const;

export type TemplateVariable = (typeof ALLOWED_TEMPLATE_VARIABLES)[number];

/** A bound violation reason, or `null` when the template respects every bound. */
export type TemplateBoundViolation =
  | "DISCOUNT_TOO_HIGH"
  | "BODY_TOO_LONG"
  | "NOT_FRENCH"
  | "ALCOHOL_NOT_ALLOWED"
  | "UNKNOWN_VARIABLE";

/** The fields a template carries that the declarative bounds constrain. */
export type TemplateBoundInput = {
  body: string;
  maxDiscountPercent: number;
  language: string;
  containsAlcohol: boolean;
};

const VARIABLE_PATTERN = /\{([a-z_]+)\}/g;
const ALLOWED = new Set<string>(ALLOWED_TEMPLATE_VARIABLES);

/**
 * Pure guardrail checker — returns the FIRST bound a template violates, else
 * `null`. Order is deterministic so the thrown error (slice B) is stable. Does
 * NOT interpolate values (that is slice B); it bounds the template DEFINITION:
 * discount cap, raw-body length ceiling, language, alcohol flag, and that every
 * `{placeholder}` is a known V1 variable.
 */
export function findTemplateBoundViolation(
  input: TemplateBoundInput,
): TemplateBoundViolation | null {
  if (input.maxDiscountPercent > MAX_DISCOUNT_PERCENT) {
    return "DISCOUNT_TOO_HIGH";
  }
  if (input.body.length >= MAX_RENDERED_LENGTH) {
    return "BODY_TOO_LONG";
  }
  if (input.language !== TEMPLATE_LANGUAGE) {
    return "NOT_FRENCH";
  }
  if (input.containsAlcohol) {
    return "ALCOHOL_NOT_ALLOWED";
  }
  for (const match of input.body.matchAll(VARIABLE_PATTERN)) {
    if (!ALLOWED.has(match[1])) {
      return "UNKNOWN_VARIABLE";
    }
  }
  return null;
}
