/**
 * 2.8-A — fixed identifiers of the COMMON neutral Wallet card (ADR 0003).
 *
 * These are CONSTANTS, identical on every pass — the card is ONE common card for
 * all KitchenBoost restos, not one per resto. The Apple `passTypeIdentifier` /
 * `teamIdentifier` are invisible to the client and bound to the real Pass Type ID
 * certificate validated by the POC (`docs/spikes/poc-wallet-real-sign.md`):
 * `pass.com.kitchen-boost.card`, team `NPRZX7J97G` (ALBELO DESIGNS LLC).
 *
 * The neutral consumer-side brand NAME is deliberately NOT "KitchenBoost" literal
 * (ADR 0003 / contrat Article 2 ter): it is a "safe-enough" V1 placeholder. The
 * definitive name is product decision Q80-Q1 (TBD, NON-blocking) — and Wallet lets
 * us update the visible name later WITHOUT breaking installs (the technical
 * `passTypeIdentifier` stays fixed, only the visible branding evolves, ADR 0003).
 * ADR 0003 itself gives "Resto Paris" as the acceptable-enough Phase 1 example.
 */

/** Apple Pass Type ID — FIXED, invisible to the client (POC real cert). */
export const WALLET_PASS_TYPE_IDENTIFIER = "pass.com.kitchen-boost.card";

/** Apple Developer team identifier bound to the Pass Type ID cert (POC). */
export const WALLET_TEAM_IDENTIFIER = "NPRZX7J97G";

/**
 * Visible neutral consumer-side card name — "safe-enough" V1 placeholder per
 * ADR 0003 (definitive name = Q80-Q1, non-blocking, updatable via Wallet push).
 */
export const WALLET_CARD_NAME = "Resto Paris";
