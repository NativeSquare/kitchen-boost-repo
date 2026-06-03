/**
 * #399 — pure decision functions for the header tenant switcher (PRD 20 §1b,
 * §12 + AC7). Same split as `decideForceUpdate` (#394),
 * `decidePushPermissionBanner` (#395) and `decideOnboardingStep` (#398) —
 * keeping React / Convex / Expo out of the matrix means the truth table is
 * pinned by a fast deterministic vitest suite (Node env, no jsdom, no native
 * mocks). The React component `<TenantSwitcher />` is a thin adapter that
 * resolves `getMyDevice` + `getSession` and delegates branching here.
 *
 * Two functions, one module:
 *
 *  - `decideTenantSwitcher` — header visibility verdict. Hidden in kiosque
 *    (tenant pinned, AC1 of #393), hidden when there is no real choice to
 *    make (≤ 1 tenant, kb_admin root, still loading). Visible otherwise with
 *    the list of selectable tenants and the currently active one.
 *
 *  - `resolveActiveTenantId` — which tenant the rest of the app is scoped to
 *    THIS FRAME. In kiosque mode, the pin wins (AC7.d, no leak). In phone
 *    mode, the last selected tenant wins, with the first attached tenant as a
 *    fallback if the persisted hint is no longer accessible (race: KB Ops
 *    detached the user between two launches).
 *
 * Why TWO functions instead of one bigger verdict object: the active tenant
 * is needed by EVERY surface (the home query, the future order list, the push
 * routing) even when the switcher itself is hidden. Splitting keeps each
 * call site narrow — the header reads `decideTenantSwitcher`, every other
 * surface reads `resolveActiveTenantId`. The two reuse the same input shape.
 */

import type { Id } from "@packages/backend/convex/_generated/dataModel";

/** Minimal projection of a tenant the switcher / active-tenant resolver
 * actually need from `getSession`. `slug` / `role` are not exposed here on
 * purpose — the header just needs name + id to render an option, the rest of
 * the app reads the id via `resolveActiveTenantId` and queries Convex directly. */
export type TenantOption = {
  tenantId: Id<"tenants">;
  name: string;
};

/** Minimal projection of `device` from `api.lib.devices.devices.getMyDevice`
 * we actually need to decide. `undefined` while the Convex query is in flight
 * (or before the user is authenticated). The component passes `null` from
 * the query (= no row yet) through as `undefined`; the gate at the root
 * layout already keeps the splash up while `device === undefined`, so this
 * shape is the post-resolution one. */
export type SwitcherDevice = {
  mode: "kiosque" | "telephone" | undefined;
  pinnedTenantId: Id<"tenants"> | undefined;
  lastSelectedTenantId: Id<"tenants"> | undefined;
};

export type TenantSwitcherInputs = {
  /** `undefined` while `getMyDevice` is in flight. */
  device: SwitcherDevice | undefined;
  /** `undefined` while `getSession` is in flight. The array can be empty for
   * degraded states (no attachment yet, kb_admin root, all attachments
   * revoked). */
  tenants: TenantOption[] | undefined;
  /** `getSession().isAdmin` — kb_admin has no `userTenants`, the switcher has
   * no application meaning for the root user (pins are set via KB Admin web
   * per the `(device-setup)` ligne 76-83 convention). */
  isAdmin: boolean;
};

/** Two-state verdict: render the chip or not. When visible, the verdict also
 * carries the list of selectable options and the currently active one — the
 * header doesn't have to re-derive them from the inputs. */
export type TenantSwitcherDecision =
  | { kind: "hidden" }
  | {
      kind: "visible";
      tenants: TenantOption[];
      activeTenantId: Id<"tenants">;
    };

/**
 * Decide whether the header switcher renders this frame. Pure: same inputs ⇒
 * same output, no `Date.now()`, no side effects. Truth table is pinned in
 * `decide-tenant-switcher.test.ts`.
 *
 * Visibility rules (in priority order):
 *
 *  1. Still loading (`device` or `tenants` undefined) → hidden. Defense in
 *     depth: the root layout already keeps a splash spinner up while
 *     `getMyDevice` resolves, but the switcher is mounted inside `(app)` so
 *     a missed input must not flash an empty chip.
 *  2. Kiosque mode → hidden, ALWAYS (PRD 20 §12, AC1 of #393). The pin is
 *     enforced backend-side by `setMyDeviceMode`; we just honour the UX.
 *  3. kb_admin root → hidden (no `userTenants` exposed; the admin pins via
 *     KB Admin web).
 *  4. ≤ 1 attached tenant → hidden. No real choice to surface; a mono-resto
 *     header chip would just be a passive label and not worth the space.
 *  5. Else visible, with the active tenant resolved by `resolveActiveTenantId`.
 */
export function decideTenantSwitcher(
  inputs: TenantSwitcherInputs,
): TenantSwitcherDecision {
  // 1. Loading guard.
  if (inputs.device === undefined || inputs.tenants === undefined) {
    return { kind: "hidden" };
  }
  // 2. Kiosque mode — pinned, switcher hidden (PRD 20 §12 + AC7.b).
  if (inputs.device.mode === "kiosque") {
    return { kind: "hidden" };
  }
  // 3. kb_admin root — no userTenants exposed via getSession.
  if (inputs.isAdmin) {
    return { kind: "hidden" };
  }
  // 4. ≤ 1 attached tenant — no real choice.
  if (inputs.tenants.length <= 1) {
    return { kind: "hidden" };
  }
  // 5. Visible. The active tenant is what the rest of the app reads — and
  //    what the chip itself labels — so we compute it here too.
  const activeTenantId = resolveActiveTenantId(inputs);
  if (activeTenantId === null) {
    // Should not happen (length ≥ 2 ⇒ at least one tenant resolvable), but
    // defend in depth: better hide than render a chip with no label.
    return { kind: "hidden" };
  }
  return {
    kind: "visible",
    tenants: inputs.tenants,
    activeTenantId,
  };
}

/**
 * Resolve which tenant the app is scoped to this frame. Pure. Called by the
 * header (to label the chip) AND by every other surface that needs to filter
 * its Convex queries by the current tenant.
 *
 * Rules (in priority order):
 *
 *  - kiosque mode → `device.pinnedTenantId` IF it's still in the attached
 *    list. If the user lost access between two launches (revocation, detach),
 *    return null — we DO NOT silently leak the pin past the attachment check
 *    (AC7.d "no leak cross-tenant"). The shell handles null with an empty
 *    state; rebascule to phone mode goes via Settings (TB-21).
 *
 *  - phone mode → `device.lastSelectedTenantId` IF still in the list, else
 *    the first attached tenant. If there is no attached tenant at all,
 *    return null.
 *
 *  - kb_admin / loading → null (the rest of the app falls back to the
 *    splash / empty state).
 */
export function resolveActiveTenantId(
  inputs: TenantSwitcherInputs,
): Id<"tenants"> | null {
  if (inputs.device === undefined || inputs.tenants === undefined) {
    return null;
  }
  if (inputs.isAdmin) {
    return null;
  }

  // Kiosque pin wins — but only if the user STILL has access. A stale pin to
  // a detached tenant must not anchor the app there (defense in depth: the
  // pin guard is also enforced backend-side, but the frontend honours the
  // current attachment list).
  if (inputs.device.mode === "kiosque") {
    const pin = inputs.device.pinnedTenantId;
    if (pin === undefined) return null;
    const stillAttached = inputs.tenants.some((t) => t.tenantId === pin);
    return stillAttached ? pin : null;
  }

  // Phone mode — lastSelected if still valid, else first attached.
  if (inputs.tenants.length === 0) return null;
  const hint = inputs.device.lastSelectedTenantId;
  if (hint !== undefined) {
    const stillAttached = inputs.tenants.some((t) => t.tenantId === hint);
    if (stillAttached) return hint;
  }
  return inputs.tenants[0].tenantId;
}
