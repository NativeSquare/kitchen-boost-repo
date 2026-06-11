/**
 * `availability` module API — pure decisions for the closed-restaurant UX
 * (Feature A) and the disabled-Livraison address sheet (Feature B).
 *
 * Split « decide » from « perform » so every branch is vitest-pinned in node
 * env without DOM/Convex deps — same shape as `address-first`, `delivery-mode`,
 * `menu-deep-link`.
 */
export {
  clientIsOpenNow,
  decideNextOpening,
  formatNextOpeningLabel,
  type NextOpening,
  type ServiceWindow,
} from "./decide-next-opening";
export {
  decideDisabledDeliveryTap,
  type DisabledDeliveryTapAction,
} from "./decide-disabled-delivery-tap";
