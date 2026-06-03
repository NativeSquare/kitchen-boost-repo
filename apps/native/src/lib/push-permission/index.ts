/**
 * Public API of the `push-permission` native module (#395 KB Orders, PRD 20 §3
 * + §13). The `(app)` layout mounts `PushPermissionBanner` at the top of the
 * authenticated route group so the red sticky banner overlays every screen
 * whenever the OS-level push permission is `denied`.
 *
 *  - `PushPermissionBanner` — the React component. Resolves the OS permission
 *    status via `expo-notifications` at mount + on every foreground return via
 *    `AppState`, delegates the visibility verdict to `decidePushPermissionBanner`,
 *    renders a red sticky banner with a "Ouvrir réglages" CTA that deeplinks
 *    to the system settings (`Linking.openSettings()`).
 *
 *  - `decidePushPermissionBanner` — the PURE decision function (no React, no
 *    Expo). Pinned by the vitest suite next door.
 */
export { PushPermissionBanner } from "./push-permission-banner";
export {
  decidePushPermissionBanner,
  type PushPermissionBannerDecision,
  type PushPermissionInputs,
  type PushPermissionStatus,
} from "./decide-push-permission-banner";
