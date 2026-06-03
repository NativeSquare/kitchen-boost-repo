/**
 * Public API of the `tenant-status` native module (#411 KB Orders, PRD 20 §13 +
 * `docs/contexts/kb-orders/CONTEXT.md` « Alerte statut critique »).
 *
 * Three exports cover the contract of the « Alertes statut tenant » feature :
 *
 *  - `TenantStatusCriticalGate` — the React component the `(app)/_layout.tsx`
 *    mounts ABOVE its route stack. Replaces the tree with a full-screen red
 *    blocking overlay when the tenant backend status is critical (Stripe
 *    Connect KO, OR Uber Direct KO + livraison seule = mode actif). Same
 *    art-direction as the other root-level red gates: #394, #400, #405.
 *
 *  - `TenantStatusBanner` — the sibling persistent banner the layout mounts
 *    ABOVE the stack but BELOW the critical gate. Surfaces when the verdict
 *    is `warning` (KYC pending, Uber dégradé, statut tenant lifecycle pas
 *    `active`). Dismissible le temps de la session — re-apparaît au cold
 *    launch tant que le backend n'est pas réglé.
 *
 *  - `decideTenantStatus` — the PURE decision function (no React, no Convex,
 *    no Expo). Pinned by the vitest suite next door. Same split convention as
 *    `decideForceUpdate` (#394), `decideSessionRevoked` (#400),
 *    `decideConnectionLost` (#405).
 *
 * The backend query consumed by both components is
 * `api.lib.orders.orders.getTenantHealth` — a tenant-scoped read added to the
 * `lib/orders/orders.ts` module in this same story (no separate backend slice,
 * cf. memory `backend-embedded-in-frontend-story`). The query is fuzz-protected
 * (ADR 0010 cross-tenant guarantee) and authorised for `kb_manager` + `staff`
 * (operational allow — same as the rest of the kb-orders module).
 *
 * Priority chain inside the native app:
 *     auth (#400) > Convex sub (#405) > critical (#411) > banner (#411 bis).
 * The outer gates already replace the tree before we reach `(app)`, so this
 * module only handles the steady-state in-app posture.
 */
export { TenantStatusCriticalGate } from "./tenant-status-gate";
export { TenantStatusBanner } from "./tenant-status-banner";
export {
  decideTenantStatus,
  type TenantStatusDecision,
  type TenantStatusInputs,
} from "./decide-tenant-status";
