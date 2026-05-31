/**
 * F-MENU-04 (#211) — `formatPriceCentimes`, the centimes-to-euro formatter
 * used by item cards.
 *
 * The schema stores every monetary amount as a CENTIMES integer
 * (`menuItems.basePrice`, frozen into `orderItems` snapshots — cf.
 * `packages/backend/convex/table/menuItems.ts`). The gérant reads euros, so
 * each card materialises the price through this helper.
 *
 * Why a dedicated helper (not inline `Intl.NumberFormat`):
 *   - Single source of truth for the « centimes → human-euro » contract;
 *     a future surface (order details, KDS preview) reuses the same shape.
 *   - The validation (positive integer) is the same backend invariant as
 *     `assertNonNegativePrice` in `packages/backend/convex/lib/menu/items.ts`
 *     — keeping it loud here catches a contract regression early (e.g. a
 *     buggy mutation returning a float would explode the format call, not
 *     silently render « 12,500001 € »).
 *
 * Locale: `fr-FR`, currency: `EUR`. `Intl.NumberFormat` renders the standard
 * French shape: « 12,50 € » (comma decimal, narrow NBSP before the euro sign
 * — modern ICU). The exact whitespace glyph varies across Node versions, so
 * tests assert digits + comma + euro, not the whitespace codepoint.
 *
 * Pure helper — no React, no DOM. Pinned by `format-price.test.ts`.
 */

const FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a CENTIMES integer as a French euro string.
 *
 * Throws on negative or non-integer input — the backend validator
 * (`INVALID_PRICE` in items.ts) already refuses these at the API boundary,
 * so reaching this helper with a bad value is a contract violation, not a
 * user-facing case to format.
 */
export function formatPriceCentimes(centimes: number): string {
  if (!Number.isFinite(centimes) || !Number.isInteger(centimes)) {
    throw new Error(
      `formatPriceCentimes: expected a finite integer, got ${centimes}`,
    );
  }
  if (centimes < 0) {
    throw new Error(
      `formatPriceCentimes: expected a non-negative value, got ${centimes}`,
    );
  }
  return FORMATTER.format(centimes / 100);
}
