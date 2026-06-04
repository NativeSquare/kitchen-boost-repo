/**
 * PWA-S3 (#451) — `address-first` module API.
 *
 * The `<AddressFirstForm>` (client) component consumes:
 *  - `decideAddressFirstAction(verdict)` → pure UI action (redirect / message).
 *
 * The IO surface (Google Places loader, Convex `useMutation` /
 * `useAction` chain, `useRouter` navigation, toast) is wired by the component
 * itself — splitting "decide" from "perform" lets vitest pin every branch in
 * node env without DOM/Convex deps (same shape as PWA-S1's tenant-resolver +
 * PWA-S2's pwa-manifest).
 *
 * Types are re-exported so the form (and any future RSC reading the verdict
 * from a server action) shares ONE source of truth for the wire shape
 * (`DeliveryQuoteVerdict`) + the action shape (`AddressFirstAction`).
 */
export {
  decideAddressFirstAction,
  type AddressFirstAction,
  type DeliveryQuoteReason,
  type DeliveryQuoteVerdict,
} from "./decide-address-first-action";
