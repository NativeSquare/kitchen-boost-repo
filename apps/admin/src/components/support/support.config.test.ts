/**
 * F-SUPPORT/1 (#210) — Static contract of the support config.
 *
 * Post-E2E SUP revisit (2026-06-03) la config V1 ne porte plus qu'un seul
 * champ : `contactEmail`. On pin :
 *   - la shape (un seul champ, type string),
 *   - l'hygiène de l'email (parseable en `mailto:`),
 *   - le fait que l'adresse pointe sur la VRAIE inbox V1
 *     (`office@kitchen-boost.com`), pas sur une personne nommée fictive.
 *
 * Why not just rely on TypeScript?
 * --------------------------------
 * `tsc --noEmit` enforces *shape*; vitest pins *content* (le bon email,
 * pas un placeholder, pas un `mailto:` en double). Ça empêche un revert
 * silencieux vers `alex@kitchen-boost.com` si quelqu'un réimporte l'ancienne
 * config par mégarde.
 */
import { describe, expect, it } from "vitest";
import { supportConfig, type SupportConfig } from "./support.config";

describe("supportConfig — surface email-only (post-E2E SUP revisit)", () => {
  it("expose un `contactEmail` typé string et plausiblement-mailable", () => {
    const config: SupportConfig = supportConfig;
    expect(typeof config.contactEmail).toBe("string");
    expect(config.contactEmail.length).toBeGreaterThan(0);
    expect(config.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    // Pas de préfixe `mailto:` dans le champ — le composant l'ajoute.
    expect(config.contactEmail).not.toMatch(/^mailto:/i);
  });

  it("pointe sur l'inbox générique V1 (`office@kitchen-boost.com`, pas une personne nommée)", () => {
    expect(supportConfig.contactEmail).toBe("office@kitchen-boost.com");
  });
});
