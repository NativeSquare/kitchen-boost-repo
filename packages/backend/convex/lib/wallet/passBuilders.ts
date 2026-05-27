import {
  WALLET_CARD_NAME,
  WALLET_PASS_TYPE_IDENTIFIER,
  WALLET_TEAM_IDENTIFIER,
} from "./_constants";

/**
 * 2.8-A — PURE pass-structure builders (no network, no signing, no Convex ctx).
 *
 * They produce the STRUCTURE of the two passes — the Apple `pass.json` and the
 * Google Wallet "Save" JWT claim set — that the `"use node"` `generatePass` action
 * later SIGNS with the real certs (PKCS#7 for Apple, RS256 for Google). Splitting
 * the structure out keeps it unit-testable in isolation (the signature itself is
 * validated by the POC + a device e2e, not in CI).
 *
 * Both encode the ADR 0003 COMMON-NEUTRAL-CARD contract:
 *  - a FIXED `passTypeIdentifier` (invisible to the client, identical on every pass),
 *  - a NEUTRAL consumer-side brand name (`WALLET_CARD_NAME`, NOT "KitchenBoost"),
 *  - the VISIBLE branding = the LAST resto ordered (`brandTenantName`, a USAGE —
 *    optional, absent on a freshly-generated card),
 *  - the footer mention "Membre [Nom carte]".
 */

// ---------------------------------------------------------------------------
// Apple — pass.json (a generic PassKit card)
// ---------------------------------------------------------------------------

/** A single PassKit field (a label/value pair shown on the generic card). */
export type ApplePassField = {
  key: string;
  label?: string;
  value: string;
};

/** The minimal shape of an Apple `pass.json` for the common neutral card. */
export type ApplePassJson = {
  formatVersion: 1;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  organizationName: string;
  description: string;
  generic: {
    headerFields: ApplePassField[];
    primaryFields: ApplePassField[];
    secondaryFields: ApplePassField[];
    auxiliaryFields: ApplePassField[];
  };
};

export type BuildApplePassInput = {
  /** The pass primary key — embedded in the signed pass + the persisted row. */
  serialNumber: string;
  /** Visible header brand = the LAST resto ordered (a USAGE). Omitted ⇒ no header. */
  brandTenantName?: string;
};

/**
 * Build the Apple `pass.json` for the common neutral card. The
 * `passTypeIdentifier` / `teamIdentifier` are the FIXED constants (ADR 0003); the
 * header brand field is added ONLY when a `brandTenantName` is supplied (the last
 * resto ordered); the footer carries "Membre [Nom carte]".
 */
export function buildApplePassJson(input: BuildApplePassInput): ApplePassJson {
  const headerFields: ApplePassField[] = input.brandTenantName
    ? [{ key: "brand", label: "Resto", value: input.brandTenantName }]
    : [];

  return {
    formatVersion: 1,
    passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
    teamIdentifier: WALLET_TEAM_IDENTIFIER,
    serialNumber: input.serialNumber,
    // Neutral consumer-side brand (ADR 0003) — NOT "KitchenBoost" literal.
    organizationName: WALLET_CARD_NAME,
    description: `Carte ${WALLET_CARD_NAME}`,
    generic: {
      headerFields,
      primaryFields: [{ key: "card", label: "Carte", value: WALLET_CARD_NAME }],
      secondaryFields: [],
      // "Membre [Nom carte]" mention at the bottom of the card.
      auxiliaryFields: [
        {
          key: "membership",
          label: "Membre",
          value: `Membre ${WALLET_CARD_NAME}`,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Google Wallet — "Save to Google Wallet" JWT claims
// ---------------------------------------------------------------------------

/** The Google Wallet generic object embedded in the Save JWT. */
export type GoogleGenericObject = {
  id: string;
  classId: string;
  state: "ACTIVE";
  cardTitle: { defaultValue: { language: string; value: string } };
  header: { defaultValue: { language: string; value: string } };
};

/** The "Save to Google Wallet" JWT claim set (signed RS256 by the SA key). */
export type GoogleWalletClaims = {
  iss: string;
  aud: "google";
  typ: "savetowallet";
  iat: number;
  origins: string[];
  payload: { genericObjects: GoogleGenericObject[] };
};

export type BuildGoogleClaimsInput = {
  serialNumber: string;
  /** Google Wallet Issuer ID (env). The object id is `${issuerId}.${serial}`. */
  issuerId: string;
  /** The fixed GenericClass id the object belongs to. */
  classId: string;
  /** The SA email (the JWT `iss`). */
  serviceAccountEmail: string;
  /** Allowed origins for the Save button. */
  origins: string[];
  /** Visible header brand = the LAST resto ordered (a USAGE). */
  brandTenantName?: string;
  /** Issued-at (seconds). Defaults to now — injectable for deterministic tests. */
  iat?: number;
};

/**
 * Build the "Save to Google Wallet" JWT claim set for the common neutral card.
 * The generic object id is derived from the serial (`${issuerId}.${serial}`),
 * the card title shows the brand resto (the last ordered, a USAGE) when supplied,
 * and the header carries "Membre [Nom carte]".
 */
export function buildGoogleWalletClaims(
  input: BuildGoogleClaimsInput,
): GoogleWalletClaims {
  const sanitizedSerial = input.serialNumber.replace(/[^\w.-]/g, "_");
  const title = input.brandTenantName
    ? `${WALLET_CARD_NAME} · ${input.brandTenantName}`
    : WALLET_CARD_NAME;

  return {
    iss: input.serviceAccountEmail,
    aud: "google",
    typ: "savetowallet",
    iat: input.iat ?? Math.floor(Date.now() / 1000),
    origins: input.origins,
    payload: {
      genericObjects: [
        {
          id: `${input.issuerId}.${sanitizedSerial}`,
          classId: input.classId,
          state: "ACTIVE",
          cardTitle: { defaultValue: { language: "fr", value: title } },
          header: {
            defaultValue: {
              language: "fr",
              value: `Membre ${WALLET_CARD_NAME}`,
            },
          },
        },
      ],
    },
  };
}

/** Wrap a signed JWT into the canonical "Save to Google Wallet" link. */
export function googleWalletSaveLink(jwt: string): string {
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
