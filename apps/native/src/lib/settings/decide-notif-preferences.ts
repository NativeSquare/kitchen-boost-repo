/**
 * #418 — pure helpers for the Settings notification preferences (PRD 20 §3 +
 * §10). Kept SEPARATE from the React hook (`use-notif-preferences.ts`) so
 * the vitest suite can exercise the pure validator without dragging in the
 * `expo-secure-store` → `react-native` transitive dependency (the vitest
 * Node env can't parse Flow source files in `react-native/index.js`).
 *
 * Same split convention as `decide-star-printer` (#412) vs `print-order`
 * (#412), or `decide-tenant-switcher` (#399) vs `tenant-switcher.tsx`.
 */

/**
 * `isValidHHMM` — strict HH:MM 24h-format guard. Same convention as
 * `parseLocalDateInput` in `decide-closure-control` (#407) — refuse anything
 * looser so a typo doesn't silently land an off-by-N-hour quiet window.
 *
 * Exported so the screen can disable the « Enregistrer » button until the
 * input is valid, AND so the next #418-followup that introduces the Convex
 * mirror can re-use the same validation server-side.
 */
export function isValidHHMM(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  if (hours < 0 || hours > 23) return false;
  if (minutes < 0 || minutes > 59) return false;
  return true;
}
