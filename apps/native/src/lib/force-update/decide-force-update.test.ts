import { describe, expect, it } from "vitest";
import { decideForceUpdate } from "./decide-force-update";

/**
 * #394 — `decideForceUpdate` decision logic, pinned as a pure function (PRD 20
 * §13 + ADR 0017). The boot gate in `apps/native/src/app/_layout.tsx` is a thin
 * adapter that resolves four inputs and delegates the branching to this
 * function. Same split as `decideRootEntry` / `decideTenantGate` in
 * `apps/admin` — keep React, `Updates`, `Application` and Convex out of the
 * test, get a fast deterministic suite.
 *
 * Three force-update scenarios pinned (the « 1 à 3 tests E2E » the issue asks
 * for, expressed as scenario-level decisions):
 *
 *  (a) « bundle critical bumped → reload auto » — when an OTA update is
 *      available AND the incoming bundle's `criticalIndex` is greater than the
 *      running one, the decision is `download-and-reload`. The gate fetches +
 *      reloads, no user passage allowed.
 *
 *  (b) « min native version > current → écran bloquant store » — when the
 *      device's `nativeBuildVersion` is below the Convex-served
 *      `minBuildVersion`, the decision is `block-native-update`. The native
 *      layer always wins over the OTA layer (re-installing the binary will
 *      ship a new bundle anyway).
 *
 *  (c) « tout aligné → app démarre normalement » — when no OTA update is
 *      available (or the incoming one is not critical) AND the native build
 *      meets `minBuildVersion`, the decision is `allow` and the children mount.
 *
 * Plus a handful of edge cases the boot gate has to handle gracefully — `__DEV__`
 * (Updates.manifest is undefined), Updates disabled, manifest missing the
 * `criticalIndex`, equal indices, etc.
 */

describe("#394 decideForceUpdate — scenario (c) « tout aligné → app démarre »", () => {
  it("no update + native build >= min → allow", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 3,
        nativeBuildVersion: 42,
        minBuildVersion: 42,
        updateCheck: { isAvailable: false },
      }),
    ).toEqual({ kind: "allow" });
  });

  it("native build STRICTLY above min → allow (still safe)", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 1,
        nativeBuildVersion: 100,
        minBuildVersion: 42,
        updateCheck: { isAvailable: false },
      }),
    ).toEqual({ kind: "allow" });
  });

  it("OTA available but NOT critical (incoming index <= running) → allow (regular non-blocking update path)", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 5,
        nativeBuildVersion: 42,
        minBuildVersion: 42,
        updateCheck: { isAvailable: true, incomingCriticalIndex: 5 },
      }),
    ).toEqual({ kind: "allow" });
  });
});

describe("#394 decideForceUpdate — scenario (a) « bundle critical bumped → reload auto »", () => {
  it("OTA available + incoming criticalIndex > running → download-and-reload", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 3,
        nativeBuildVersion: 42,
        minBuildVersion: 42,
        updateCheck: { isAvailable: true, incomingCriticalIndex: 4 },
      }),
    ).toEqual({ kind: "download-and-reload" });
  });

  it("running has no criticalIndex (first install, undefined) + incoming has one → download-and-reload", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: undefined,
        nativeBuildVersion: 42,
        minBuildVersion: 42,
        updateCheck: { isAvailable: true, incomingCriticalIndex: 1 },
      }),
    ).toEqual({ kind: "download-and-reload" });
  });

  it("incoming missing criticalIndex (extra not set in new bundle) → allow (not a critical OTA)", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 3,
        nativeBuildVersion: 42,
        minBuildVersion: 42,
        updateCheck: { isAvailable: true, incomingCriticalIndex: undefined },
      }),
    ).toEqual({ kind: "allow" });
  });
});

describe("#394 decideForceUpdate — scenario (b) « min native > current → écran bloquant store »", () => {
  it("native build STRICTLY below min → block-native-update", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 3,
        nativeBuildVersion: 41,
        minBuildVersion: 42,
        updateCheck: { isAvailable: false },
      }),
    ).toEqual({ kind: "block-native-update" });
  });

  it("native layer WINS over OTA layer (incoming critical AND native too old → block, NOT reload)", () => {
    // Re-installing the binary will ship a new bundle anyway; pushing an OTA
    // onto an obsolete binary risks an incompatible JS↔native pairing. Native
    // always takes precedence (ADR 0017 « la couche native bloque toutes les
    // anciennes builds »).
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 3,
        nativeBuildVersion: 40,
        minBuildVersion: 50,
        updateCheck: { isAvailable: true, incomingCriticalIndex: 99 },
      }),
    ).toEqual({ kind: "block-native-update" });
  });
});

describe("#394 decideForceUpdate — environment guards", () => {
  it("DEV → allow (Updates.manifest is undefined in dev, ADR 0017 guard `__DEV__`)", () => {
    // In dev the OTA channel doesn't exist; we must NEVER block. Native build
    // check is also skipped — there's no nativeBuildVersion comparison that
    // makes sense for `expo start`.
    expect(
      decideForceUpdate({
        env: { isDev: true, updatesEnabled: false },
        // These could be anything in dev; the result must still be `allow`.
        runningCriticalIndex: 1,
        nativeBuildVersion: 1,
        minBuildVersion: 9999,
        updateCheck: { isAvailable: true, incomingCriticalIndex: 99 },
      }),
    ).toEqual({ kind: "allow" });
  });

  it("Updates disabled in prod (e.g. EAS Update misconfigured) → still enforces native layer", () => {
    // The OTA pathway is dead but the native check is independent — a CVE on
    // the binary must still surface the blocking screen.
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: false },
        runningCriticalIndex: 1,
        nativeBuildVersion: 10,
        minBuildVersion: 50,
        updateCheck: { isAvailable: false },
      }),
    ).toEqual({ kind: "block-native-update" });
  });

  it("Updates disabled in prod + native OK → allow (degraded but functional, no blocking)", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: false },
        runningCriticalIndex: 1,
        nativeBuildVersion: 42,
        minBuildVersion: 42,
        updateCheck: { isAvailable: false },
      }),
    ).toEqual({ kind: "allow" });
  });

  it("native build unknown (undefined — expo-application returned null) → allow (don't block on missing telemetry)", () => {
    // Better to let the user in than wrongly lock them out because the platform
    // didn't surface the build number. Native CVE response is rare enough that
    // a soft fallback is acceptable — Sentry would surface this.
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 1,
        nativeBuildVersion: undefined,
        minBuildVersion: 50,
        updateCheck: { isAvailable: false },
      }),
    ).toEqual({ kind: "allow" });
  });

  it("minBuildVersion unknown (undefined — Convex query still loading) → wait", () => {
    // The boot gate must keep the splash up while the public query resolves;
    // a flash to `allow` would let the user past, a flash to `block` would be
    // wrong if the value isn't loaded yet.
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 1,
        nativeBuildVersion: 42,
        minBuildVersion: undefined,
        updateCheck: { isAvailable: false },
      }),
    ).toEqual({ kind: "wait" });
  });

  it("updateCheck still pending (undefined — checkForUpdateAsync not resolved yet) → wait", () => {
    expect(
      decideForceUpdate({
        env: { isDev: false, updatesEnabled: true },
        runningCriticalIndex: 1,
        nativeBuildVersion: 42,
        minBuildVersion: 42,
        updateCheck: undefined,
      }),
    ).toEqual({ kind: "wait" });
  });
});
