import { describe, expect, it } from "vitest";
import { decidePushPermissionBanner } from "./decide-push-permission-banner";

/**
 * #395 — `decidePushPermissionBanner` pinned as a pure function (PRD 20 §3 +
 * §13 + edge cases §15). The `PushPermissionBanner` component in
 * `apps/native/src/app/(app)/_layout.tsx` is a thin adapter: it calls
 * `Notifications.getPermissionsAsync()` at mount + on every foreground return
 * via `AppState`, then delegates the visibility verdict to this function.
 *
 * Same split as `decideForceUpdate` (#394) and `decideRootEntry` /
 * `decideTenantGate` in `apps/admin` — keep React, `expo-notifications` and
 * `AppState` out of the test, get a fast deterministic vitest suite (Node env,
 * no jsdom, no native mocks).
 *
 * Three acceptance scenarios from the issue body pinned:
 *
 *  (a) « permission denied → banner visible » — the OS-level switch was flipped
 *      off (either via the Settings app post-install or the user tapped
 *      "Refuser" on the prompt). The verdict is `visible`. PRD 20 §3 « banner
 *      rouge persistant sur toutes les routes (app) ».
 *
 *  (b) « permission granted → pas de banner » — Notifications are allowed at
 *      OS level. The verdict is `hidden`. The wakeup channel is healthy.
 *
 *  (c) « permission undetermined → pas de banner » — the OS has not been
 *      prompted yet (fresh install, never asked). The verdict is `hidden`
 *      because asking is the job of the onboarding sequence TB-2 (#398, PRD 20
 *      §1a step 2), NOT this banner. Showing the banner here would scream
 *      "denied" at someone who has not even had the chance to grant.
 *
 *  (d) « permission status still loading → pas de banner » — first frame
 *      before `getPermissionsAsync()` resolves; the verdict is `hidden`. A
 *      flash of red banner on cold start would be a UX bug; the banner only
 *      surfaces once we KNOW the OS-level switch is off.
 */

describe("#395 decidePushPermissionBanner — acceptance scenario (a) denied → banner visible", () => {
  it("status=denied → visible", () => {
    expect(decidePushPermissionBanner({ status: "denied" })).toBe("visible");
  });
});

describe("#395 decidePushPermissionBanner — acceptance scenario (b) granted → no banner", () => {
  it("status=granted → hidden", () => {
    expect(decidePushPermissionBanner({ status: "granted" })).toBe("hidden");
  });
});

describe("#395 decidePushPermissionBanner — acceptance scenario (c) undetermined → no banner", () => {
  it("status=undetermined → hidden (onboarding #398 handles asking, not us)", () => {
    // PRD 20 §3 « Permission `undetermined` (jamais demandée) → pas de banner,
    // c'est le job du flow onboarding TB-2 de demander ». Banner here would
    // mis-signal denial to a user who has not been asked yet.
    expect(decidePushPermissionBanner({ status: "undetermined" })).toBe(
      "hidden",
    );
  });
});

describe("#395 decidePushPermissionBanner — pre-resolution guard", () => {
  it("status=undefined (Notifications.getPermissionsAsync still pending) → hidden", () => {
    // First render of `(app)` before the async resolves. A flash of red banner
    // on cold start would be a UX bug; the banner only surfaces once we KNOW
    // the OS-level switch is off.
    expect(decidePushPermissionBanner({ status: undefined })).toBe("hidden");
  });
});
