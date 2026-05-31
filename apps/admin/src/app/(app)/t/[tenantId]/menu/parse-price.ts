/**
 * F-MENU-05 (#219) — `parsePriceEuros`: inverse of `formatPriceCentimes`.
 *
 * Takes a user-typed euro string (the value of the « Prix » input in the item
 * modal) and returns either a non-negative integer in CENTIMES, or an error
 * case the modal surfaces as `data-slot="menu-item-modal-price-error"`.
 *
 * Why a dedicated helper:
 *   - Single source of truth for the « euros UI -> centimes schema » contract,
 *     mirrors `format-price.ts` for the round-trip (read → format → user edit
 *     → parse → write).
 *   - The « non-negative integer centimes » rule is the schema's
 *     `assertNonNegativePrice` (`INVALID_PRICE`, see
 *     `packages/backend/convex/lib/menu/items.ts`). The local guard catches
 *     mistakes BEFORE the autosave fires — quieter UX, fewer wasted round-trips.
 *   - Pure (no React, no DOM) so it's testable in isolation under
 *     `environment: "node"`.
 *
 * Locale: accepts BOTH « , » (French) and « . » (international) as decimal
 * separator. The HTML input is plain text (no `type="number"` — the spinner
 * UI is awful on touch + can't lock the locale), so a user could legitimately
 * paste « 12.5 » from a spreadsheet or « 12,50 » from a French keyboard.
 *
 * Rejects:
 *   - empty / whitespace-only -> `{ reason: "empty" }`
 *   - non-numeric / multiple separators -> `{ reason: "format" }`
 *   - more than 2 fractional digits -> `{ reason: "fraction" }`
 *   - negative -> `{ reason: "negative" }` (mirrors `INVALID_PRICE`)
 */

/** Discriminated union — caller dispatches on `ok`. */
export type ParsedPrice =
  | { ok: true; centimes: number }
  | { ok: false; reason: "empty" | "format" | "fraction" | "negative" };

/** Single source of truth for the « euros UI -> centimes schema » rule. */
export function parsePriceEuros(raw: string): ParsedPrice {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  // Detect a leading minus BEFORE normalising the decimal separator — we
  // want to report « negative » distinctly from « format » so the modal can
  // show the user-visible « doit être positif » message (the explicit mirror
  // of the backend's INVALID_PRICE).
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  // Normalise the decimal separator. Accept exactly ONE separator (« , » or
  // « . »); refuse two of either kind (« 12,5,0 », « 12..50 »).
  const sepCount = (unsigned.match(/[.,]/g) ?? []).length;
  if (sepCount > 1) return { ok: false, reason: "format" };
  const normalised = unsigned.replace(",", ".");

  // Reject inputs that are not a finite plain number after normalisation —
  // catches « abc », « 12abc », « 1e3 » (we don't want exponent syntax).
  if (!/^\d+(?:\.\d+)?$/.test(normalised)) {
    return { ok: false, reason: "format" };
  }
  const value = Number.parseFloat(normalised);
  if (!Number.isFinite(value)) return { ok: false, reason: "format" };

  // Cap at 2 fractional digits (centimes are the smallest unit — refusing
  // « 12,505 » keeps the round-trip lossless and avoids surprising rounding).
  const [, frac] = normalised.split(".");
  if (frac !== undefined && frac.length > 2) {
    return { ok: false, reason: "fraction" };
  }

  if (negative && value > 0) return { ok: false, reason: "negative" };

  // Multiply by 100 with a `Math.round` to dodge the classic float artifact
  // (12.5 * 100 = 1249.9999…). Two fractional digits + round = lossless
  // within the allowed range.
  const centimes = Math.round(value * 100);
  if (centimes < 0) return { ok: false, reason: "negative" };
  return { ok: true, centimes };
}
