/**
 * Public API of the `tenant-switcher` native module (#399 KB Orders, PRD 20
 * §1b + §12 + AC7).
 *
 * Three exports cover the contract of the header switcher:
 *
 *  - `TenantSwitcher` — the React component the `(app)` shell mounts above
 *    `<Stack>`. Hidden in kiosque mode (tenant pinned, AC1 of #393),
 *    hidden for kb_admin / mono-tenant / loading states, visible otherwise
 *    with a bottom-sheet picker.
 *
 *  - `useActiveTenantId` — hook for every surface that needs the active
 *    tenantId to scope its Convex queries (AC7 « pas de leak cross-tenant »).
 *    Returns `null` while inputs load or when no tenant is resolvable.
 *
 *  - `decideTenantSwitcher` / `resolveActiveTenantId` — the PURE decision
 *    functions (no React, no Expo, no Convex). Pinned by the vitest suite
 *    next door. Same split convention as `decideForceUpdate` (#394) and the
 *    other lib/ modules.
 *
 * Cross-tenant fuzz: the backend pin guard (#393 `setMyDeviceLastSelectedTenant`
 * + cross-tenant test in `devices.test.ts`) is the source of truth for "no
 * leak". This module's `resolveActiveTenantId` defends in depth on the read
 * side — a stale pin pointing at a detached tenant resolves to `null` rather
 * than silently anchoring the app there.
 */
export { TenantSwitcher, useActiveTenantId } from "./tenant-switcher";
export {
  decideTenantSwitcher,
  resolveActiveTenantId,
  type TenantOption,
  type TenantSwitcherDecision,
  type TenantSwitcherInputs,
  type SwitcherDevice,
} from "./decide-tenant-switcher";
