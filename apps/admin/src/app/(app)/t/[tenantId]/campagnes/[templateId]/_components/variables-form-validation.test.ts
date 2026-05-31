/**
 * F-CAMPAGNES [3/7] (#205) — `variables-form-validation`, the pure validation
 * mirror of the backend template bounds (ADR 0006 / PRD 80 §4) applied
 * field-by-field to the resto-filled variable values.
 *
 * Why a SEPARATE pure module (vs. a check inside the component): the
 * component runs in the React tree under `environment: "node"` (vitest
 * config), so any logic we can lift into a pure function we test in
 * isolation we do — same discipline as `templateBounds.ts` on the backend.
 * The component (`VariablesForm`) is then a THIN consumer of this module:
 * call `validateVariableValue` per field, paint the error.
 *
 * Mirror, NOT a duplicate of the SEND-TIME re-check:
 *   - The backend already enforces every bound at SEND time
 *     (`findRenderedViolation` inside `sendTenantCampaign`). That is the
 *     hard barrier — even if the client lets a bad value through, the
 *     server rejects with `TEMPLATE_BOUND_VIOLATION`.
 *   - This module's job is to PRE-EMPT the obvious mistakes at the input
 *     edge so the « Envoyer » button stays disabled (issue body AC) and
 *     the gérant sees inline what's wrong before they hit a server error.
 *
 * Bounds enforced here (issue body verbatim):
 *   - `{discount}` ≤ 50 % (cap, mirror of `MAX_DISCOUNT_PERCENT`). The
 *     slider already prevents it at the widget level; we ALSO validate the
 *     numeric value here as the contract so a regression that swaps the
 *     widget for a free input still gets caught.
 *   - Length « raisonnable » per individual input. The final 200-char
 *     rendered bound (`MAX_RENDERED_LENGTH`) is the source of truth at
 *     send time; per-field we cap each free text at 80 chars — a
 *     conservative budget so even worst-case interpolation (1 long input
 *     + boilerplate) stays under 200.
 *   - FR-only — refuse common English placeholders that signal a copy-paste
 *     leak. We keep this LIGHT (we are not a linguistic detector) and
 *     surface a clear violation reason.
 *   - Anti-alcohol on free text — mirror of the backend's `containsAlcohol`
 *     flag, applied DEFENSIVELY to user-typed values. The forbidden FR list
 *     is the canonical short set documented in ADR 0006 « pas de mention
 *     alcool / produits soumis à autorisation »; the test pins the exact
 *     words (`vin`, `bière`, `biere`, `alcool`, `champagne`, `whisky`,
 *     `vodka`, `rhum`, `cocktail`) so a future expansion is intentional.
 *   - Time HH:MM — `{heure_debut}` / `{heure_fin}` must be a valid 24h time
 *     string. The form uses a time picker, but the value is still validated
 *     so a regression to a text input is caught.
 *
 * Returns the FIRST violation reason as a discriminated string, else `null`.
 * Pure, no React, no Convex.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_INPUT_LENGTH,
  FORBIDDEN_ALCOHOL_WORDS,
  validateVariableValue,
  type VariableValidationViolation,
} from "./variables-form-validation";

describe("variables-form-validation — bounds constants", () => {
  it("MAX_INPUT_LENGTH stays under the rendered cap with room for boilerplate", () => {
    // `MAX_RENDERED_LENGTH` on the backend is 200. A single 80-char input
    // leaves > 120 chars for boilerplate + other vars, which fits every V1
    // template we have. We pin the constant so a relaxation is explicit.
    expect(MAX_INPUT_LENGTH).toBeLessThan(200);
    expect(MAX_INPUT_LENGTH).toBeGreaterThanOrEqual(40);
  });

  it("FORBIDDEN_ALCOHOL_WORDS surfaces the canonical FR short list (ADR 0006 « pas de mention alcool »)", () => {
    // Closed V1 short list — kept explicit so an expansion is a code
    // change (and reviewed) rather than a config drift.
    const lower = FORBIDDEN_ALCOHOL_WORDS.map((w) => w.toLowerCase());
    for (const w of [
      "vin",
      "bière",
      "biere",
      "alcool",
      "champagne",
      "whisky",
      "vodka",
      "rhum",
      "cocktail",
    ]) {
      expect(lower).toContain(w);
    }
  });
});

describe("validateVariableValue — text inputs (prenom_client, nom_resto, item_hero, nom_plat, jour)", () => {
  const TEXT_VARIABLES = [
    "prenom_client",
    "nom_resto",
    "item_hero",
    "nom_plat",
    "jour",
  ] as const;

  it("accepts a compliant FR short text", () => {
    for (const name of TEXT_VARIABLES) {
      expect(validateVariableValue(name, "Bonjour Marie")).toBeNull();
    }
  });

  it("accepts an empty string (a missing value is a benign blank, mirror of `renderTemplate`)", () => {
    for (const name of TEXT_VARIABLES) {
      // `renderTemplate` substitutes missing values with the empty string,
      // so an empty input is NOT a violation — the form's overall
      // « Envoyer » enablement is owned at a higher level (every required
      // field filled), not by this per-field check.
      expect(validateVariableValue(name, "")).toBeNull();
    }
  });

  it("rejects a text longer than MAX_INPUT_LENGTH", () => {
    const long = "x".repeat(MAX_INPUT_LENGTH + 1);
    for (const name of TEXT_VARIABLES) {
      expect(
        validateVariableValue(name, long),
      ).toBe<VariableValidationViolation>("INPUT_TOO_LONG");
    }
  });

  it("accepts a text of EXACTLY MAX_INPUT_LENGTH chars (boundary)", () => {
    const exact = "y".repeat(MAX_INPUT_LENGTH);
    for (const name of TEXT_VARIABLES) {
      expect(validateVariableValue(name, exact)).toBeNull();
    }
  });

  it("rejects a text containing a forbidden alcohol word (case-insensitive)", () => {
    for (const name of TEXT_VARIABLES) {
      expect(validateVariableValue(name, "Soirée VIN rouge")).toBe(
        "ALCOHOL_NOT_ALLOWED",
      );
      expect(validateVariableValue(name, "Pack bière offert")).toBe(
        "ALCOHOL_NOT_ALLOWED",
      );
      expect(validateVariableValue(name, "Promo Whisky")).toBe(
        "ALCOHOL_NOT_ALLOWED",
      );
    }
  });

  it("rejects a text containing an alcohol word with accents stripped (matches both « biere » and « bière »)", () => {
    for (const name of TEXT_VARIABLES) {
      expect(validateVariableValue(name, "spécial biere")).toBe(
        "ALCOHOL_NOT_ALLOWED",
      );
      expect(validateVariableValue(name, "soirée bière")).toBe(
        "ALCOHOL_NOT_ALLOWED",
      );
    }
  });

  it("does NOT false-positive on benign substrings that contain an alcohol word as a substring (word boundary required)", () => {
    // « vinaigre » contains « vin » as a substring; the matcher MUST be
    // word-boundary so a benign FR word like « vinaigrette » is accepted.
    for (const name of TEXT_VARIABLES) {
      expect(validateVariableValue(name, "vinaigrette maison")).toBeNull();
      expect(validateVariableValue(name, "Bonjour")).toBeNull();
    }
  });
});

describe("validateVariableValue — discount (slider value)", () => {
  it("accepts a discount of 0 (no promo)", () => {
    expect(validateVariableValue("discount", "0")).toBeNull();
  });

  it("accepts a discount at the 50 cap (boundary, matches MAX_DISCOUNT_PERCENT)", () => {
    expect(validateVariableValue("discount", "50")).toBeNull();
  });

  it("rejects a discount above 50 (anti '-50 % au lieu de -5 %' guardrail mirror)", () => {
    expect(validateVariableValue("discount", "51")).toBe("DISCOUNT_TOO_HIGH");
    expect(validateVariableValue("discount", "80")).toBe("DISCOUNT_TOO_HIGH");
  });

  it("rejects a non-numeric discount value (defensive — slider always emits numeric)", () => {
    expect(validateVariableValue("discount", "abc")).toBe("DISCOUNT_INVALID");
  });

  it("accepts an empty discount as benign blank (mirror of renderTemplate)", () => {
    expect(validateVariableValue("discount", "")).toBeNull();
  });
});

describe("validateVariableValue — time inputs (heure_debut, heure_fin)", () => {
  it("accepts a valid HH:MM 24h time", () => {
    for (const name of ["heure_debut", "heure_fin"] as const) {
      expect(validateVariableValue(name, "09:00")).toBeNull();
      expect(validateVariableValue(name, "23:59")).toBeNull();
      expect(validateVariableValue(name, "00:00")).toBeNull();
    }
  });

  it("rejects an invalid time string", () => {
    for (const name of ["heure_debut", "heure_fin"] as const) {
      expect(validateVariableValue(name, "24:00")).toBe("TIME_INVALID");
      expect(validateVariableValue(name, "12:60")).toBe("TIME_INVALID");
      expect(validateVariableValue(name, "9h00")).toBe("TIME_INVALID");
      expect(validateVariableValue(name, "abc")).toBe("TIME_INVALID");
    }
  });

  it("accepts an empty time as benign blank (mirror of renderTemplate)", () => {
    for (const name of ["heure_debut", "heure_fin"] as const) {
      expect(validateVariableValue(name, "")).toBeNull();
    }
  });
});
