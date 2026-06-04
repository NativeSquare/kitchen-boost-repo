/**
 * PWA-S4 (#452) — `menu-revalidate` module API.
 *
 * Pure HMAC validator for the Convex→Next ISR-invalidation channel
 * (`POST /api/revalidate`). The Convex `publishMenu` mutation schedules an
 * internalAction that POSTs `{ tenantId }` signed `x-kb-signature` /
 * `x-kb-timestamp`; the route uses this decision to gate the call to
 * `revalidateTag(menu:<tenantId>)`.
 */
export {
  decideRevalidateRequest,
  type RevalidateInputs,
  type RevalidateVerdict,
} from "./decide-revalidate-request";
