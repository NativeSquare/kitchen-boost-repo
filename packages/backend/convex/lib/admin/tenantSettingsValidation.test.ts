import { describe, expect, it } from "vitest";
import {
  assertNonEmptyString,
  isValidAddressPayload,
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

  /**
   * Fix 2026-06-01 (P2 E2E spot-check) — the validator must accept the common
   * separators users naturally type / copy-paste from contact cards. Without
   * this, the P2 « Coordonnées » parcours throws INVALID_PHONE on a perfectly
   * legitimate `+33 6 12 34 56 78.` (note the trailing dot from a vCard).
   */
  it("strips dots used as French phone separator", () => {
    expect(normalisePhone("06.12.34.56.78")).toBe("0612345678");
    expect(normalisePhone("+33.6.12.34.56.78")).toBe("+33612345678");
  });

  it("strips a trailing dot copy-pasted from a contact card", () => {
    expect(normalisePhone("+33 6 12 34 56 78.")).toBe("+33612345678");
    expect(normalisePhone("0612345678.")).toBe("0612345678");
  });

  it("strips hyphens used as separator", () => {
    expect(normalisePhone("06-12-34-56-78")).toBe("0612345678");
    expect(normalisePhone("+33-6-12-34-56-78")).toBe("+33612345678");
  });

  it("strips parens around area code", () => {
    expect(normalisePhone("(+33) 6 12 34 56 78")).toBe("+33612345678");
    expect(normalisePhone("(0)6 12 34 56 78")).toBe("0612345678");
  });

  it("strips slashes used as separator", () => {
    expect(normalisePhone("06/12/34/56/78")).toBe("0612345678");
  });

  it("treats punctuation-only input as empty (INVALID_PHONE)", () => {
    try {
      normalisePhone("(-./)");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_PHONE");
    }
  });

  it("still rejects letters / other non-allowed punctuation (commas, semicolons)", () => {
    for (const bad of ["06,12,34,56,78", "06;12;34;56;78", "06abc12"]) {
      try {
        normalisePhone(bad);
        expect.unreachable(`should have thrown on ${bad}`);
      } catch (err) {
        const data = (err as { data?: { code?: string } }).data;
        expect(data?.code).toBe("INVALID_PHONE");
      }
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

/**
 * Address-first slice 1 (2026-06-11) — `isValidAddressPayload` shape check.
 *
 * The PWA `requestDeliveryQuote` chain (commit 69699b3) revealed that Uber
 * Direct refuses a quote without `pickup_address` (HTTP 400 `invalid_params`
 * with `metadata.pickup_address: "This field is required."`). The quick-fix
 * forwarded `tenants.address` (string brute), but Uber recommends the
 * structured JSON shape with explicit components + lat/lng for accurate
 * geocoding. This validator enforces the FULL 4-tuple shape the wizard /
 * Paramètres editor must persist together:
 *
 *  - `address` — non-empty display string (the line the gérant typed)
 *  - `addressLat`/`addressLng` — finite numbers (`Number.isFinite`)
 *  - `addressComponents` — `{ streetAddress, city, zipCode, country }` with
 *    streetAddress + city non-empty, FR zipCode `^\d{5}$`, country `"FR"`
 *
 * The 4 fields TRAVEL TOGETHER on every patch — slice 3 will gate
 * `tenant.activate` on them. Throws `ConvexError({ code:
 * "INVALID_ADDRESS_PAYLOAD" })` with an explicit message on any defect.
 */
describe("isValidAddressPayload — address-first slice 1 (2026-06-11)", () => {
  const validPayload = {
    address: "1 Rue de Rivoli, 75001 Paris",
    addressLat: 48.8606,
    addressLng: 2.3376,
    addressComponents: {
      streetAddress: "1 Rue de Rivoli",
      city: "Paris",
      zipCode: "75001",
      country: "FR",
    },
  };

  it("accepts a fully-structured FR address payload", () => {
    expect(() => isValidAddressPayload(validPayload)).not.toThrow();
  });

  it("throws INVALID_ADDRESS_PAYLOAD on an empty / whitespace-only display address", () => {
    for (const bad of ["", "   "]) {
      try {
        isValidAddressPayload({ ...validPayload, address: bad });
        expect.unreachable(`should have thrown on display address "${bad}"`);
      } catch (err) {
        const data = (err as { data?: { code?: string } }).data;
        expect(data?.code).toBe("INVALID_ADDRESS_PAYLOAD");
      }
    }
  });

  it("throws INVALID_ADDRESS_PAYLOAD on a non-finite latitude (NaN)", () => {
    try {
      isValidAddressPayload({ ...validPayload, addressLat: Number.NaN });
      expect.unreachable("should have thrown on NaN latitude");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_ADDRESS_PAYLOAD");
    }
  });

  it("throws INVALID_ADDRESS_PAYLOAD on a non-finite longitude (Infinity)", () => {
    try {
      isValidAddressPayload({
        ...validPayload,
        addressLng: Number.POSITIVE_INFINITY,
      });
      expect.unreachable("should have thrown on Infinity longitude");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_ADDRESS_PAYLOAD");
    }
  });

  it("throws INVALID_ADDRESS_PAYLOAD on a malformed FR zipCode (not 5 digits)", () => {
    for (const bad of ["7500", "750010", "7500A", "ABCDE", ""]) {
      try {
        isValidAddressPayload({
          ...validPayload,
          addressComponents: {
            ...validPayload.addressComponents,
            zipCode: bad,
          },
        });
        expect.unreachable(`should have thrown on zipCode "${bad}"`);
      } catch (err) {
        const data = (err as { data?: { code?: string } }).data;
        expect(data?.code).toBe("INVALID_ADDRESS_PAYLOAD");
      }
    }
  });

  it("throws INVALID_ADDRESS_PAYLOAD on a country code that is not FR (V1 FR-only)", () => {
    for (const bad of ["US", "BE", "fr", ""]) {
      try {
        isValidAddressPayload({
          ...validPayload,
          addressComponents: {
            ...validPayload.addressComponents,
            country: bad,
          },
        });
        expect.unreachable(`should have thrown on country "${bad}"`);
      } catch (err) {
        const data = (err as { data?: { code?: string } }).data;
        expect(data?.code).toBe("INVALID_ADDRESS_PAYLOAD");
      }
    }
  });

  it("throws INVALID_ADDRESS_PAYLOAD when a required component is empty (streetAddress or city)", () => {
    try {
      isValidAddressPayload({
        ...validPayload,
        addressComponents: {
          ...validPayload.addressComponents,
          streetAddress: "",
        },
      });
      expect.unreachable("should have thrown on empty streetAddress");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_ADDRESS_PAYLOAD");
    }

    try {
      isValidAddressPayload({
        ...validPayload,
        addressComponents: { ...validPayload.addressComponents, city: "   " },
      });
      expect.unreachable("should have thrown on whitespace-only city");
    } catch (err) {
      const data = (err as { data?: { code?: string } }).data;
      expect(data?.code).toBe("INVALID_ADDRESS_PAYLOAD");
    }
  });
});
