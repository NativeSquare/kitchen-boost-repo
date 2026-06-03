import { ConvexError, v } from "convex/values";
import { query } from "../../_generated/server";
import {
  kbAdminMutation,
  readMinSupportedBuildVersion,
  setMinSupportedBuildVersion,
} from "../tenancy";

/**
 * #394 — `app` business module (PRD 20 §13 + [ADR 0017](../../../../../docs/adr/0017-force-update-expo-pattern-deux-couches.md)).
 *
 * The Convex side of the « couche native » of the boot force-update gate the
 * KB Orders native app runs at root layout. KB ops bumps
 * `minSupportedBuildVersion` after a native CVE, every device running an older
 * binary is sent to the red "Mise à jour requise" screen at the next launch
 * (App Store / Play Store link), the rest boots normally.
 *
 * Two endpoints — the bare minimum the boot gate needs:
 *
 *  - `minBuildVersion()` — **PUBLIC** read (no auth wrapper). The boot gate
 *    runs BEFORE login on a freshly opened app; if this required a session, we
 *    could not gate signed-out users. Returns the configured integer, or the
 *    safe default `1` when no row exists yet (every shipped binary boots).
 *
 *  - `setMinBuildVersion({ value })` — `kbAdminMutation`: only the global root
 *    role can flip the value. The wrapper enforces the gate AND auto-writes
 *    the audit row (root actions are sensitive, STACK.md §6.4). Validation:
 *    `value` must be an integer ≥ 1 (every shipped binary has
 *    `nativeBuildVersion >= 1` — a 0 would block everyone, a fractional value
 *    has no on-device meaning).
 *
 * ADR 0010 — `appConfig` is KB-ADMIN-GLOBAL (no `tenantId`), exempt from the
 * tenancy wrappers like `customers` / `prospects`. ADR 0011 — no
 * `getAuthUserId` is called from here; identity is resolved exclusively inside
 * the `kbAdminMutation` wrapper. The single sanctioned `ctx.db` site is the
 * `lib/tenancy/appConfigStore.ts` seam — this module never touches raw
 * `ctx.db` (`no-untenanted-query`).
 */

const invalid = (message: string) =>
  new ConvexError({ code: "INVALID_ARGUMENT", message });

/**
 * Public read of the minimum supported native build version. **No auth** — the
 * boot gate calls this on a freshly launched app where the user has not signed
 * in yet (ADR 0017 « la query Convex publique pré-auth »). Self-contained: no
 * user data is exposed, no tenant scoping required, the value is a single
 * integer KB ops bumps in response to security incidents.
 *
 * Returns `DEFAULT_MIN_SUPPORTED_BUILD_VERSION` (= 1) on a fresh deploy where
 * no row exists yet, so a brand-new tenant on a brand-new app never boots into
 * the blocking screen by accident.
 */
export const minBuildVersion = query({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => readMinSupportedBuildVersion(ctx),
});

/**
 * `setMinBuildVersion({ value })` — KB ops sets the threshold after a native
 * CVE / binary incident. `kbAdminMutation` enforces the root gate; the audit
 * row is written automatically by the wrapper.
 *
 * Validation enforced HERE (the wrapper validates the shape, this validates
 * the domain):
 *
 *  - `value` MUST be an integer (no fractional build numbers — iOS & Android
 *    use integers for `buildNumber` / `versionCode`).
 *  - `value` MUST be `>= 1` (every shipped binary has `nativeBuildVersion >= 1`;
 *    setting `0` would block every user including those running the latest
 *    binary — a footgun the wrapper cannot detect).
 */
export const setMinBuildVersion = kbAdminMutation({
  args: { value: v.number() },
  action: "app.setMinBuildVersion",
  handler: async (ctx, args): Promise<null> => {
    if (!Number.isInteger(args.value)) {
      throw invalid("value must be an integer");
    }
    if (args.value < 1) {
      throw invalid("value must be >= 1");
    }
    await setMinSupportedBuildVersion(ctx, args.value);
    return null;
  },
});
