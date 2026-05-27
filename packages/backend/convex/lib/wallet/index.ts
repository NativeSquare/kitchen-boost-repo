/**
 * Public API of the `wallet` backend module (chantier 2.8 — Wallet pass, PRD 80
 * Notifications, ADR 0003 carte commune sous marque neutre).
 *
 * 2.8-A — GENERATION of the COMMON neutral Wallet card in BOTH ecosystems, no UI:
 *  - `generatePass` — the `"use node"` ACTION (POC #3 / Phase B validated the real
 *    signing here: `.pkpass` PKCS#7 + Google "Save" JWT RS256, no Next.js plan B).
 *    Customer-scoped (scope self, ADR 0010/0011): a client generates only its OWN
 *    card. The Apple p12 / passphrase + Google service-account JSON are read from
 *    ENV vars server-side (US 22) — there is deliberately NO query returning them.
 *    Convex addresses it by its module path
 *    (`api.lib.wallet.generatePass.generatePass`); the guard query + persistence
 *    mutation live in `passDb.ts` (`api.lib.wallet.passDb.*`). Every generation is
 *    audited via `logAudit` (US 24). The Convex FUNCTIONS are NOT re-exported from
 *    this barrel — a barrel re-export of a `"use node"` action would drag the Node
 *    runtime into the default V8 graph (same convention as `lib/stripe/index.ts`).
 *    Only the PURE builders + fixed identifiers + types are surfaced here.
 *
 * The card is a COMMON NEUTRAL card (ADR 0003): a FIXED `passTypeIdentifier`
 * (invisible client), NO authoritative `tenantId` on the pass, and the visible
 * branding (header = last resto ordered, "Membre [Nom carte]") is a USAGE carried
 * by `lastBrandTenantId`. The technical pass state lives in the GLOBAL
 * `walletPasses` table, reached only through the sanctioned `lib/tenancy` seam; the
 * AUTHORITATIVE serial→customer identity bridge lives in 2.1
 * (`customers.pushEnrollment`, ADR 0008/0012) and is NOT duplicated.
 *
 * The PURE structure builders + the fixed identifiers (unit-testable in isolation,
 * no signing, no ctx) are exposed for the structure tests + downstream slices
 * (push update #71, the Add-to-Wallet button #69):
 */
export {
  WALLET_CARD_NAME,
  WALLET_PASS_TYPE_IDENTIFIER,
  WALLET_TEAM_IDENTIFIER,
} from "./_constants";
export {
  type ApplePassField,
  type ApplePassJson,
  type BuildApplePassInput,
  type BuildGoogleClaimsInput,
  type GoogleGenericObject,
  type GoogleWalletClaims,
  buildApplePassJson,
  buildGoogleWalletClaims,
  googleWalletSaveLink,
} from "./passBuilders";

/**
 * 2.8-B — the PURE auth helpers of the Apple Wallet Web Service (US 23 / US 10),
 * surfaced for the Next.js Node routes (`apps/admin/api/wallet/*`) that run the
 * binary `.pkpass` + `Authorization: ApplePass …` handling. They are PURE
 * (`crypto.subtle`, no ctx, no signing certs), so the Node route reuses them
 * verbatim to (a) sign / verify the internal Convex↔Node channel and (b) derive /
 * verify the per-pass PassKit token. The Convex FUNCTIONS in `registrations.ts`
 * (`registerDevice` / `unregisterDevice` / `verifyDeviceAuth`) are NOT re-exported
 * — Convex addresses them by their module path (`api.lib.wallet.registrations.*`),
 * same convention as `generatePass`.
 */
export {
  type SignedInternalRequest,
  parseApplePassAuthorization,
  signInternalRequest,
  verifyInternalRequest,
  verifyWalletPassAuthToken,
  walletPassAuthToken,
} from "./internalAuth";
