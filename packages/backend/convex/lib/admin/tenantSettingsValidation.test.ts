import { describe, expect, it } from "vitest";
import {
  assertNonEmptyString,
  isValidCustomDomain,
  isValidHexColor,
  normalisePhone,
} from "./tenantSettingsValidation";

/**
 * B-TENANT-LIFECYCLE [2/4] — PURE validation helpers reused by the upcoming
 * `tenant.updateSettings` mutation (D5, PRD 70 §3.6 / §4.8). Each helper is
 * trivially unit-testable in isolation (no DB, no ctx, no Convex).
 */

describe("isValidHexColor", () => {
  it("accepts canonical 6-digit hex with #", () => {
    expect(isValidHexColor("#1B7A3D")).toBe(true);
    expect(isValidHexColor("#000000")).toBe(true);
    expect(isValidHexColor("#FFFFFF")).toBe(true);
    expect(isValidHexColor("#E5A100")).toBe(true);
  });

  it("accepts lowercase hex digits", () => {
    expect(isValidHexColor("#1b7a3d")).toBe(true);
    expect(isValidHexColor("#abcdef")).toBe(true);
  });

  it("rejects 3-digit short form", () => {
    expect(isValidHexColor("#1B7A3")).toBe(false);
    expect(isValidHexColor("#abc")).toBe(false);
  });

  it("rejects missing leading #", () => {
    expect(isValidHexColor("1B7A3D")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidHexColor("#ZZZZZZ")).toBe(false);
    expect(isValidHexColor("#1B7A3G")).toBe(false);
  });

  it("rejects empty / whitespace", () => {
    expect(isValidHexColor("")).toBe(false);
    expect(isValidHexColor("   ")).toBe(false);
  });

  it("rejects extra characters / longer strings", () => {
    expect(isValidHexColor("#1B7A3D1")).toBe(false);
    expect(isValidHexColor("#1B7A3D ")).toBe(false);
  });
});

describe("normalisePhone", () => {
  it("strips spaces and preserves a leading +", () => {
    expect(normalisePhone("+33 6 12 34 56 78")).toBe("+33612345678");
  });

  it("strips spaces with no leading +", () => {
    expect(normalisePhone("06 12 34 56 78")).toBe("0612345678");
  });

  it("is a no-op on an already-clean number", () => {
    expect(normalisePhone("+33612345678")).toBe("+33612345678");
    expect(normalisePhone("0612345678")).toBe("0612345678");
  });

  it("throws INVALID_PHONE on empty", () => {
    expect(() => normalisePhone("")).toThrow();
    try {
      normalisePhone("");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_PHONE");
    }
  });

  it("throws INVALID_PHONE on whitespace-only input", () => {
    try {
      normalisePhone("   ");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_PHONE");
    }
  });

  it("throws INVALID_PHONE on non-numeric content", () => {
    try {
      normalisePhone("abc");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_PHONE");
    }
  });

  it("throws INVALID_PHONE when + appears anywhere except as a single leading char", () => {
    try {
      normalisePhone("06+12345678");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_PHONE");
    }
    try {
      normalisePhone("++33612345678");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_PHONE");
    }
  });

  it("rejects a lone +", () => {
    try {
      normalisePhone("+");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_PHONE");
    }
  });
});

describe("assertNonEmptyString", () => {
  it("returns the trimmed value on a non-empty input", () => {
    expect(assertNonEmptyString("hello", "INVALID_ADDRESS")).toBe("hello");
    expect(assertNonEmptyString("  hello  ", "INVALID_ADDRESS")).toBe("hello");
  });

  it("throws with the caller-supplied code on empty string", () => {
    try {
      assertNonEmptyString("", "INVALID_ADDRESS");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string; message?: string } }).data;
      expect(data?.code).toBe("INVALID_ADDRESS");
      expect(typeof data?.message).toBe("string");
    }
  });

  it("throws with the caller-supplied code on whitespace-only", () => {
    try {
      assertNonEmptyString("   \t\n", "INVALID_NAME");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_NAME");
    }
  });

  it("preserves the caller-supplied code verbatim (no implicit prefix)", () => {
    try {
      assertNonEmptyString("", "SOMETHING_ELSE");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("SOMETHING_ELSE");
    }
  });
});

/**
 * F-WIZARD [4/10] (#268) — `isValidCustomDomain` shape check.
 *
 * The wizard's step 2 form (« domaine personnalisé optionnel », modèle
 * Owner.com) MUST share the SAME regex on the front AND the back so the UX
 * never accepts a value the backend will refuse — single source of validation
 * shape. Regex verbatim from the issue body: `^[a-z0-9.-]+\.[a-z]{2,}$`.
 * Trims input first; case-insensitive on the leading host part is NOT
 * supported (FQDN convention is lowercase, the form lowercases on submit).
 */
describe("isValidCustomDomain — F-WIZARD [4/10] (#268)", () => {
  it("accepts canonical FQDN with multiple labels", () => {
    expect(isValidCustomDomain("commander.le-petit-bistrot.fr")).toBe(true);
    expect(isValidCustomDomain("artisan.fr")).toBe(true);
    expect(isValidCustomDomain("sub.example.co.uk")).toBe(true);
  });

  it("accepts digits and hyphens in labels", () => {
    expect(isValidCustomDomain("123-resto.fr")).toBe(true);
    expect(isValidCustomDomain("a1b2.fr")).toBe(true);
  });

  it("rejects missing TLD (no dot)", () => {
    expect(isValidCustomDomain("localhost")).toBe(false);
    expect(isValidCustomDomain("artisan")).toBe(false);
  });

  it("rejects single-letter TLD (regex requires >= 2)", () => {
    expect(isValidCustomDomain("artisan.f")).toBe(false);
  });

  it("rejects uppercase letters (lowercase FQDN convention)", () => {
    expect(isValidCustomDomain("Artisan.fr")).toBe(false);
    expect(isValidCustomDomain("artisan.FR")).toBe(false);
  });

  it("rejects whitespace and empty input", () => {
    expect(isValidCustomDomain("")).toBe(false);
    expect(isValidCustomDomain("   ")).toBe(false);
    expect(isValidCustomDomain("artisan .fr")).toBe(false);
  });

  it("rejects underscores / non-allowed chars (only [a-z0-9.-])", () => {
    expect(isValidCustomDomain("art_isan.fr")).toBe(false);
    expect(isValidCustomDomain("artisan!.fr")).toBe(false);
    expect(isValidCustomDomain("artisan@fr")).toBe(false);
  });

  it("rejects schemes / paths / ports (FQDN only)", () => {
    expect(isValidCustomDomain("https://artisan.fr")).toBe(false);
    expect(isValidCustomDomain("artisan.fr/path")).toBe(false);
    expect(isValidCustomDomain("artisan.fr:443")).toBe(false);
  });
});
