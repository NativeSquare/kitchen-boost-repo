/**
 * PWA-S5 (#453) — `delivery-mode` module API.
 *
 * Pure decisions consumed by `<DeliveryModeProvider>`,
 * `<DeliveryModeToggle>` and `<CartTotals>` (CONTEXT client-ordering
 * « Mode toggle » / decisions-log Q7) :
 *  - `decideInitialMode` — verdict → initial mode + per-button enablement.
 *  - `decideCartTotals` — subtotal × mode × verdict (× optional pricing
 *    absorption) → totals row + fee view.
 *  - `encodeVerdict` / `decodeVerdict` — defensive localStorage helpers
 *    for the cached delivery verdict (S3 writes, S5 reads).
 *
 * Splitting decisions from IO keeps every branch vitest-pinnable in node
 * env, same pattern as `address-first`, `menu-deep-link`, `menu-filters`.
 */
export {
  decideInitialMode,
  type DeliveryMode,
  type InitialModeDecision,
} from "./decide-initial-mode";
export {
  decideCartTotals,
  type CartTotals,
  type DecideCartTotalsInput,
  type DeliveryFeeView,
  type PricingAbsorption,
} from "./decide-cart-totals";
export {
  decodeVerdict,
  encodeVerdict,
  VERDICT_STORAGE_KEY,
} from "./verdict-storage";
