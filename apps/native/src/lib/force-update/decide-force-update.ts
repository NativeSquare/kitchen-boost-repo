/**
 * #394 — pure decision function for the boot force-update gate (PRD 20 §13 +
 * [ADR 0017](../../../../../docs/adr/0017-force-update-expo-pattern-deux-couches.md)).
 *
 * The native root layout (`apps/native/src/app/_layout.tsx`) resolves four
 * inputs at boot and delegates the branching to this function — same split as
 * `decideRootEntry` / `decideTenantGate` in `apps/admin`. Keeping React,
 * `expo-updates`, `expo-application` and Convex out of the function means the
 * three issue-acceptance scenarios are pinned by a fast deterministic vitest
 * suite (no jsdom, no Convex harness, no native mocks).
 *
 *  Two layers, in this priority order (cf. ADR 0017):
 *
 *  1. **DEV / safety guards FIRST** — never block in `__DEV__` (Updates.manifest
 *     is undefined, the OTA channel does not exist) and never block when an
 *     input is unknown (better a soft fallback than a wrongly locked-out user).
 *  2. **Native layer beats OTA** — if `nativeBuildVersion < minBuildVersion`,
 *     return `block-native-update` even if a critical OTA is pending: reinstalling
 *     the binary will ship a new bundle anyway, and pushing an OTA onto an
 *     obsolete binary risks an incompatible JS↔native pairing.
 *  3. **OTA layer** — if an update is available AND the incoming `criticalIndex`
 *     is strictly greater than the running one, return `download-and-reload`.
 *     The boot gate fetches + reloads, the user never sees the underlying app.
 */

/** Compile-time guards / runtime feature flags the boot gate resolves. */
export type ForceUpdateEnv = {
  /** `__DEV__` — true in `expo start`, NEVER block in dev. */
  isDev: boolean;
  /** `Updates.isEnabled` — false when EAS Update is misconfigured / disabled. */
  updatesEnabled: boolean;
};

/** Shape of `Updates.checkForUpdateAsync()`'s result we care about. */
export type UpdateCheck =
  | { isAvailable: false }
  | { isAvailable: true; incomingCriticalIndex: number | undefined };

/** Inputs the decision needs to reach a verdict. */
export type ForceUpdateInputs = {
  env: ForceUpdateEnv;
  /** From `Constants.expoConfig?.extra?.criticalIndex` (the running bundle). */
  runningCriticalIndex: number | undefined;
  /** From `Application.nativeBuildVersion` (a positive integer when known). */
  nativeBuildVersion: number | undefined;
  /** From the Convex public query `app.minBuildVersion()`. */
  minBuildVersion: number | undefined;
  /** `undefined` while `Updates.checkForUpdateAsync()` is still resolving. */
  updateCheck: UpdateCheck | undefined;
};

/** The four mutually-exclusive verdicts the boot gate acts on. */
export type ForceUpdateDecision =
  /** Render the children — the app boots normally. */
  | { kind: "allow" }
  /** Keep the splash up; one of the async inputs has not resolved yet. */
  | { kind: "wait" }
  /** Run `fetchUpdateAsync()` + `reloadAsync()` — bundle critical bumped. */
  | { kind: "download-and-reload" }
  /** Show the red blocking screen with the App Store / Play Store link. */
  | { kind: "block-native-update" };

/**
 * Decide what the boot gate should do this frame. Pure: same inputs ⇒ same
 * output, no side effects, no `Date.now()`. The boot gate is a thin adapter
 * (`useEffect` to run `Updates.checkForUpdateAsync()`, `useQuery` to fetch
 * `app.minBuildVersion()`, `useState` for the resolved values) that calls this
 * function on every render and reacts to the verdict.
 */
export function decideForceUpdate(
  inputs: ForceUpdateInputs,
): ForceUpdateDecision {
  // 1. DEV — never block. `Updates.manifest` is `undefined`, the OTA channel
  //    doesn't exist; `__DEV__` is the canonical guard (ADR 0017 « guard
  //    `__DEV__` obligatoire dans le gate »).
  if (inputs.env.isDev) {
    return { kind: "allow" };
  }

  // 2. Resolve the native layer first — it beats OTA (cf. docstring).
  //    Unknown `nativeBuildVersion` (the platform didn't surface it) → don't
  //    block on missing telemetry. Unknown `minBuildVersion` (the public Convex
  //    query is still loading) → wait for it before deciding either way (a
  //    flash to `allow` could leak past a CVE block).
  if (inputs.minBuildVersion === undefined) {
    return { kind: "wait" };
  }
  if (
    inputs.nativeBuildVersion !== undefined &&
    inputs.nativeBuildVersion < inputs.minBuildVersion
  ) {
    return { kind: "block-native-update" };
  }

  // 3. OTA layer. If Updates is disabled, the channel is dead — we cannot
  //    fetch/reload, so just allow (native check above already ran).
  if (!inputs.env.updatesEnabled) {
    return { kind: "allow" };
  }
  if (inputs.updateCheck === undefined) {
    return { kind: "wait" };
  }
  if (!inputs.updateCheck.isAvailable) {
    return { kind: "allow" };
  }

  // `incomingCriticalIndex === undefined` (a normal non-critical update) → allow.
  // The regular OTA flow can still apply the update on next manual reload —
  // but the gate doesn't BLOCK on it. Critical-bump check: strictly greater
  // than running, treating a missing running value as `0` (first install).
  const incoming = inputs.updateCheck.incomingCriticalIndex;
  if (incoming === undefined) {
    return { kind: "allow" };
  }
  const running = inputs.runningCriticalIndex ?? 0;
  if (incoming > running) {
    return { kind: "download-and-reload" };
  }
  return { kind: "allow" };
}
