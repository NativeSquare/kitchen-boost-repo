/**
 * F-MONITORING — `formatPendingSince` (issue #184, parent EPIC #147).
 *
 * Pure helper that formats an instant `pendingSinceMs` (the moment a
 * milestone last entered `pending_kyc` — see `pendingSince()` in
 * `packages/backend/convex/lib/admin/monitoring.ts`) relative to a `now`
 * reference into the human-readable copy promised by the issue body:
 *
 *   "depuis 4 heures", "depuis 2 jours", ...
 *
 * Uses `date-fns/formatDistance` with the French locale + `addSuffix: false`,
 * prefixed manually with the « depuis » verb so the output stays consistent
 * across units (date-fns' `addSuffix` would yield "il y a 4 heures" which
 * isn't the copy specified by the issue body / the AC).
 *
 * Pure (no I/O, no React) so vitest can pin every branch in the `node` env.
 */
import { formatDistance } from "date-fns";
import { fr } from "date-fns/locale";

/**
 * Render `pendingSinceMs` as « depuis &lt;duration&gt; » relative to `now`,
 * using date-fns' French locale. `now` is injected so the test suite can pin
 * the output without freezing the clock.
 */
export function formatPendingSince(
  pendingSinceMs: number,
  now: number,
): string {
  const distance = formatDistance(pendingSinceMs, now, { locale: fr });
  return `depuis ${distance}`;
}
