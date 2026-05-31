/**
 * F-MENU-05 (#219) — `parsePriceEuros`, the inverse of `formatPriceCentimes`:
 * takes a user-typed euro string (e.g. « 12,50 », « 12.5 », « 12 ») and returns
 * a non-negative integer in CENTIMES, OR an error case. Lives next to
 * `format-price.ts` for symmetry, used by the item modal to convert the
 * editable « price » input back into the schema's centimes integer before
 * firing `items.create` / `items.update`.
 *
 * The function is pure (no React, no DOM) so it's testable in isolation —
 * which is critical: this is the front-side mirror of the backend's
 * `assertNonNegativePrice` (`INVALID_PRICE`), and a contract drift between
 * the two would either reject legitimate inputs (bad UX) or pass-through
 * invalid ones that the server then refuses (worse UX + a wasted round-trip).
 *
 * Locale: accepts BOTH « , » (French) and « . » (international) as decimal
 * separators, since the input box doesn't constrain the keystrokes (the user
 * can paste « 12.5 » from a spreadsheet). Rejects everything else (letters,
 * empty, two separators, more than two fractional digits).
 *
 * Returns a discriminated union — caller dispatches on `ok`:
 *   - `{ ok: true, centimes: 1250 }`
 *   - `{ ok: false, reason: "empty" | "format" | "negative" | "fraction" }`
 *
 * The « negative » branch is what surfaces the inline error message in the
 * modal (`data-slot="menu-item-modal-price-error"`). The « format » /
 * « fraction » branches do the same — the user gets a hint without firing a
 * mutation that the backend would reject anyway.
 */
import { describe, expect, it } from "vitest";

import { parsePriceEuros } from "./parse-price";

describe("parsePriceEuros — F-MENU-05 (#219)", () => {
  it("parses an integer-euros input", () => {
    expect(parsePriceEuros("12")).toEqual({ ok: true, centimes: 1200 });
    expect(parsePriceEuros("0")).toEqual({ ok: true, centimes: 0 });
  });

  it("parses a French-locale input (« 12,50 »)", () => {
    expect(parsePriceEuros("12,50")).toEqual({ ok: true, centimes: 1250 });
    expect(parsePriceEuros("12,5")).toEqual({ ok: true, centimes: 1250 });
  });

  it("parses an international-locale input (« 12.50 »)", () => {
    expect(parsePriceEuros("12.50")).toEqual({ ok: true, centimes: 1250 });
    expect(parsePriceEuros("12.5")).toEqual({ ok: true, centimes: 1250 });
  });

  it("rejects an empty / whitespace-only input", () => {
    expect(parsePriceEuros("")).toEqual({ ok: false, reason: "empty" });
    expect(parsePriceEuros("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a negative euro input (mirrors INVALID_PRICE backend guard)", () => {
    expect(parsePriceEuros("-1")).toEqual({ ok: false, reason: "negative" });
    expect(parsePriceEuros("-12,50")).toEqual({
      ok: false,
      reason: "negative",
    });
  });

  it("rejects a non-numeric input", () => {
    expect(parsePriceEuros("abc")).toEqual({ ok: false, reason: "format" });
    expect(parsePriceEuros("12,5,0")).toEqual({ ok: false, reason: "format" });
    expect(parsePriceEuros("12..50")).toEqual({ ok: false, reason: "format" });
  });

  it("rejects more than 2 fractional digits (centimes are the smallest unit)", () => {
    expect(parsePriceEuros("12,505")).toEqual({
      ok: false,
      reason: "fraction",
    });
    expect(parsePriceEuros("12.999")).toEqual({
      ok: false,
      reason: "fraction",
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parsePriceEuros("  12,50  ")).toEqual({ ok: true, centimes: 1250 });
  });
});
