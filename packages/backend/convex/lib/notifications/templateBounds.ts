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

/**
 * 2.7-D — interpolate a template body with the campaign variable values. Each
 * `{name}` placeholder is replaced by `values[name]`; an unfilled placeholder is
 * left as the empty string (the resto picked a template; a missing value is a
 * benign blank, not a crash). PURE — no Convex ctx.
 */
export function renderTemplate(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(VARIABLE_PATTERN, (_match, name: string) =>
    name in values ? values[name] : "",
  );
}

/**
 * 2.7-D — the SEND-TIME guardrail (PRD 80 §4 / ADR 0006): bound the FINAL rendered
 * message a tenant campaign would push. Re-checks the discount cap against the
 * VALUE the resto filled in (`{discount}`) — the schema's `maxDiscountPercent` is
 * the template's declared cap, but the resto could fill a higher number — and the
 * rendered length, language and alcohol flag. Returns the FIRST violation, else
 * `null`. PURE — the campaign mutation turns a non-null result into a throw.
 */
export function findRenderedViolation(input: {
  rendered: string;
  values: Record<string, string>;
  language: string;
  containsAlcohol: boolean;
}): TemplateBoundViolation | null {
  // Discount filled by the resto must respect the cap (anti "-80 %").
  const discountRaw = input.values.discount;
  if (discountRaw !== undefined && discountRaw !== "") {
    const discount = Number.parseInt(discountRaw, 10);
    if (Number.isFinite(discount) && discount > MAX_DISCOUNT_PERCENT) {
      return "DISCOUNT_TOO_HIGH";
    }
  }
  if (input.rendered.length >= MAX_RENDERED_LENGTH) return "BODY_TOO_LONG";
  if (input.language !== TEMPLATE_LANGUAGE) return "NOT_FRENCH";
  if (input.containsAlcohol) return "ALCOHOL_NOT_ALLOWED";
  return null;
}
