import { ConvexError } from "convex/values";

/**
 * B-TENANT-LIFECYCLE [2/4] — PURE validation helpers reused by the upcoming
 * `tenant.updateSettings` (D5, PRD 70 §3.6 / §4.8) and `tenant.activate` (D6)
 * mutations. NO Convex `ctx`, NO DB — trivially unit-testable in isolation.
 *
 * Each helper either returns the normalised value or throws a `ConvexError`
 * with an explicit `code` (`INVALID_*`) so the caller (the mutations) can
 * surface a clean, machine-friendly error without duplicating the rule.
 */

/**
 * Whether `value` is a canonical 6-digit hex colour with a leading `#`
 * (e.g. `#1B7A3D`). Accepts upper- AND lower-case hex digits. Rejects short
 * 3-digit form, missing `#`, non-hex characters, empty / whitespace, and any
 * trailing or leading clutter.
 */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * F-WIZARD [4/10] (#268) — shape check for the optional `customDomain` field
 * exposed by the wizard's step 2 (« domaine personnalisé optionnel », modèle
 * Owner.com) and persisted on the tenant via `tenant.updateSettings`.
 *
 * Regex VERBATIM from the issue body so the FRONT and the BACK share the
 * exact same validation shape — a value the form lets through MUST be a value
 * the backend accepts (single source of validation shape; the wizard form
 * `step2-domain-form` re-exports the same predicate so a drift surfaces at
 * compile time).
 *
 *   pattern: `^[a-z0-9.-]+\.[a-z]{2,}$`
 *
 * Intentionally strict — no scheme (`https://`), no path / port / query
 * string, no uppercase, no underscores. The PWA cliente lives at a bare
 * FQDN; anything else fails downstream (DNS / TLS provisioning) so the
 * backend never persists an unusable value. The wizard step 2 trims the
 * input before calling `isValidCustomDomain` (no leading / trailing space).
 *
 * Idempotent: returns `false` on empty / whitespace-only input. Trimming is
 * the CALLER's responsibility (mirrors `isValidHexColor` / `isValidSiret` —
 * pure shape check, no normalisation side-effect).
 */
export function isValidCustomDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value);
}

/**
 * Strip whitespace AND common phone-formatting punctuation from a phone number,
 * preserving an optional leading `+`. Throws `INVALID_PHONE` on empty input
 * (whitespace/punctuation-only counts as empty), on any non-numeric content
 * after stripping (other than the optional single leading `+`), and on a lone
 * `+`.
 *
 * Accepted human-typed shapes (real-world UX, not paranoia):
 *   - `+33 6 12 34 56 78` / `+33-6-12-34-56-78` / `06.12.34.56.78`
 *   - trailing punctuation copy/pasted from contact cards: `+33 6 12.` etc.
 *   - parens around country/area code: `(+33) 6 12 34 56 78` / `(0)6 12 …`
 *   - slashes as separator: `06/12/34/56/78`
 *
 * Stripped: ASCII whitespace, `.`, `-`, `(`, `)`, `/`. Anything else (letters,
 * commas, semicolons, …) still fails — the goal is to be UX-friendly on the
 * common separators users naturally type, NOT to be a permissive parser.
 *
 * Fix 2026-06-01 (P2 E2E spot-check, [docs/tests/E2E-checklist.md](../../../../../docs/tests/E2E-checklist.md)
 * groupe P) — the legacy version only stripped whitespace, so `+33 6 12 34 56 78.`
 * (with a copy-pasted trailing dot) hit INVALID_PHONE and made the P2 parcours
 * un-passable from the manager UI. Widened to the punctuation set above.
 */
export function normalisePhone(value: string): string {
  // Drop ASCII whitespace + the common phone-formatting punctuation anywhere
  // in the input. Anything left must be `+?[0-9]+` (one optional leading + and
  // ≥1 digit after).
  const stripped = value.replace(/[\s.\-()/]+/g, "");
  if (stripped.length === 0) {
    throw new ConvexError({
      code: "INVALID_PHONE",
      message: "Phone number is empty.",
    });
  }
  const hasPlus = stripped.startsWith("+");
  const digits = hasPlus ? stripped.slice(1) : stripped;
  // After stripping the optional leading +, the rest must be ≥1 digit AND
  // contain no further + or other non-digit characters.
  if (digits.length === 0 || !/^[0-9]+$/.test(digits)) {
    throw new ConvexError({
      code: "INVALID_PHONE",
      message: `Phone number "${value}" is not a valid numeric sequence.`,
    });
  }
  return (hasPlus ? "+" : "") + digits;
}

/**
 * Trim `value` and return it. Throws `ConvexError({ code, message })` if the
 * trimmed value is empty (so empty / whitespace-only inputs are rejected). The
 * caller passes the error `code` (`INVALID_ADDRESS`, `INVALID_NAME`, …) so the
 * helper stays reusable across every non-empty-string field of the settings
 * form (PRD 70 §4.8).
 */
export function assertNonEmptyString(value: string, code: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ConvexError({
      code,
      message: "Value must be a non-empty string.",
    });
  }
  return trimmed;
}

/**
 * Address-first slice 1 (2026-06-11) — the FULL structured address payload
 * `tenant.updateSettings` must persist together.
 *
 * The PWA `requestDeliveryQuote` chain (commit 69699b3) revealed that Uber
 * Direct refuses a quote without `pickup_address`, and recommends the
 * structured JSON shape `{street_address[],city,state,zip_code,country}` along
 * with explicit `pickup_latitude` / `pickup_longitude` for accurate geocoding.
 * The 4-tuple (display string + lat/lng + 4-component object) therefore
 * TRAVELS TOGETHER on every patch — a half-patch (e.g. address-only) would
 * leave the row inconsistent and break the quote chain at the next E2E run.
 *
 * Throws `ConvexError({ code: "INVALID_ADDRESS_PAYLOAD", message: ... })` with
 * a precise message on any defect:
 *  - empty / whitespace-only display `address`
 *  - non-finite `addressLat` / `addressLng` (`Number.isFinite` ⇒ rejects NaN,
 *    ±Infinity, but accepts 0, negatives, decimals)
 *  - empty `streetAddress` / `city`
 *  - FR `zipCode` not matching `^\d{5}$` (V1 FR-only — Owner.com model, all
 *    restos parisien / IdF; widening to multi-country is a V2 concern)
 *  - `country` ≠ `"FR"` (V1 FR-only, see above)
 *
 * Returns `void` on success (no normalisation: callers persist the values as
 * received from Google Places). The mutation layer wires this in BEFORE the
 * store call so a refused patch never persists a partial change
 * (transactional).
 */
export type AddressPayload = {
  address: string;
  addressLat: number;
  addressLng: number;
  addressComponents: {
    streetAddress: string;
    city: string;
    zipCode: string;
    country: string;
  };
};

export function isValidAddressPayload(payload: AddressPayload): void {
  const fail = (reason: string): never => {
    throw new ConvexError({
      code: "INVALID_ADDRESS_PAYLOAD",
      message: `Invalid address payload: ${reason}.`,
    });
  };

  if (typeof payload.address !== "string" || payload.address.trim() === "") {
    fail("display `address` must be a non-empty string");
  }
  if (!Number.isFinite(payload.addressLat)) {
    fail("`addressLat` must be a finite number");
  }
  if (!Number.isFinite(payload.addressLng)) {
    fail("`addressLng` must be a finite number");
  }
  const c = payload.addressComponents;
  if (typeof c.streetAddress !== "string" || c.streetAddress.trim() === "") {
    fail("`addressComponents.streetAddress` must be a non-empty string");
  }
  if (typeof c.city !== "string" || c.city.trim() === "") {
    fail("`addressComponents.city` must be a non-empty string");
  }
  if (!/^\d{5}$/.test(c.zipCode)) {
    fail("`addressComponents.zipCode` must be a 5-digit FR postal code");
  }
  if (c.country !== "FR") {
    fail('`addressComponents.country` must be "FR" (V1 FR-only)');
  }
}
