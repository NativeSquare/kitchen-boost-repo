/**
 * F-CAMPAGNES [4/7] (#215) — `renderTemplatePreview`, the FRONT MIRROR of the
 * backend send-time bound check (`packages/backend/convex/lib/notifications/
 * templateBounds.ts` :: `renderTemplate` + `findRenderedViolation`).
 *
 * Why a front mirror at all (vs. lazy-await the backend response):
 *   - The « Envoyer maintenant » button must enable/disable in REAL TIME as the
 *     gérant fills the variable form (issue body AC). A roundtrip to Convex on
 *     every keystroke is the wrong shape for that UX.
 *   - The backend remains the HARD barrier (`sendTenantCampaign` re-checks at
 *     send time, ADR 0006 / PRD 80 §4). This helper just PRE-EMPTS so the
 *     submit button reflects the truth before a network call.
 *
 * Contract pinned by this suite — IDENTICAL to the backend's
 * `findRenderedViolation` against the same fixture set (defence-in-depth):
 *   - discount filled by the gérant > 50 % → DISCOUNT_TOO_HIGH (anti
 *     « -80 % au lieu de -8 % »);
 *   - rendered length ≥ 200 chars → BODY_TOO_LONG (Wallet + Web Push coherence
 *     ceiling — anything ≥ 200 is rejected);
 *   - template `language !== "fr"` → NOT_FRENCH (V1 = FR only);
 *   - template `containsAlcohol === true` → ALCOHOL_NOT_ALLOWED (ADR 0006
 *     « pas de mention alcool »).
 *
 * Empty / unfilled variables: the helper substitutes them with the empty
 * string — mirror of `renderTemplate(body, values)` on the backend (a missing
 * value is a benign blank, NOT a crash). The submit button's enablement is
 * owned upstream by the per-field validation (`variables-form-validation.ts`)
 * — the rendered-bound check is the LAST gate before send.
 *
 * Return shape: `{ rendered: string; violation: { code, message } | null }`.
 * `rendered` is the interpolated text the preview component paints; `violation
 * !== null` flips the submit button to disabled and surfaces the FR copy inline.
 * Pure — no React, no Convex.
 */
import { describe, expect, it } from "vitest";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { renderTemplatePreview } from "./renderTemplatePreview";

// ---------------------------------------------------------------------------
// Fixtures — minimal templates aligned on the backend
// `findRenderedViolation` test cases (templateBounds.test.ts).
// ---------------------------------------------------------------------------
const TEMPLATE_BASE: TenantTemplateSummary = {
  id: "tpl_ok" as Id<"notificationTemplates">,
  key: "weekend_promo",
  label: "Promo weekend",
  body: "Bonjour {prenom_client}, -{discount}% chez {nom_resto} !",
  variables: ["prenom_client", "discount", "nom_resto"],
  deepLinkTarget: "catalogue",
  language: "fr",
  maxDiscountPercent: 50,
  containsAlcohol: false,
};

// ---------------------------------------------------------------------------
// Tests — rendered text
// ---------------------------------------------------------------------------
describe("renderTemplatePreview — rendered output (mirror of `renderTemplate`)", () => {
  it("interpolates every filled variable into the body", () => {
    const { rendered } = renderTemplatePreview(TEMPLATE_BASE, {
      prenom_client: "Sophie",
      discount: "20",
      nom_resto: "Buns & Bao",
    });
    expect(rendered).toBe("Bonjour Sophie, -20% chez Buns & Bao !");
  });

  it("leaves an unfilled placeholder as an empty string (benign blank, mirror backend)", () => {
    const { rendered } = renderTemplatePreview(TEMPLATE_BASE, {
      prenom_client: "Sophie",
    });
    // `discount` + `nom_resto` are not in `values` → they collapse to "".
    expect(rendered).toBe("Bonjour Sophie, -% chez  !");
  });

  it("accepts an empty values map (no variable filled)", () => {
    const { rendered } = renderTemplatePreview(TEMPLATE_BASE, {});
    expect(rendered).toBe("Bonjour , -% chez  !");
  });
});

// ---------------------------------------------------------------------------
// Tests — violation: discount cap (mirror backend `findRenderedViolation`)
// ---------------------------------------------------------------------------
describe("renderTemplatePreview — discount cap violation (mirror backend)", () => {
  it("returns DISCOUNT_TOO_HIGH when the gérant filled discount > 50 (anti '-80 %')", () => {
    const result = renderTemplatePreview(TEMPLATE_BASE, {
      prenom_client: "S",
      discount: "80",
      nom_resto: "X",
    });
    expect(result.violation).not.toBeNull();
    expect(result.violation?.code).toBe("DISCOUNT_TOO_HIGH");
    // FR copy — pin the load-bearing word so a polish stays free.
    expect(result.violation?.message).toMatch(/réduction/i);
  });

  it("accepts a discount value EXACTLY at 50 (boundary)", () => {
    const result = renderTemplatePreview(TEMPLATE_BASE, {
      prenom_client: "S",
      discount: "50",
      nom_resto: "X",
    });
    expect(result.violation).toBeNull();
  });

  it("accepts a discount of 0 (no promo)", () => {
    const result = renderTemplatePreview(TEMPLATE_BASE, {
      prenom_client: "S",
      discount: "0",
      nom_resto: "X",
    });
    expect(result.violation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — violation: body length (mirror backend BODY_TOO_LONG at 200)
// ---------------------------------------------------------------------------
describe("renderTemplatePreview — rendered length violation (≥ 200 chars)", () => {
  it("returns BODY_TOO_LONG when the rendered message reaches 200 chars", () => {
    const longTemplate: TenantTemplateSummary = {
      ...TEMPLATE_BASE,
      // 195 chars literal + "Sophie" (6) = 201 chars rendered after
      // dropping the placeholder.
      body: `${"a".repeat(195)}{prenom_client}`,
      variables: ["prenom_client"],
    };
    const result = renderTemplatePreview(longTemplate, {
      prenom_client: "Sophie",
    });
    expect(result.rendered.length).toBeGreaterThanOrEqual(200);
    expect(result.violation?.code).toBe("BODY_TOO_LONG");
    expect(result.violation?.message).toMatch(/200|long|trop/i);
  });

  it("accepts a rendered message exactly UNDER 200 chars", () => {
    const okTemplate: TenantTemplateSummary = {
      ...TEMPLATE_BASE,
      body: `${"a".repeat(193)}{prenom_client}`, // 193 + "Sophie"(6) = 199
      variables: ["prenom_client"],
    };
    const result = renderTemplatePreview(okTemplate, {
      prenom_client: "Sophie",
    });
    expect(result.rendered.length).toBe(199);
    expect(result.violation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — violation: non-FR template (V1 = FR only)
// ---------------------------------------------------------------------------
describe("renderTemplatePreview — non-FR template violation (V1 = FR only)", () => {
  it("returns NOT_FRENCH when the template `language` is not 'fr'", () => {
    const enTemplate: TenantTemplateSummary = {
      ...TEMPLATE_BASE,
      // The schema rejects a non-FR template at the WRITE edge, but the
      // helper must defensively re-check (mirror backend defence-in-depth).
      language: "en" as unknown as TenantTemplateSummary["language"],
    };
    const result = renderTemplatePreview(enTemplate, {
      prenom_client: "S",
      discount: "10",
      nom_resto: "X",
    });
    expect(result.violation?.code).toBe("NOT_FRENCH");
    expect(result.violation?.message).toMatch(/français|FR/i);
  });
});

// ---------------------------------------------------------------------------
// Tests — violation: alcohol-flagged template
// ---------------------------------------------------------------------------
describe("renderTemplatePreview — alcohol-flagged template violation", () => {
  it("returns ALCOHOL_NOT_ALLOWED when the template carries `containsAlcohol === true`", () => {
    const beerTemplate: TenantTemplateSummary = {
      ...TEMPLATE_BASE,
      // Defence-in-depth: same as NOT_FRENCH — the schema rejects this at
      // the write edge, but a write-edge regression must not leak through.
      containsAlcohol: true,
    };
    const result = renderTemplatePreview(beerTemplate, {
      prenom_client: "S",
      discount: "10",
      nom_resto: "X",
    });
    expect(result.violation?.code).toBe("ALCOHOL_NOT_ALLOWED");
    expect(result.violation?.message).toMatch(/alcool/i);
  });
});

// ---------------------------------------------------------------------------
// Tests — happy path
// ---------------------------------------------------------------------------
describe("renderTemplatePreview — happy path (compliant message)", () => {
  it("returns a null violation when every bound passes", () => {
    const result = renderTemplatePreview(TEMPLATE_BASE, {
      prenom_client: "Sophie",
      discount: "20",
      nom_resto: "Buns & Bao",
    });
    expect(result.rendered).toBe("Bonjour Sophie, -20% chez Buns & Bao !");
    expect(result.violation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — violation order matches backend (deterministic FIRST violation)
// ---------------------------------------------------------------------------
describe("renderTemplatePreview — violation order matches backend `findRenderedViolation`", () => {
  it("flags DISCOUNT_TOO_HIGH BEFORE BODY_TOO_LONG when both apply", () => {
    // A 200-char body filled with discount=99 must trip the discount cap
    // FIRST (same precedence as backend `findRenderedViolation`).
    const conflict: TenantTemplateSummary = {
      ...TEMPLATE_BASE,
      body: `${"a".repeat(195)}{discount}`,
      variables: ["discount"],
    };
    const result = renderTemplatePreview(conflict, { discount: "99" });
    expect(result.violation?.code).toBe("DISCOUNT_TOO_HIGH");
  });
});
