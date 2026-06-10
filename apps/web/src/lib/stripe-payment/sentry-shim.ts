/**
 * PWA-S7 (#458) — Sentry shim.
 *
 * Acceptance criterion #458 « 3ᵉ échec → toast + Sentry log visible ». V1
 * has NO real Sentry SDK wired in `apps/web` (no `@sentry/nextjs` in
 * `apps/web/package.json` — see `grep -rn '@sentry' apps/`). To keep S7
 * shippable without inventing the wiring of an unrelated dep, this thin
 * shim is the SEAM the future Sentry adapter swaps into:
 *  - it preserves the call sites (`captureException(err, { tags })`);
 *  - it logs to `console.error` in the meantime — visible in DevTools, in
 *    `vercel logs`, and in the user's bug reports.
 *
 * When the real Sentry SDK lands (a separate slice, out of this issue's
 * scope), this file becomes a 2-line `export const captureException =
 * Sentry.captureException` wrapper — no call site change.
 */

/** Structured context for an exception report (tags/extras the future SDK keys on). */
export type SentryContext = {
  tags?: Record<string, string>;
  extras?: Record<string, unknown>;
};

/**
 * Send an exception to Sentry. Until the SDK lands, logs to `console.error`
 * with the structured context inline.
 */
export function captureException(
  error: unknown,
  context?: SentryContext,
): void {
  // Use `console.error` (not `console.log`) so the entry surfaces in Vercel
  // logs at ERROR severity, matching what the future Sentry SDK would do.
  console.error("[sentry-shim] captureException", error, context ?? {});
}
