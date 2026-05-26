/**
 * 2.5-B — the IMMUTABLE KitchenBoost commission (PRD 30 §2, Q30-Q1 + Q30-Q7,
 * payment CONTEXT). NO per-tenant config path in V1: a single fixed value for
 * EVERY tenant, hard-coded here so there is literally no code path that varies it
 * (a commercial gesture is a manual off-system credit note, not a fee change —
 * payment CONTEXT). V2 will make this configurable per tenant from KB Admin root.
 *
 * Stripe's `application_fee_amount` is in centimes TTC; the DB stores the HT
 * amount for CGI-compliant reporting (the resto deducts the 20 % TVA).
 *  - TTC = 240 cts = 2,40 € = 2,00 € HT + 20 % TVA.
 *  - HT  = 200 cts = 2,00 € (what `payments.applicationFeeAmountHt` records).
 */

/** KB commission sent to Stripe as `application_fee_amount` — centimes TTC. */
export const APPLICATION_FEE_AMOUNT_TTC = 240 as const;

/** KB commission stored in the `payments` row — centimes HT (reporting, Q30-Q7). */
export const APPLICATION_FEE_AMOUNT_HT = 200 as const;
