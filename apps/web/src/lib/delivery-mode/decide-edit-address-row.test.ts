/**
 * PWA delivery — pure predicate deciding whether the « Modifier l'adresse »
 * row should render next to the toggle, and with WHICH address text. Written
 * BEFORE the implementation (TDD red).
 *
 * The gap (real feedback): once an address is set AND deliverable (« Livraison »
 * enabled), there is no way to CHANGE it from /menu or /panier — the address
 * sheet only opens when delivery is DISABLED. This row is the missing
 * Uber-Eats-parity affordance: show the current address + a « Modifier » link
 * that re-opens the SAME sheet in `edit` mode.
 *
 * Branch map (spec) :
 *  - deliverable verdict + known non-empty address → show the address.
 *  - deliverable verdict + address still loading (`undefined`) → hide (no flash
 *    of a broken row).
 *  - deliverable verdict + empty/whitespace address → hide (nothing useful to
 *    show or pre-fill).
 *  - non-deliverable verdict (hors_zone / hors_horaire / surge) → hide; those
 *    already get the disabled-button-opens-sheet path.
 *  - null verdict (address unknown) → hide; same reason.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { decideEditAddressRow } from "./decide-edit-address-row";

const DELIVERABLE: DeliveryQuoteVerdict = {
  deliverable: true,
  fee: 295,
  eta: 20,
  quoteId: "q1",
};

describe("decideEditAddressRow", () => {
  it("deliverable verdict + known address → shows that address", () => {
    expect(
      decideEditAddressRow({
        verdict: DELIVERABLE,
        currentAddress: "12 rue de Paris, Évry",
      }),
    ).toEqual({ show: true, address: "12 rue de Paris, Évry" });
  });

  it("deliverable verdict + address still loading (undefined) → hidden", () => {
    expect(
      decideEditAddressRow({ verdict: DELIVERABLE, currentAddress: undefined }),
    ).toEqual({ show: false });
  });

  it("deliverable verdict + empty address → hidden", () => {
    expect(
      decideEditAddressRow({ verdict: DELIVERABLE, currentAddress: "" }),
    ).toEqual({ show: false });
  });

  it("deliverable verdict + whitespace-only address → hidden", () => {
    expect(
      decideEditAddressRow({ verdict: DELIVERABLE, currentAddress: "   " }),
    ).toEqual({ show: false });
  });

  it("trims surrounding whitespace on the shown address", () => {
    expect(
      decideEditAddressRow({
        verdict: DELIVERABLE,
        currentAddress: "  12 rue de Paris  ",
      }),
    ).toEqual({ show: true, address: "12 rue de Paris" });
  });

  it("hors_zone verdict → hidden (disabled-button path owns this)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_zone",
    };
    expect(
      decideEditAddressRow({ verdict, currentAddress: "12 rue de Paris" }),
    ).toEqual({ show: false });
  });

  it("hors_horaire verdict → hidden", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_horaire",
    };
    expect(
      decideEditAddressRow({ verdict, currentAddress: "12 rue de Paris" }),
    ).toEqual({ show: false });
  });

  it("surge verdict → hidden", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "surge",
    };
    expect(
      decideEditAddressRow({ verdict, currentAddress: "12 rue de Paris" }),
    ).toEqual({ show: false });
  });

  it("null verdict (address unknown) → hidden", () => {
    expect(
      decideEditAddressRow({
        verdict: null,
        currentAddress: "12 rue de Paris",
      }),
    ).toEqual({ show: false });
  });
});
