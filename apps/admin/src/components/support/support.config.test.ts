/**
 * F-SUPPORT/1 (#210) — Static contract of the support config.
 *
 * The default `supportConfig` is the V1 figée config (csm = Alex, no per-tenant
 * mapping). We pin:
 *   - the shape: `csm` (name + email + availability mandatory) + `resources[]`,
 *   - the URL hygiene of every resource (https + plausibly external),
 *   - the email/phone hygiene of the CSM (parseable into mailto:/tel:).
 *
 * Why not just rely on TypeScript?
 * --------------------------------
 * `tsc --noEmit` enforces *shape*; vitest pins *content* (no `mailto:` in the
 * email field, no relative URL in a resource, etc.). This keeps the static
 * config from drifting silently when Alex edits the URLs at PR-review time.
 */
import { describe, expect, it } from "vitest";
import { supportConfig, type SupportConfig } from "./support.config";

describe("supportConfig — F-SUPPORT/1 (#210) static contract", () => {
  it("exposes a typed `csm` block with at least name + email + availability", () => {
    const config: SupportConfig = supportConfig;
    expect(typeof config.csm.name).toBe("string");
    expect(config.csm.name.length).toBeGreaterThan(0);
    expect(typeof config.csm.email).toBe("string");
    expect(config.csm.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(typeof config.csm.availability).toBe("string");
    expect(config.csm.availability.length).toBeGreaterThan(0);
  });

  it("CSM phone, when set, is a plain dial-able string (no `tel:` prefix)", () => {
    const phone = supportConfig.csm.phone;
    if (phone !== undefined) {
      expect(phone).not.toMatch(/^tel:/i);
      // At least 6 dial-able digits — the component will wrap into `tel:${phone}`.
      const digits = phone.replace(/\D/g, "");
      expect(digits.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("CSM photoUrl, when set, points under `/csm/` (asset lives in apps/admin/public/csm/)", () => {
    const photoUrl = supportConfig.csm.photoUrl;
    if (photoUrl !== undefined) {
      expect(photoUrl).toMatch(/^\/csm\//);
    }
  });

  it("exposes a non-empty typed `resources` array (V1 placeholder URLs are valid)", () => {
    expect(Array.isArray(supportConfig.resources)).toBe(true);
    expect(supportConfig.resources.length).toBeGreaterThan(0);
  });

  it("every resource has a non-empty title + an absolute https URL", () => {
    for (const r of supportConfig.resources) {
      expect(typeof r.title).toBe("string");
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.url).toMatch(/^https:\/\//);
      if (r.description !== undefined) {
        expect(typeof r.description).toBe("string");
      }
    }
  });

  it("no duplicate resource URL (defensive against copy/paste regressions)", () => {
    const urls = supportConfig.resources.map((r) => r.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });
});
