/**
 * 2.8-D — the PURE payload of a Wallet push update (PRD 80, ADR 0003, STACK
 * §2.3/§5.4).
 *
 * `triggerUpdate` (the Convex DEFAULT-runtime action) decides WHAT to push and
 * forwards this value, HMAC-signed, to the Next.js Node route
 * (`apps/admin/api/wallet/push`) where the crypto-heavy APNs HTTP/2 transport
 * actually runs (the auth key is read server-side THERE, never in Convex — US 22).
 * Keeping the body a PURE value (no Convex ctx, no I/O) makes it unit-testable in
 * isolation, exactly like `internalAuth` and the Notifications engine, and lets the
 * Node route type the body it receives without importing the Convex graph.
 *
 * Apple Wallet pushes are CONTENT-FREE: the device, on receiving the APNs push for
 * a pass, re-downloads the updated `.pkpass` from the Web Service (`GET pass/
 * [serial]`, #69). So the payload carries no message text — only WHICH pass
 * (`serialNumber` + the FIXED `passTypeIdentifier`), WHICH devices (`pushTokens`,
 * the APNs tokens of the pass's ACTIVE registrations), and the product distinction:
 *
 *  - `silent: true`  → "Wallet update silencieux" (Info statut, US 16 / PRD 80 §1):
 *    the visible card content changes WITHOUT a lock-screen push. Also the channel
 *    for a visible RE-BRAND (name/logo) pushed without re-install (US 17 / ADR 0003).
 *  - `silent: false` → an effective lock-screen Wallet push (Temps-réel / Archive).
 *
 * The Node route maps `silent` to the APNs push semantics; the SHAPE is fixed here.
 */

/** The body `triggerUpdate` signs + forwards to the Node APNs route. */
export type WalletPushPayload = {
  /** The pass to update (its serial, the APNs/Wallet update address). */
  serialNumber: string;
  /** The FIXED Apple Pass Type ID (invisible client, ADR 0003) — APNs topic input. */
  passTypeIdentifier: string;
  /** The APNs push tokens of the pass's ACTIVE device registrations (slice B). */
  pushTokens: string[];
  /** `true` = silent card update (no lock-screen); `false` = lock-screen push. */
  silent: boolean;
};

/** Fields needed to build a `WalletPushPayload` (mirrors the type, 1:1). */
export type BuildWalletPushPayloadInput = {
  serialNumber: string;
  passTypeIdentifier: string;
  pushTokens: string[];
  silent: boolean;
};

/**
 * Build the Wallet push payload forwarded to the Node APNs route. Pure: it only
 * normalises the inputs into the wire shape (an empty `pushTokens` is preserved —
 * a pass with no active device simply has nothing to push, US 27).
 */
export function buildWalletPushPayload(
  input: BuildWalletPushPayloadInput,
): WalletPushPayload {
  return {
    serialNumber: input.serialNumber,
    passTypeIdentifier: input.passTypeIdentifier,
    pushTokens: [...input.pushTokens],
    silent: input.silent,
  };
}
