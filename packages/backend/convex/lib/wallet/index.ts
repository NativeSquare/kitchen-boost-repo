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

/**
 * 2.8-C — the cross-device IDENTITY BRIDGE (ADR 0008/0012) + the `pass_installed`
 * event. `linkSerialToCustomer` is the reusable seam (takes a mutation ctx, no
 * Convex registration): on a real install it writes the Wallet `serial → customer_id`
 * onto the 2.1 Customer Data fiche (`pushEnrollment`, the AUTHORITATIVE bridge) +
 * flips the wallet push enrollment to `enrolled` (joignabilité = source de vérité
 * 2.1, ADR 0012), and marks its OWN technical pass row `installed`. It returns only
 * the bridged `customerId` — NEVER a raw `customer` (the MOAT). It is surfaced here
 * for the contract; the Convex FUNCTIONS (`handlePassInstalled` internal mutation +
 * `verifyInstallAuth` public guard) are NOT re-exported — Convex addresses them by
 * their module path (`api.lib.wallet.linkSerial.*`), same convention as
 * `generatePass` / `registrations`.
 */
export { linkSerialToCustomer } from "./linkSerial";

/**
 * 2.8-D — the Wallet push-update CHANNEL (PRD 80, ADR 0003, STACK §2.3/§5.4, US
 * 15/16/17/22/27). `triggerUpdate` (a DEFAULT-runtime Convex action) resolves a
 * customer's pass + active device tokens, HMAC-signs the payload and forwards it to
 * the Next.js Node route (`apps/admin/api/wallet/push`) where the crypto-heavy APNs
 * HTTP/2 transport runs (the auth key is read server-side THERE, never in Convex —
 * US 22). It is the cascade channel 2.7 calls (US 15) without knowing the signature
 * / APNs plumbing, and it distinguishes the silent Wallet update (Info statut, US
 * 16) — also the re-branding channel (US 17 / ADR 0003) — from a lock-screen push.
 *
 * The PURE payload builder + its types are surfaced for the structure tests + the
 * Node route's body typing. The Convex FUNCTIONS (`triggerUpdate` internal action,
 * `resolvePushTargets` internal query, `recordPushResult` internal mutation) are
 * NOT re-exported — Convex addresses them by their module path
 * (`internal.lib.wallet.triggerUpdate.*`), same convention as `generatePass` /
 * `registrations` / `linkSerial`.
 */
export {
  type BuildWalletPushPayloadInput,
  type WalletPushPayload,
  buildWalletPushPayload,
} from "./pushPayload";

/**
 * 2.8-E — the Incentive Wallet CONDITIONAL delivery mechanism (PRD 80, ADR 0002,
 * [[Incentive Wallet]] glossaire client-ordering, US 19 / US 20 / US 24).
 * `deliverIncentive` is the reusable seam (takes a mutation ctx, no Convex
 * registration): the install handler (`linkSerialToCustomer`) calls it AFTER proving
 * the pass is REALLY installed, so the reward code is delivered ONLY on a constated
 * `pass_installed` — there is NO alternative generation path (no fake reward, US 19).
 * It records at most ONE delivery per pass serial (US 20 — one reward per pass, never
 * per device) and audits the first delivery (US 24). It is surfaced here for the
 * contract; the Convex FUNCTION (`incentiveDeliveryStatus` public guard query) is NOT
 * re-exported — Convex addresses it by its module path
 * (`api.lib.wallet.incentive.incentiveDeliveryStatus`), same convention as
 * `generatePass` / `registrations` / `linkSerial` / `triggerUpdate`.
 */
export { deliverIncentive } from "./incentive";
