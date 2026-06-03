/**
 * Public API of the `devices` backend module (#393 KB Orders, PRD 20 §1a /
 * §1b / §12).
 *
 * Self-scoped per-(user, device) preference seam the native app drives at
 * first login (kiosque/téléphone toggle, PRD 20 §1a step 3) and every later
 * re-launch (skip onboarding + hydrate switcher / pin). Three downstream
 * stories ALREADY depend on the contract pinned here:
 *
 *  - #399 (TB-2, « Switcher tenant en header ») — reads `pinnedTenantId` to
 *    decide whether to hide the switcher (kiosque) and `lastSelectedTenantId`
 *    to hydrate the phone-mode default.
 *  - #418 (TB-21, « Settings complets ») — wraps `setMyDeviceMode` as the
 *    Settings rebascule toggle.
 *  - #398 (TB-6, « Séquence onboarding post-login ») — calls
 *    `markOnboardingCompleted` at the end of the device checklist.
 *
 * ADR 0011 — the module uses `getCurrentActor` ONLY (no `getAuthUserId`). ADR
 * 0010 — every write goes through `lib/tenancy/devicesStore`; no raw `ctx.db`
 * in this module.
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.devices.devices.*`; this index file states the module contract in
 * one place (BMAD convention).
 */

// Re-export the table-level validator so consumers spell `deviceMode` once.
// The TYPE `DeviceMode` is canonical in `lib/tenancy` (Infer'd from this
// validator), so it is NOT re-exported here to avoid a duplicate symbol.
export { deviceMode } from "../../table/devices";
