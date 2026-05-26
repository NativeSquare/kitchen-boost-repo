/**
 * 2.7-D — the PURE Do-Not-Track window (PRD 80 §6 / notifications CONTEXT "DNT").
 * NO Convex ctx — unit-testable in isolation.
 *
 * Marketing campaigns must not push during the quiet hours 22h-8h Europe/Paris
 * (configurable by KB root — the start/end hour are parameters, defaulting to the
 * PRD 22 → 8). Transactional sends NEVER call this (base contractuelle). A campaign
 * launched inside the window is QUEUED and sent at the window end (08:00 Paris) the
 * same/next morning (PRD 80 §6 "queue automatique, envoi à 8h le lendemain matin").
 *
 * Timezone is resolved through `Intl.DateTimeFormat('Europe/Paris')` so the rule
 * is correct in both CET (UTC+1, winter) and CEST (UTC+2, summer) without hardcoding
 * an offset — the DST transition is handled by the runtime's tz database.
 */

/** Default DNT bounds (PRD 80 §6) — KB root may override start/end per call. */
export const DEFAULT_DNT_START_HOUR = 22;
export const DEFAULT_DNT_END_HOUR = 8;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const PARIS_HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  hour12: false,
});

const PARIS_HM_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** The Paris-local hour (0..23) an absolute instant falls in (DST-aware). */
export function parisHour(at: number): number {
  // "24" is emitted for midnight by some runtimes; normalise to 0.
  const h = Number.parseInt(PARIS_HOUR_FMT.format(new Date(at)), 10);
  return h === 24 ? 0 : h;
}

/** The Paris-local hour + minute of an instant (DST-aware). */
function parisHourMinute(at: number): { hour: number; minute: number } {
  const parts = PARIS_HM_FMT.format(new Date(at)).split(":");
  const hour = Number.parseInt(parts[0], 10);
  return {
    hour: hour === 24 ? 0 : hour,
    minute: Number.parseInt(parts[1], 10),
  };
}

/**
 * Whether `at` is inside the (wrap-around) DNT window. With the default 22 → 8 the
 * window spans midnight: an instant is in DNT iff its Paris hour is ≥ 22 OR < 8.
 * Generalised for a configurable `[start, end)` that may or may not wrap.
 */
export function inDoNotTrackWindow(
  at: number,
  startHour: number = DEFAULT_DNT_START_HOUR,
  endHour: number = DEFAULT_DNT_END_HOUR,
): boolean {
  const h = parisHour(at);
  if (startHour === endHour) return false; // empty window
  if (startHour < endHour) return h >= startHour && h < endHour; // same-day window
  return h >= startHour || h < endHour; // wraps midnight (the PRD case)
}

/**
 * The earliest instant a marketing send may go out: `at` itself when it is already
 * outside DNT, else the next `endHour`:00 Paris (the window end). Steps forward in
 * hour ticks until the Paris hour reaches `endHour`, then snaps to the top of that
 * hour — robust to the CET↔CEST shift (we never assume a fixed UTC offset).
 */
export function nextSendableTime(
  at: number,
  startHour: number = DEFAULT_DNT_START_HOUR,
  endHour: number = DEFAULT_DNT_END_HOUR,
): number {
  if (!inDoNotTrackWindow(at, startHour, endHour)) return at;

  // Advance hour by hour until we are in the target end-hour, then snap to :00.
  let cursor = at;
  // Guard against pathological loops (max ~26 ticks to cross a night).
  for (let i = 0; i < 48; i += 1) {
    const { hour } = parisHourMinute(cursor);
    if (hour === endHour) {
      // Snap back to the top of this Paris hour (minute = 0).
      const { minute } = parisHourMinute(cursor);
      return cursor - minute * MINUTE_MS;
    }
    cursor += HOUR_MS;
  }
  return cursor;
}
