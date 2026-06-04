/**
 * #418 — pure decision functions for the Settings screen (PRD 20 §10).
 *
 * Same split convention as the other native lib modules (`decideForceUpdate`
 * #394, `decideTenantSwitcher` #399, `decideClosureControl` #407,
 * `decidePauseControl` #406, `decidePrinterConfigForm` #412) — React, Expo,
 * Convex stay OUT so the visibility matrix is pinned by a fast deterministic
 * vitest suite (node env, no jsdom, no native mocks).
 *
 * The Settings screen aggregates sections that are ALREADY built by upstream
 * stories. This module decides:
 *
 *  - **Section visibility** — which sections render, based on the resolved
 *    device mode (kiosque vs téléphone, #393), the number of tenants attached
 *    to the actor (the Switcher row only makes sense for N-tenants users
 *    in phone mode, PRD 20 §1b/§12), and the `kb_admin` root override
 *    (sees a stripped-down view — no tenant-scoped sections).
 *
 *  - **Mode rebascule confirmation** — switching from kiosque ↔ téléphone
 *    requires an app reload to re-arm the layouts (the `(app)` shell hides
 *    or surfaces the TenantSwitcher above the Stack based on `device.mode`).
 *    The decision exposes the confirmation copy and the rebascule target so
 *    the screen can prompt « L'app va redémarrer pour appliquer le
 *    changement » before firing the mutation + `Updates.reloadAsync()`.
 *
 * No Convex queries, no `Date.now()`, no `Platform.OS` here — those resolve
 * in the host component and are passed in as inputs.
 */

import type { Id } from "@packages/backend/convex/_generated/dataModel";

/** Per-device mode resolved by `getMyDevice` (#393). */
export type DeviceMode = "kiosque" | "telephone";

/** The session shape `getSession` exposes (cf. lib/auth/getSession.ts). */
export type SettingsSessionInputs = {
  isAdmin: boolean;
  tenantCount: number;
};

/** All inputs the section visibility decision consumes. */
export type SettingsVisibilityInputs = {
  /** `null` while the device row is loading (SecureStore + Convex sub). */
  deviceMode: DeviceMode | null;
  /** `null` while `getSession` is still resolving. */
  session: SettingsSessionInputs | null;
};

/**
 * The set of sections the Settings screen surfaces. Booleans are explicit
 * (rather than an opaque array of section IDs) so a typo at the call site
 * fails at type-check time, and the JSX stays readable.
 *
 * PRD 20 §10 enumerates the sections; this decision only handles VISIBILITY
 * (showSwitcher, showKiosqueToggle), not the section CONTENTS which are
 * delegated to the sibling modules (`PrinterSettingsScreen` from
 * `lib/printing` for the printer slice, etc.).
 */
export type SettingsVisibilityDecision = {
  /** Profile (always — every authenticated user has a profile). */
  showProfile: boolean;
  /** Notifs (DNT + sons + vibration) — always for authenticated users. */
  showNotifs: boolean;
  /**
   * Compte rattaché (tenant name + Stripe + Uber + KB Admin link) — hidden
   * for `kb_admin` (root, no userTenants attachment) AND while session
   * loads. The kb_admin uses KB Admin web for tenant management.
   */
  showAccountTenant: boolean;
  /**
   * Imprimante cuisine entry — hidden for kb_admin (no tenant scope to
   * configure) AND while session loads. PRD 20 §14: printer config is
   * per-tenant.
   */
  showPrinter: boolean;
  /**
   * Switcher tenant row — only in `téléphone` mode AND only for N>=2 tenants
   * (mono-tenant users have nothing to switch). PRD 20 §1b « switcher tenant
   * caché en mode kiosque ». kb_admin handles tenant pinning via KB Admin
   * web (PRD 20 §1c).
   */
  showSwitcher: boolean;
  /**
   * Toggle mode kiosque/téléphone — always visible for non-admin authenticated
   * users (the kb_admin doesn't run KB Orders on a device, see
   * `(device-setup)` where kb_admin is bounced back to téléphone). Hidden
   * while device mode is still loading to avoid flashing a wrong default.
   */
  showKiosqueToggle: boolean;
  /** Logout — always for authenticated users. */
  showLogout: boolean;
  /** Version app + check update — always (it's pre-auth-safe). */
  showVersion: boolean;
  /** Lien support KB — always. */
  showSupport: boolean;
};

/**
 * Decide which sections the Settings screen renders. Pure: same inputs ⇒
 * same output. The host component reads `device.mode` + `session` from
 * Convex queries and passes them in; sections render conditionally on the
 * returned booleans.
 *
 * Defensive defaults: while EITHER input is loading (`null`), tenant-scoped
 * sections are kept off — better a discreet placeholder than a flash of
 * « no tenant linked » followed by the real tenant a frame later.
 */
export function decideSettingsVisibility(
  inputs: SettingsVisibilityInputs,
): SettingsVisibilityDecision {
  const { deviceMode, session } = inputs;

  const sessionReady = session !== null;
  const isAdmin = session?.isAdmin === true;
  const tenantCount = session?.tenantCount ?? 0;
  const modeReady = deviceMode !== null;
  const isKiosque = deviceMode === "kiosque";

  // Profile + Notifs + Logout + Version + Support are universally visible
  // for authenticated users. Notifs in particular do NOT depend on the
  // tenant — DNT / sons / vibration are device-level preferences (PRD 20
  // §3 « configurable côté Settings »).
  const showProfile = true;
  const showNotifs = true;
  const showLogout = true;
  const showVersion = true;
  const showSupport = true;

  // Tenant-scoped sections: only when a non-admin session with >= 1 tenant
  // is fully resolved. The kb_admin uses KB Admin web for tenant config
  // (PRD 20 §1c). Sections stay off while the session loads — avoids the
  // flash of an empty « Compte rattaché » section before the row arrives.
  const showAccountTenant = sessionReady && !isAdmin && tenantCount >= 1;
  const showPrinter = sessionReady && !isAdmin && tenantCount >= 1;

  // Switcher row: phone mode only (PRD 20 §1b: « caché en mode kiosque »)
  // AND >= 2 tenants (mono-tenant has nothing to switch). kb_admin uses KB
  // Admin web — same exclusion as the runtime header switcher (#399).
  const showSwitcher =
    sessionReady && modeReady && !isAdmin && !isKiosque && tenantCount >= 2;

  // Kiosque toggle row: visible whenever the device mode has resolved AND
  // the user is non-admin. PRD 20 §12: « Toggle re-modifiable depuis
  // Settings (#418) pour rebasculer ». kb_admin is bounced back to
  // téléphone in `(device-setup)` and doesn't see this row.
  const showKiosqueToggle = sessionReady && modeReady && !isAdmin;

  return {
    showProfile,
    showNotifs,
    showAccountTenant,
    showPrinter,
    showSwitcher,
    showKiosqueToggle,
    showLogout,
    showVersion,
    showSupport,
  };
}

// ---------------------------------------------------------------------------
// Mode rebascule confirmation
// ---------------------------------------------------------------------------

/**
 * Inputs for the « rebasculer mode » confirmation flow (PRD 20 §10 point 6).
 *
 *  - The current mode is the one we are CURRENTLY in (read from
 *    `device.mode`). The decision derives the TARGET as the opposite.
 *  - `tenants` lets us tell whether kiosque ↔ téléphone needs an extra
 *    « which tenant to pin » prompt (kiosque mode requires a `pinnedTenantId`
 *    — see `setMyDeviceMode` backend invariant).
 */
export type RebasculeModeInputs = {
  currentMode: DeviceMode;
  /** Active tenants of the user (empty for kb_admin or unattached). */
  attachedTenantIds: Array<Id<"tenants">>;
};

/**
 * The verdict the screen acts on after the user taps « Mode kiosque » /
 * « Mode téléphone ». Four branches:
 *
 *  - `noop` — the user tapped the row matching the current mode. Nothing
 *    to do (shouldn't normally fire, the row hides the active option,
 *    but the matrix is exhaustive).
 *  - `confirm-telephone` — switching kiosque → téléphone. Just confirm,
 *    no tenant pin needed (the backend setter clears the existing pin).
 *  - `confirm-kiosque-mono` — switching téléphone → kiosque with exactly
 *    one tenant attached. The pinned tenant is implicit; just confirm.
 *  - `confirm-kiosque-pick` — switching téléphone → kiosque with N tenants.
 *    Need to surface the « pour quel restaurant ? » picker (mirrors the
 *    `(device-setup)` flow, #393).
 *  - `unavailable-kiosque-no-tenant` — switching téléphone → kiosque but
 *    no tenant is attached. The mode would be a no-op (no orders to
 *    receive) — block with a friendly message, same as `(device-setup)`.
 */
export type RebasculeModeDecision =
  | { kind: "noop" }
  | { kind: "confirm-telephone" }
  | { kind: "confirm-kiosque-mono"; pinnedTenantId: Id<"tenants"> }
  | { kind: "confirm-kiosque-pick"; choices: Array<Id<"tenants">> }
  | { kind: "unavailable-kiosque-no-tenant" };

/**
 * Decide what to do when the user taps the « Passer en mode kiosque » /
 * « Passer en mode téléphone » row. Pure — the host component dispatches
 * the right side effect (Alert, sheet picker, or mutation + reload) based
 * on the verdict.
 *
 * Mirrors the `(device-setup)` resolution (PRD 20 §1a step 3) but for the
 * « rebascule plus tard » path (PRD 20 §12 + §10).
 */
export function decideRebasculeMode(
  inputs: RebasculeModeInputs,
): RebasculeModeDecision {
  const target: DeviceMode =
    inputs.currentMode === "kiosque" ? "telephone" : "kiosque";

  if (target === inputs.currentMode) {
    // Defensive — the type guarantees `target !== currentMode`, but a future
    // expansion of `DeviceMode` would catch the regression here.
    return { kind: "noop" };
  }

  if (target === "telephone") {
    return { kind: "confirm-telephone" };
  }

  // target === "kiosque"
  if (inputs.attachedTenantIds.length === 0) {
    return { kind: "unavailable-kiosque-no-tenant" };
  }
  if (inputs.attachedTenantIds.length === 1) {
    return {
      kind: "confirm-kiosque-mono",
      pinnedTenantId: inputs.attachedTenantIds[0],
    };
  }
  return {
    kind: "confirm-kiosque-pick",
    choices: inputs.attachedTenantIds,
  };
}

// ---------------------------------------------------------------------------
// Stripe + Uber status badges
// ---------------------------------------------------------------------------

/**
 * Badge variants the « Compte rattaché » section surfaces next to each
 * external integration. Same three-state semantics as the runtime banner
 * (#411) — the gérant should see at a glance whether Stripe / Uber Direct
 * are healthy without leaving the app.
 *
 *  - `ok` — green, the integration is fully wired (Stripe `ready`, Uber
 *    customer ID present).
 *  - `warning` — orange, the integration is being set up (Stripe `pending`,
 *    KYC in flight).
 *  - `error` — red, the integration is broken (Stripe `disabled` /
 *    `restricted`, Uber not configured AND livraison seul mode actif).
 *  - `idle` — neutral grey, the integration isn't configured yet but isn't
 *    blocking either (no `acceptedModes` set, etc.).
 */
export type IntegrationBadge = "ok" | "warning" | "error" | "idle";

/** Inputs for the Stripe badge decision — mirrors `getTenantHealth`. */
export type StripeBadgeInputs = {
  stripeStatus: "pending" | "ready" | "disabled" | null;
};

/** Inputs for the Uber Direct badge decision — mirrors `getTenantHealth`. */
export type UberBadgeInputs = {
  uberDirectConfigured: boolean;
  acceptedModes: { delivery: boolean; clickAndCollect: boolean } | null;
};

/**
 * Decide the Stripe badge variant. Pure — same inputs ⇒ same output. The
 * three-state semantics mirror the runtime gate (#411) so the Settings
 * surface and the home banner agree on what « ok / warning / error » mean.
 *
 *  - `ready` → ok (Stripe Connect operational, payments flow through).
 *  - `pending` → warning (KYC en cours — payments queued until verified).
 *  - `disabled` → error (Stripe restricted — manual fix in KB Admin needed).
 *  - `null` → idle (no Stripe account linked yet — pre-onboarding state).
 */
export function decideStripeBadge(inputs: StripeBadgeInputs): IntegrationBadge {
  switch (inputs.stripeStatus) {
    case "ready":
      return "ok";
    case "pending":
      return "warning";
    case "disabled":
      return "error";
    case null:
      return "idle";
  }
}

/**
 * Decide the Uber Direct badge variant. Pure — same inputs ⇒ same output.
 *
 *  - `uberDirectConfigured = true` → ok (Uber customer ID present, courier
 *    pipeline operational).
 *  - `false` but only `clickAndCollect` accepted → idle (livraison non
 *    activée, Uber non requis — pas un signal d'alerte).
 *  - `false` AND `delivery` accepted → error (livraison ON sans Uber = mode
 *    cassé, mirror du gate critique #411).
 *  - `false` AND no `acceptedModes` resolved → idle (state pré-onboarding).
 */
export function decideUberBadge(inputs: UberBadgeInputs): IntegrationBadge {
  if (inputs.uberDirectConfigured) return "ok";
  if (inputs.acceptedModes === null) return "idle";
  if (inputs.acceptedModes.delivery) return "error";
  return "idle";
}
