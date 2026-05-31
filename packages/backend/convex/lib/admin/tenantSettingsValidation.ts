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
 * Strip whitespace from a phone number, preserving an optional leading `+`.
 * Throws `INVALID_PHONE` on empty / whitespace-only input, on any non-numeric
 * content (other than the optional single leading `+`), and on a lone `+`.
 */
export function normalisePhone(value: string): string {
  // Drop ASCII whitespace anywhere in the input.
  const stripped = value.replace(/\s+/g, "");
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
