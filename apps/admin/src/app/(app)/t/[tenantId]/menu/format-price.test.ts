/**
 * F-MENU-04 (#211) — `formatPriceCentimes` test contract.
 *
 * Pure helper that formats a CENTIMES integer (the schema's canonical money
 * representation — `menuItems.basePrice`, `orderItems` snapshots, etc.) into
 * the human-readable euro string we render inside item cards (« 12,50 € »).
 *
 * Centralised here, alongside the menu route, because:
 *   - It is owned by this slice (no other consumer yet); we lift it to
 *     `apps/admin/src/utils/` only when a second surface needs the same
 *     formatting contract.
 *   - It's pure (no Intl locale plumbing leaks into call sites), trivially
 *     pinnable under `environment: "node"`, and the « centimes-to-euro »
 *     contract is load-bearing for the staff workflow (a faulty render
 *     would mislead the gérant about what they're selling).
 *
 * What's pinned:
 *   - Integer cents → « N,DD € » with French comma decimal separator and a
 *     non-breaking space before the euro sign (Intl.NumberFormat fr-FR).
 *   - 0 cents prints « 0,00 € » (NEVER « gratuit » or empty — the gérant
 *     must SEE the zero so an accidental free item is loud).
 *   - Negative input is rejected (the backend validator already refuses it
 *     — `INVALID_PRICE` in items.ts — so a negative arriving here is a
 *     contract violation, not a user-facing case to format).
 *   - Non-integer input is rejected (centimes are always integers — same
 *     backend validator).
 */
import { describe, expect, it } from "vitest";

import { formatPriceCentimes } from "./format-price";

describe("formatPriceCentimes — F-MENU-04 (#211)", () => {
  it("formats 1250 cents as « 12,50 € » (load-bearing happy path)", () => {
    // The staple gérant case: a 12,50 € dish stored as 1250 centimes.
    // The exact glyph between « 50 » and « € » is Intl's narrow NBSP (U+202F)
    // on modern Node ICU — we assert the digits+separator structure rather
    // than the exact whitespace codepoint so the test stays stable across
    // ICU versions.
    const out = formatPriceCentimes(1250);
    expect(out).toMatch(/^12,50\s?€$/);
  });

  it("formats 0 cents as « 0,00 € » (NEVER « gratuit »: an accidental free item must stay loud)", () => {
    const out = formatPriceCentimes(0);
    expect(out).toMatch(/^0,00\s?€$/);
  });

  it("formats 100 cents as « 1,00 € » (round euro keeps the two decimals)", () => {
    const out = formatPriceCentimes(100);
    expect(out).toMatch(/^1,00\s?€$/);
  });

  it("formats large prices with the FR thousands separator (« 1 234,56 € »)", () => {
    // 123 456 centimes = 1234,56 €. The thousands separator on fr-FR is a
    // narrow NBSP; we only assert that the digits and decimal comma are in
    // the right order — the exact whitespace glyphs are ICU-version-dependent.
    const out = formatPriceCentimes(123456);
    // 1, then optional separator (NBSP or narrow NBSP or regular space),
    // then 234, then comma, then 56, then optional space, then euro sign.
    expect(out).toMatch(/^1\s?234,56\s?€$/);
  });

  it("rejects negative cents (the backend validator already refuses these — INVALID_PRICE)", () => {
    expect(() => formatPriceCentimes(-1)).toThrow();
  });

  it("rejects non-integer cents (centimes are always integers in the schema)", () => {
    expect(() => formatPriceCentimes(1.5)).toThrow();
    expect(() => formatPriceCentimes(Number.NaN)).toThrow();
    expect(() => formatPriceCentimes(Number.POSITIVE_INFINITY)).toThrow();
  });
});
