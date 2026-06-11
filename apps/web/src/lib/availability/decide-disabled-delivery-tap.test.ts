/**
 * FEATURE B (#reusable delivery-address sheet) — pure predicate deciding what
 * tapping a DISABLED « Livraison » button must do, given the cached verdict and
 * the live open/closed state. Written BEFORE the implementation (TDD red).
 *
 * A disabled button must NEVER be a dead tap. The branches (spec) :
 *  - resto CLOSED → defer to Feature A's closed sheet (« closed-sheet ») — a
 *    delivery quote is pointless when closed; the address sheet would be a trap.
 *  - verdict null (address unknown — fresh tab deep-link) → address sheet in
 *    PROMPT mode (« Renseigne ton adresse de livraison »).
 *  - verdict hors_zone (address known, not deliverable) → address sheet in EDIT
 *    mode, pre-filled (« Modifie ton adresse de livraison »).
 *  - verdict surge (transient) → address sheet in EDIT mode (re-try / change
 *    address) — the resto is open, livraison just temporarily unavailable.
 *  - deliverable verdict → button is ENABLED, so this predicate is a no-op
 *    (« none »); included for exhaustiveness.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { decideDisabledDeliveryTap } from "./decide-disabled-delivery-tap";

describe("decideDisabledDeliveryTap", () => {
  it("CLOSED resto → defer to the closed sheet (no address sheet)", () => {
    // Even with a null verdict, when closed the closed sheet wins.
    expect(decideDisabledDeliveryTap({ verdict: null, isOpen: false })).toBe(
      "closed-sheet",
    );
  });

  it("CLOSED resto with a hors_zone verdict → still defers to the closed sheet", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_zone",
    };
    expect(decideDisabledDeliveryTap({ verdict, isOpen: false })).toBe(
      "closed-sheet",
    );
  });

  it("OPEN + null verdict → address sheet in PROMPT mode", () => {
    expect(decideDisabledDeliveryTap({ verdict: null, isOpen: true })).toBe(
      "address-prompt",
    );
  });

  it("OPEN + hors_zone → address sheet in EDIT mode (pre-filled)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_zone",
    };
    expect(decideDisabledDeliveryTap({ verdict, isOpen: true })).toBe(
      "address-edit",
    );
  });

  it("OPEN + surge → address sheet in EDIT mode (retry / change address)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "surge",
    };
    expect(decideDisabledDeliveryTap({ verdict, isOpen: true })).toBe(
      "address-edit",
    );
  });

  it("OPEN + hors_horaire verdict but isOpen true (stale verdict) → closed-sheet still wins on the verdict reason", () => {
    // A cached hors_horaire verdict means the resto was closed when quoted; the
    // live `isOpen` may have flipped. We defer to the closed UX on the reason,
    // letting Feature A's live re-eval reconcile.
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_horaire",
    };
    expect(decideDisabledDeliveryTap({ verdict, isOpen: true })).toBe(
      "closed-sheet",
    );
  });

  it("deliverable verdict → none (button is enabled; predicate is a no-op)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: true,
      fee: 295,
      eta: 20,
      quoteId: "q1",
    };
    expect(decideDisabledDeliveryTap({ verdict, isOpen: true })).toBe("none");
  });
});
