/**
 * F-CAMPAGNES [4/7] (#215) — `renderTemplatePreview`, the FRONT MIRROR of the
 * backend send-time bound check (`packages/backend/convex/lib/notifications/
 * templateBounds.ts` :: `renderTemplate` + `findRenderedViolation`).
 *
 * Why a front mirror (vs. lazy-await the backend response): the « Envoyer
 * maintenant » button must enable/disable in REAL TIME as the gérant fills
 * the variable form (#215 AC). A roundtrip to Convex on every keystroke is
 * the wrong shape for that UX. The backend remains the HARD barrier
 * (`sendTenantCampaign` re-checks at send time, ADR 0006 / PRD 80 §4) — this
 * helper just PRE-EMPTS so the submit button reflects the truth before any
 * network call.
 *
 * The implementation REUSES the backend functions directly through the
 * workspace TS path (`@packages/backend/convex/lib/notifications`). The
 * backend exports `renderTemplate` + `findRenderedViolation` as PURE helpers
 * (no Convex ctx) precisely so a front mirror is one re-export away — single
 * source of truth, zero drift.
 *
 * Output shape: `{ rendered: string; violation: { code, message } | null }`.
 * `rendered` is the interpolated text the preview component paints; `violation
 * !== null` flips the submit button to disabled and surfaces the FR copy
 * inline.
 *
 * Pure — no React, no Convex.
 */

// Value imports from the pure submodule (`templateBounds.ts`) — the barrel
// `notifications/index.ts` re-exports `engine.ts` which transitively pulls
// `getCurrentActor.ts` (defines `whoAmI = query(...)`), so a value-import
// from the barrel evaluates server-only Convex code in the browser bundle.
// `templateBounds.ts` is a pure module — safe for client surfaces.
import {
  type TemplateBoundViolation,
  findRenderedViolation,
  renderTemplate,
} from "@packages/backend/convex/lib/notifications/templateBounds";
import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";

/**
 * FR copy per violation code — kept colocated with the front mirror because
 * the wording targets the GÉRANT (the resto manager), not a system log. The
 * backend's `ConvexError` is system-facing.
 */
const VIOLATION_COPY: Record<TemplateBoundViolation, string> = {
  DISCOUNT_TOO_HIGH:
    "Réduction trop élevée — maximum 50 % (ADR 0006 KitchenBoost).",
  BODY_TOO_LONG:
    "Message trop long — il doit rester strictement sous 200 caractères.",
  NOT_FRENCH: "Template non français — V1 KitchenBoost en français uniquement.",
  ALCOHOL_NOT_ALLOWED:
    "Mention d'alcool interdite — templates KitchenBoost (ADR 0006).",
  UNKNOWN_VARIABLE:
    "Variable inconnue dans le template (placeholder non reconnu).",
};

export type TemplatePreviewViolation = {
  code: TemplateBoundViolation;
  message: string;
};

export type TemplatePreviewResult = {
  rendered: string;
  violation: TemplatePreviewViolation | null;
};

/**
 * Render a template with the gérant-filled variable values and re-check every
 * declared bound at the rendered surface. The check mirrors the backend
 * `findRenderedViolation` (same precedence: discount cap > rendered length >
 * language > alcohol), so the front and the server agree on what « ready to
 * send » means.
 *
 * `values` is the same shape the `VariablesForm` already maintains
 * (`Partial<Record<TemplateVariable, string>>` widened to a plain string map),
 * so it plugs in without an extra adapter.
 */
export function renderTemplatePreview(
  template: TenantTemplateSummary,
  values: Record<string, string>,
): TemplatePreviewResult {
  const rendered = renderTemplate(template.body, values);
  const violationCode = findRenderedViolation({
    rendered,
    values,
    language: template.language,
    containsAlcohol: template.containsAlcohol,
  });
  if (violationCode === null) {
    return { rendered, violation: null };
  }
  return {
    rendered,
    violation: { code: violationCode, message: VIOLATION_COPY[violationCode] },
  };
}
