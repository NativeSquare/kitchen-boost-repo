import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * #394 (KB Orders, PRD 20 §13 + [ADR 0017](../../../../docs/adr/0017-force-update-expo-pattern-deux-couches.md))
 * — `appConfig`.
 *
 * Singleton row holding the **GLOBAL** native-app guardrails KB ops can flip in
 * one mutation to react to a security incident, without rebuilding the binary
 * nor publishing a new EAS Update. V1 carries ONE value:
 *
 *  - `minSupportedBuildVersion` — the minimum `Application.nativeBuildVersion`
 *    the app considers safe. Compared at boot (PRD 20 §13 "couche native") by
 *    `apps/native/_layout.tsx` to `Application.nativeBuildVersion`; any device
 *    running an older build sees the red blocking "Mise à jour requise" screen
 *    with the App Store / Play Store link. Allows KB to neutralise every
 *    out-of-date binary at once after a native CVE. The complementary "couche
 *    OTA" lives in `app.config.ts` (`expo.extra.criticalIndex`) and is bumped
 *    in code — NOT in this table (a critical OTA = republish the bundle).
 *
 * ── KB-ADMIN-GLOBAL, NO `tenantId` SCOPING KEY — ISOLATION EXEMPTION (ADR 0010) ─
 * Like `customers` / `prospects` / `cgvVersions`, the row holds KB-wide ops state
 * (one binary fleet, not per-resto), owned by the `kb_admin` (root) role at the
 * mutation side. It is documented exempt from the tenancy wrappers — reads are
 * PUBLIC (the gate runs BEFORE auth on the native side, so a `kbAdminQuery` is
 * not an option; the data is non-sensitive: a build-version integer), writes go
 * through `kbAdminMutation`. The sanctioned `ctx.db` access seam is
 * `convex/lib/tenancy/appConfigStore.ts` (`SANCTIONED_CTX_DB_PATHS` allowlist);
 * the business module `convex/lib/app` never touches raw `ctx.db`.
 *
 * V1 has exactly ONE row (the singleton). The index `by_singleton` keys on the
 * literal string `"singleton"` so the store helpers can `.unique()`-look-up the
 * row in O(1). A missing row means « no constraint set yet » and resolves to the
 * safe default `1` — every shipped binary at version ≥ 1 boots normally.
 */

/** Stable literal used as the `by_singleton` key for the lone row. */
export const APP_CONFIG_SINGLETON_KEY = "singleton" as const;

export const appConfig = defineTable({
  /** Always the literal `"singleton"`. The `by_singleton` index keys on it. */
  key: v.literal(APP_CONFIG_SINGLETON_KEY),

  /**
   * Minimum native `Application.nativeBuildVersion` the app accepts (integer ≥ 1).
   * Bumped by KB ops via `kbAdminMutation` after a security incident; read by
   * the public `app.minBuildVersion()` query the native gate calls at boot.
   */
  minSupportedBuildVersion: v.number(),

  updatedAt: v.number(),
}).index("by_singleton", ["key"]);
