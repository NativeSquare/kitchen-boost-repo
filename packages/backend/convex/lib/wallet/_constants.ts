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
 * Visible neutral consumer-side card name — DÉCIDÉ 2026-06-10 (Alex, résolu
 * Q80-Q1 / Q10-Q11) : « Mes Restos » au lieu de l'ancien placeholder
 * « Resto Paris » (qui limitait l'extension hors IDF). Concret, FR,
 * user-friendly, scalable nationalement. Aligné Apple PassKit `organizationName`
 * + Google Wallet Issuer name (« Mes Restos » sur pay.google.com/business/console).
 * Reste updatable plus tard via Wallet push update sans casser les installs
 * (ADR 0003 — le `passTypeIdentifier` technique reste fixe).
 */
export const WALLET_CARD_NAME = "Mes Restos";
