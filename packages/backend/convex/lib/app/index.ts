/**
 * Public API of the `app` backend module (#394 KB Orders, PRD 20 §13 + ADR 0017).
 *
 * The « couche native » of the force-update boot gate the KB Orders native app
 * runs at root layout. KB ops bumps `minSupportedBuildVersion` after a native
 * CVE, every too-old binary surfaces the red blocking screen at next launch.
 *
 *  - `minBuildVersion()` — PUBLIC read (no auth — the gate runs before login).
 *  - `setMinBuildVersion({ value })` — `kbAdminMutation`: root-only flip.
 *
 * Convex registers functions by their module path, so callers invoke them as
 * `api.lib.app.app.*`; this index file states the module contract in one place
 * (BMAD convention).
 */
export {} from "./app";
