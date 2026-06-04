/**
 * Public API of the `settings` native module (#418 KB Orders, PRD 20 §10).
 *
 * #418 is principally an INTEGRATION story (cf. issue body): the Settings
 * screen aggregates sections that are ALREADY built by upstream stories
 * (#393, #394, #395, #396, #398, #399, #400, #411, #412). This module
 * exposes:
 *
 *  - `SettingsScreen` — the React screen the `(tabs)/account.tsx` route
 *    mounts. Profile + change password + notifs (DNT/sons/vibration) +
 *    compte rattaché + imprimante entry + mode kiosque toggle + logout +
 *    version + support. Reuses `<TenantSwitcher />` (header chip) and
 *    `PrinterSettingsScreen` (printer route) rather than re-implementing.
 *
 *  - `useNotifPreferences` — the local SecureStore-backed accessor for
 *    DNT start/end + sounds + vibration (PRD 20 §3 + §10). V1 leg is local
 *    only — the Convex twin is a follow-up open question (cf. hook
 *    docstring). The runtime push consumer reads the same SecureStore
 *    keys to know whether to surface a sound / vibration.
 *
 *  - `decideSettingsVisibility` / `decideRebasculeMode` /
 *    `decideStripeBadge` / `decideUberBadge` — the PURE decision
 *    functions (no React, no Expo, no Convex). Pinned by the vitest
 *    suite next door. Same split convention as `decideForceUpdate`
 *    (#394), `decideTenantSwitcher` (#399), `decideClosureControl`
 *    (#407), `decidePrinterConfigForm` (#412).
 *
 *  - `isValidHHMM` — pure HH:MM 24h-format guard (used by the DNT input
 *    AND a future Convex mirror). Re-exported from the dedicated pure
 *    module so the vitest suite can import it without dragging in
 *    `expo-secure-store` → `react-native`.
 *
 * NO backend slice: PRD 20 §10 says « `userPreferences` ou équivalent ».
 * V1 ships the LOCAL leg (per-device makes sense — the OS notif chain
 * is device-local, multi-device sync of prefs is a V2 concern, cf. PRD
 * 20 V2 « Multi-device libre pour 1 owner »). The Convex twin can be
 * added without changing the hook's surface — that's the followup gap
 * the PRD ambiguity intentionally leaves open.
 */
export { SettingsScreen } from "./settings-screen";
export {
  useNotifPreferences,
  type NotifPreferences,
} from "./use-notif-preferences";
export {
  decideRebasculeMode,
  decideSettingsVisibility,
  decideStripeBadge,
  decideUberBadge,
  type DeviceMode,
  type IntegrationBadge,
  type RebasculeModeDecision,
  type RebasculeModeInputs,
  type SettingsSessionInputs,
  type SettingsVisibilityDecision,
  type SettingsVisibilityInputs,
  type StripeBadgeInputs,
  type UberBadgeInputs,
} from "./decide-settings";
export { isValidHHMM } from "./decide-notif-preferences";
