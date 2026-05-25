import { describe, expect, it } from "vitest";
import {
  ALLOWED_TEMPLATE_VARIABLES,
  MAX_DISCOUNT_PERCENT,
  MAX_RENDERED_LENGTH,
  TEMPLATE_LANGUAGE,
  findTemplateBoundViolation,
} from "./templateBounds";

/**
 * 2.7-A — pure DECLARATIVE bounds of a pre-validated campaign template (ADR 0006,
 * PRD 80 §4), written BEFORE the implementation (TDD red). 2.7-A only LAYS the
 * fields + the declarative bounds; the runtime check at send time is slice B —
 * but the bound CONSTANTS and the pure checker that the schema validators and the
 * later sender both lean on are defined here so they cannot drift.
 *
 * The four guardrails are NOT invented — they are verbatim from ADR 0006 / PRD 80
 * §4: `{discount}` ≤ 50 %, rendered length < 200 chars, French only, no alcohol.
 */

describe("2.7-A template bounds — declarative constants (ADR 0006 / PRD 80 §4)", () => {
  it("caps discount at 50 % (anti '-50 % au lieu de -5 %')", () => {
    expect(MAX_DISCOUNT_PERCENT).toBe(50);
  });

  it("caps the rendered message under 200 chars (Wallet + Web Push coherence)", () => {
    expect(MAX_RENDERED_LENGTH).toBe(200);
  });

  it("is French-only V1", () => {
    expect(TEMPLATE_LANGUAGE).toBe("fr");
  });

  it("exposes the documented interpolable variables (closed V1 list)", () => {
    // Exactly the variables enumerated in ADR 0006 / PRD 80 §4 + CONTEXT.
    expect([...ALLOWED_TEMPLATE_VARIABLES].sort()).toEqual(
      [
        "discount",
        "heure_debut",
        "heure_fin",
        "item_hero",
        "jour",
        "nom_plat",
        "nom_resto",
        "prenom_client",
      ].sort(),
    );
  });
});

describe("2.7-A findTemplateBoundViolation — pure guardrail checker", () => {
  it("accepts a compliant short French template body", () => {
    expect(
      findTemplateBoundViolation({
        body: "Bonjour {prenom_client}, -{discount}% chez {nom_resto} ce {jour} !",
        maxDiscountPercent: 20,
        language: "fr",
        containsAlcohol: false,
      }),
    ).toBeNull();
  });

  it("rejects a discount cap above 50 %", () => {
    expect(
      findTemplateBoundViolation({
        body: "Promo {discount}%",
        maxDiscountPercent: 60,
        language: "fr",
        containsAlcohol: false,
      }),
    ).toBe("DISCOUNT_TOO_HIGH");
  });

  it("accepts a discount cap exactly at 50 %", () => {
    expect(
      findTemplateBoundViolation({
        body: "Promo {discount}%",
        maxDiscountPercent: 50,
        language: "fr",
        containsAlcohol: false,
      }),
    ).toBeNull();
  });

  it("rejects a body whose rendered length reaches 200 chars", () => {
    expect(
      findTemplateBoundViolation({
        body: "a".repeat(200),
        maxDiscountPercent: 10,
        language: "fr",
        containsAlcohol: false,
      }),
    ).toBe("BODY_TOO_LONG");
  });

  it("rejects a non-French template (V1 = FR only)", () => {
    expect(
      findTemplateBoundViolation({
        body: "Hello {prenom_client}",
        maxDiscountPercent: 10,
        language: "en",
        containsAlcohol: false,
      }),
    ).toBe("NOT_FRENCH");
  });

  it("rejects a template flagged as containing alcohol", () => {
    expect(
      findTemplateBoundViolation({
        body: "Une bière offerte {prenom_client}",
        maxDiscountPercent: 10,
        language: "fr",
        containsAlcohol: true,
      }),
    ).toBe("ALCOHOL_NOT_ALLOWED");
  });

  it("rejects a body referencing an unknown variable (not in the closed V1 list)", () => {
    expect(
      findTemplateBoundViolation({
        body: "Bonjour {prenom_client}, voici {code_promo}",
        maxDiscountPercent: 10,
        language: "fr",
        containsAlcohol: false,
      }),
    ).toBe("UNKNOWN_VARIABLE");
  });
});
