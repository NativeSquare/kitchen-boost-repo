/**
 * F-COMMANDES-LIVE-TABLE (#227) — `formatOrderDate`, the timestamp formatter
 * used by the orders table.
 *
 * `orders.createdAt` is stored as a UTC epoch in MILLISECONDS (Convex
 * convention — cf. `packages/backend/convex/table/orders.ts`). The gérant
 * reads dates in the French locale; this helper renders a compact
 * « DD/MM/YYYY HH:mm » shape so the four-column table stays glanceable on a
 * 1280px laptop without horizontal scroll.
 *
 * Why explicit UTC components (not `toLocaleString("fr-FR")` / `Intl
 * .DateTimeFormat`):
 *   - Determinism: tests stay green on any CI timezone (the GitHub runners
 *     default to UTC; a gérant's machine runs Europe/Paris). The helper
 *     formats UTC components directly, no implicit timezone re-mapping.
 *   - Single source of truth for the « what shape do we render dates in
 *     the admin » contract — a future surface (CSV export, order detail
 *     modal) reuses this same string so a date never reads two different
 *     ways across the admin.
 *
 * Pure helper — no React, no DOM, no Intl. Pinned by
 * `format-order-date.test.ts`.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Format a millisecond epoch as `DD/MM/YYYY HH:mm` using UTC components.
 *
 * Throws on non-finite input — the backend store always writes
 * `Date.now()` (a finite ms epoch); a NaN here is a contract violation,
 * not a user-facing case to format. Loud failure prevents silent
 * « NaN/NaN/NaN NaN:NaN » rendering in the table.
 */
export function formatOrderDate(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    throw new Error(
      `formatOrderDate: expected a finite epoch in ms, got ${epochMs}`,
    );
  }
  const d = new Date(epochMs);
  const dd = pad2(d.getUTCDate());
  const mm = pad2(d.getUTCMonth() + 1);
  const yyyy = d.getUTCFullYear();
  const hh = pad2(d.getUTCHours());
  const min = pad2(d.getUTCMinutes());
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}
