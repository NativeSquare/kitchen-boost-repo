import { describe, expect, it } from "vitest";
import {
  WALLET_CARD_NAME,
  WALLET_PASS_TYPE_IDENTIFIER,
  WALLET_TEAM_IDENTIFIER,
  buildApplePassJson,
  buildGoogleWalletClaims,
  googleWalletSaveLink,
} from "./index";

/**
 * 2.8-A — the PURE pass builders, written BEFORE the implementation (TDD red).
 *
 * No network, no signing, no Convex ctx — these produce the STRUCTURE of the two
 * passes (Apple `pass.json`, Google Wallet JWT claims) that the `"use node"`
 * `generatePass` action later SIGNS with the real certs. They encode the ADR 0003
 * common-neutral-card contract: a FIXED `passTypeIdentifier` (invisible client),
 * the visible branding = the LAST resto ordered, and "Membre [Nom carte]".
 */

describe("2.8-A buildApplePassJson — Apple pass.json structure (ADR 0003)", () => {
  it("uses the FIXED passTypeIdentifier + teamIdentifier on every pass", () => {
    const pass = buildApplePassJson({ serialNumber: "kb-serial-1" });
    expect(pass.passTypeIdentifier).toBe(WALLET_PASS_TYPE_IDENTIFIER);
    expect(pass.teamIdentifier).toBe(WALLET_TEAM_IDENTIFIER);
    // Sanity: the fixed id is the neutral KB card id, NOT a per-resto value.
    expect(WALLET_PASS_TYPE_IDENTIFIER).toBe("pass.com.kitchen-boost.card");
  });

  it("embeds the serialNumber it is given", () => {
    const pass = buildApplePassJson({ serialNumber: "kb-serial-xyz" });
    expect(pass.serialNumber).toBe("kb-serial-xyz");
  });

  it('is a NEUTRAL common card — organizationName is the card name, footer says "Membre [Nom carte]"', () => {
    const pass = buildApplePassJson({ serialNumber: "kb-serial-1" });
    // Neutral consumer-side brand — NOT "KitchenBoost" literal (ADR 0003).
    expect(pass.organizationName).toBe(WALLET_CARD_NAME);
    expect(WALLET_CARD_NAME).not.toContain("KitchenBoost");
    // "Membre [Nom carte]" rendered somewhere in the generic card fields.
    const flat = JSON.stringify(pass);
    expect(flat).toContain(`Membre ${WALLET_CARD_NAME}`);
  });

  it("shows the LAST resto ordered as the visible header brand when supplied", () => {
    const pass = buildApplePassJson({
      serialNumber: "kb-serial-1",
      brandTenantName: "Buns & Bao",
    });
    const header = pass.generic.headerFields;
    expect(JSON.stringify(header)).toContain("Buns & Bao");
  });

  it("omits the brand header when no resto has been ordered yet", () => {
    const pass = buildApplePassJson({ serialNumber: "kb-serial-1" });
    // No brand resto → no header brand field (a freshly-generated card).
    expect(pass.generic.headerFields).toEqual([]);
  });
});

describe("2.8-A buildGoogleWalletClaims — Save to Google Wallet JWT claims", () => {
  const base = {
    serialNumber: "kb-serial-1",
    issuerId: "3388000000022222222",
    classId: "3388000000022222222.kb-card",
    serviceAccountEmail:
      "kitchenboost-wallet@kitchen-boost.iam.gserviceaccount.com",
    origins: ["https://bunsbao.fr"],
  };

  it("issues a well-formed Save claim set (iss/aud/typ/origins/payload)", () => {
    const claims = buildGoogleWalletClaims(base);
    expect(claims.iss).toBe(base.serviceAccountEmail);
    expect(claims.aud).toBe("google");
    expect(claims.typ).toBe("savetowallet");
    expect(claims.origins).toEqual(base.origins);
    // The generic object carries the fixed class + the serial-derived object id.
    const obj = claims.payload.genericObjects[0];
    expect(obj.classId).toBe(base.classId);
    expect(obj.id).toBe(`${base.issuerId}.kb-serial-1`);
    expect(obj.state).toBe("ACTIVE");
  });

  it("renders the brand resto into the card title when supplied", () => {
    const claims = buildGoogleWalletClaims({
      ...base,
      brandTenantName: "Buns & Bao",
    });
    expect(JSON.stringify(claims.payload.genericObjects[0])).toContain(
      "Buns & Bao",
    );
  });

  it('carries the neutral "Membre [Nom carte]" mention', () => {
    const claims = buildGoogleWalletClaims(base);
    expect(JSON.stringify(claims.payload.genericObjects[0])).toContain(
      `Membre ${WALLET_CARD_NAME}`,
    );
  });
});

describe("2.8-A googleWalletSaveLink", () => {
  it("wraps a signed JWT into the pay.google.com save link", () => {
    expect(googleWalletSaveLink("SIGNED.JWT.HERE")).toBe(
      "https://pay.google.com/gp/v/save/SIGNED.JWT.HERE",
    );
  });
});
