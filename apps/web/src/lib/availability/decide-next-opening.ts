/**
 * FEATURE A (#closed-resto UX) — pure availability core for the PWA Client.
 *
 * The PWA discovers « resto fermé » at LOAD (the opening hours are known the
 * moment the page renders), not only after the address-first quote chain returns
 * `hors_horaire`. So the closed-sheet UX is driven by these PURE functions over
 * the tenant's persisted service windows (read from the new public
 * `readServiceStatus` query) — never the backend `hors_horaire` verdict.
 *
 * Everything is INJECTED-clock pure (no `Date.now()` inside), so:
 *  - vitest pins every branch on fixed Europe/Paris instants (no flaky suite);
 *  - the client interval (Feature A.5 stale-tab) re-evaluates the SAME functions
 *    against the wall clock every ~30s without a server round-trip, and the
 *    Convex reactive query re-supplies the windows when an admin edits the hours.
 *
 * Timezone: Europe/Paris (FR-only V1), CET/CEST resolved per-instant via
 * `Intl.DateTimeFormat` — same approach as the backend `lib/menu/serviceHours`
 * (no extra dependency). Windows do NOT span midnight (V1 invariant).
 *
 * NB: `ServiceWindow` is re-declared LOCALLY (structurally identical to the
 * backend `table/serviceHours.ServiceWindow`) so the front never imports the
 * Convex module graph — same discipline as `lib/address-first` mirroring the
 * backend verdict shape.
 */

const PARIS_TZ = "Europe/Paris";
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;

/** JS `Date.getDay()` order, indexed by `Intl`'s English short weekday. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** FR day names indexed 0=dimanche … 6=samedi (for the réouverture label). */
const FR_DAY_NAMES = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

/**
 * One open window — structurally identical to the backend
 * `table/serviceHours.ServiceWindow`, re-declared here so the front does not
 * import the Convex module graph. `dayOfWeek`: 0 = Sunday … 6 = Saturday.
 * `startMinute` / `endMinute`: minutes from local midnight, `start < end`.
 */
export type ServiceWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

/** The local Europe/Paris wall-clock derived from a UTC instant. */
type ParisLocalParts = { dayOfWeek: number; minuteOfDay: number };

/**
 * Project a UTC timestamp (ms) onto the local Europe/Paris day-of-week +
 * minute-of-day. DST (CET/CEST) is resolved from the instant itself, so no
 * per-window tz field is needed.
 */
function parisLocalParts(nowMs: number): ParisLocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));

  let weekday = "";
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === "weekday") weekday = part.value;
    else if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
  }
  return {
    dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0,
    minuteOfDay: hour * 60 + minute,
  };
}

/**
 * Whether `nowMs` falls inside any open window, evaluated in Europe/Paris.
 * Start INCLUSIVE, end EXCLUSIVE. No windows ⇒ always closed. The front mirror
 * of the backend `isWithinServiceHours` (kept in sync by the shared boundary
 * convention — both are unit-pinned).
 */
export function clientIsOpenNow(
  windows: ServiceWindow[],
  nowMs: number,
): boolean {
  const { dayOfWeek, minuteOfDay } = parisLocalParts(nowMs);
  return windows.some(
    (w) =>
      w.dayOfWeek === dayOfWeek &&
      minuteOfDay >= w.startMinute &&
      minuteOfDay < w.endMinute,
  );
}

/** The next-opening decision: the absolute ms of the next window-start. */
export type NextOpening = { ms: number };

/**
 * The Europe/Paris UTC offset (in minutes) in effect at `instantMs`, e.g. +120
 * for CEST, +60 for CET. Derived by comparing the local Paris wall-clock to the
 * UTC wall-clock at the same instant.
 */
function parisOffsetMinutes(instantMs: number): number {
  const local = parisLocalParts(instantMs);
  const utc = new Date(instantMs);
  const utcDayOfWeek = utc.getUTCDay();
  const utcMinuteOfDay = utc.getUTCHours() * 60 + utc.getUTCMinutes();
  // Offset = local-of-week − utc-of-week, normalised to (−720, +720] so a day
  // wrap (local Mon 00:30 vs utc Sun 23:30) does not read as ±1439.
  let diff =
    local.dayOfWeek * MINUTES_PER_DAY +
    local.minuteOfDay -
    (utcDayOfWeek * MINUTES_PER_DAY + utcMinuteOfDay);
  if (diff > MINUTES_PER_WEEK / 2) diff -= MINUTES_PER_WEEK;
  if (diff < -MINUTES_PER_WEEK / 2) diff += MINUTES_PER_WEEK;
  return diff;
}

/**
 * Compute the NEXT window-start strictly after `nowMs`, in Europe/Paris.
 *
 * Algorithm (pure):
 *  1. Project `now` to its Paris minute-of-week (`dayOfWeek*1440 + minuteOfDay`).
 *  2. For every window, project its start to a minute-of-week; the forward
 *     distance is `(start − now + WEEK) mod WEEK`. A distance of 0 (start ==
 *     now exactly) is pushed a full week so the result is STRICTLY after now —
 *     but a currently-OPEN window does not produce a 0 distance anyway, since
 *     its start is in the past (distance ≈ WEEK only when start == now).
 *  3. The window with the SMALLEST positive forward distance wins.
 *  4. Convert that Paris-local target back to a UTC ms: add the forward minutes
 *     to `now`, then correct for any DST offset change between `now` and the
 *     target (a window-start that lands across a DST boundary).
 *
 * Returns `null` when there are NO windows at all (« Horaires non communiqués »).
 */
export function decideNextOpening(
  windows: ServiceWindow[],
  nowMs: number,
): NextOpening | null {
  if (windows.length === 0) return null;

  const now = parisLocalParts(nowMs);
  const nowMinuteOfWeek = now.dayOfWeek * MINUTES_PER_DAY + now.minuteOfDay;

  let bestForward = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    const startMinuteOfWeek = w.dayOfWeek * MINUTES_PER_DAY + w.startMinute;
    let forward =
      (((startMinuteOfWeek - nowMinuteOfWeek) % MINUTES_PER_WEEK) +
        MINUTES_PER_WEEK) %
      MINUTES_PER_WEEK;
    // Strictly after now: a start exactly == now wraps a full week.
    if (forward === 0) forward = MINUTES_PER_WEEK;
    if (forward < bestForward) bestForward = forward;
  }

  // Naive target assuming the offset at `now` holds at the target.
  const naiveTargetMs = nowMs + bestForward * 60_000;
  // Correct for a DST offset shift between now and the target instant: if the
  // offset changed, the naive ms lands at the wrong wall-clock; shift it back by
  // the delta so the resolved Paris wall-clock equals the intended window start.
  const offsetDelta =
    parisOffsetMinutes(naiveTargetMs) - parisOffsetMinutes(nowMs);
  const ms = naiveTargetMs - offsetDelta * 60_000;
  return { ms };
}

/** Zero-pad a minute to 2 digits (« 18h00 », « 11h30 »). */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The Europe/Paris calendar day as a sortable ordinal (`YYYYMMDD`). Used to tell
 * « aujourd'hui » / « demain » apart from a SAME-weekday opening a full week
 * away (e.g. only-Wednesday hours, now Wednesday evening → next Wednesday is 7
 * days out, NOT « aujourd'hui »). A weekday-delta alone cannot distinguish those.
 */
function parisDayOrdinal(instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instantMs));
  let y = "";
  let m = "";
  let d = "";
  for (const part of parts) {
    if (part.type === "year") y = part.value;
    else if (part.type === "month") m = part.value;
    else if (part.type === "day") d = part.value;
  }
  return Number(`${y}${m}${d}`);
}

/**
 * The FR réouverture copy:
 *  - today    → « Réouverture aujourd'hui à 18h00 »
 *  - tomorrow → « Réouverture demain à 11h30 »
 *  - else     → « Réouverture lundi à 11h30 »
 *  - null     → « Horaires non communiqués » (no time — no windows configured)
 *
 * `nowMs` is needed to decide aujourd'hui / demain relative to the local Paris
 * calendar day of the opening.
 */
export function formatNextOpeningLabel(
  decision: NextOpening | null,
  nowMs: number,
): string {
  if (decision === null) return "Horaires non communiqués";

  const open = parisLocalParts(decision.ms);
  const hour = Math.floor(open.minuteOfDay / 60);
  const minute = open.minuteOfDay % 60;
  const time = `${hour}h${pad2(minute)}`;

  // « aujourd'hui » / « demain » are decided on the actual CALENDAR-day gap
  // (Paris), not a weekday delta — so a same-weekday opening a full week away
  // (only-Wednesday hours, now Wednesday night) reads « mercredi », not
  // « aujourd'hui ». Tomorrow is the calendar day immediately after now's.
  const nowOrdinal = parisDayOrdinal(nowMs);
  const openOrdinal = parisDayOrdinal(decision.ms);
  const tomorrowOrdinal = parisDayOrdinal(nowMs + MINUTES_PER_DAY * 60_000);
  let when: string;
  if (openOrdinal === nowOrdinal) when = "aujourd'hui";
  else if (openOrdinal === tomorrowOrdinal) when = "demain";
  else when = FR_DAY_NAMES[open.dayOfWeek];

  return `Réouverture ${when} à ${time}`;
}
