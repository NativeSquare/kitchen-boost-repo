/**
 * F-COMMANDES-FILTERS (#238) — `orders-filtering`, the deep pure module that
 * applies the table's date + status filter to a list of orders.
 *
 * Two responsibilities, both pure, both tested in isolation under
 * `environment: "node"`:
 *
 *  1. Expose the **closed list of 8 statuses** the multi-select renders
 *     (`ALL_ORDER_STATUSES`). The list is derived from the backend's
 *     `orderStatus` validator (`packages/backend/convex/table/orders.ts`) so
 *     a future status addition / removal in the schema surfaces as a test
 *     failure here (the front then needs an explicit choice to surface the
 *     new status in the filter — issue body « Les 8 statuts du multi-select
 *     sont importes du validator `orderStatus` »).
 *
 *  2. Expose `filterOrders(orders, { dateRange, statuses }, opts?)` — the
 *     predicate the page re-runs on every Convex push so a live order that
 *     arrives while a filter is active is included / hidden according to
 *     the current filter (AC8 « le filtre s'applique au résultat live, pas
 *     a un snapshot »). Pure function — same input gives same output, no
 *     hidden time-zone surprises.
 *
 * Why this module lives in its own file:
 *  - All the time-zone subtleties (« aujourd'hui en Europe/Paris ») live in
 *    one place — the UI components never re-implement « what does today
 *    mean » and a Paris↔UTC bug surfaces here, not in three views at once.
 *  - The page can wrap `filterOrders` in a `useMemo` keyed on
 *    `(orders, filter)` to avoid re-filtering on every unrelated render.
 *
 * Tests pin the four AC: today/7d/30d in Europe/Paris, status OR, AND between
 * date+statuses, empty selections = passthrough on that dimension. The Paris
 * day computation uses `Intl.DateTimeFormat` with `timeZone: "Europe/Paris"`
 * (a built-in ICU API — no `date-fns-tz` dep added; issue body « utiliser un
 * helper timezone-aware si pas deja en place, sinon date-fns-tz » — Intl IS
 * already in place).
 *
 * Scope discipline (#238): this module is consumed ONLY by the sibling
 * `OrdersFilters` component and the route's `page.tsx`. Zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";

/**
 * The 4 date range presets the filter exposes (issue body « range date (boutons
 * 'aujourd'hui' / '7j' / '30j' / 'tout') »).
 *
 *  - `today` → orders whose `createdAt` falls within today's Paris day
 *    (Paris boundary, NOT UTC). Inclusive of the whole day [00:00, 23:59:59].
 *  - `7d`    → orders within the last 7 Paris days (today + 6 previous).
 *  - `30d`   → orders within the last 30 Paris days.
 *  - `tout`  → no date filter (passthrough on the date dimension).
 *
 * `tout` is the documented "all" value — French copy intentional to match
 * the gérant's mental model and the EPIC #141 wording verbatim.
 */
export type DateRangeKey = "today" | "7d" | "30d" | "tout";

/**
 * The 8 order statuses surfaced by the multi-select — KEPT IN SYNC with the
 * backend `orderStatus` validator. The order here matches the lifecycle order
 * documented in PRD 20 §5 + §6 / PRD 10 §10-§11 so the multi-select reads as
 * a natural left-to-right timeline (« en attente de paiement → nouvelle →
 * en préparation → prête → remise → livrée / collectée → refusée »).
 *
 * Why hard-derived from the documented set (and pinned by a test) rather
 * than imported from a `convex/values` runtime union: the `v.union(...)`
 * shape can't be safely introspected at compile time in the front (the
 * runtime values aren't a TS literal tuple), so we duplicate the literal
 * list AND assert in `orders-filtering.test.ts` that the front-side list
 * exactly matches the documented set. A future schema-side change surfaces
 * here before reaching production.
 */
export const ALL_ORDER_STATUSES = [
  "en attente de paiement",
  "nouvelle",
  "en préparation",
  "prête",
  "remise",
  "livrée",
  "collectée",
  "refusée",
] as const;

/** A status value — extracted from the const tuple so callers stay typed. */
export type OrderStatus = (typeof ALL_ORDER_STATUSES)[number];

/** The filter value, fully controlled on the page (EPIC #141 decision). */
export type OrdersFilter = {
  dateRange: DateRangeKey;
  /** Empty array = passthrough (no status filter). */
  statuses: OrderStatus[];
};

/**
 * Inject a fixed "now" so tests stay deterministic across CI clocks. In
 * production the page passes `Date.now()` (the default).
 */
export type FilterOpts = {
  now?: number;
};

/**
 * Apply the date + status filter to a list of orders. Pure: same input,
 * same output. The backend already returns DESC-sorted by createdAt — this
 * function preserves the input order (no `.sort()` defensively).
 *
 *  - If `dateRange === "tout"` AND `statuses.length === 0` → returns the
 *    input array as-is (passthrough — AC(d)).
 *  - The two dimensions combine conjunctively: an order is kept iff it
 *    matches the date predicate AND matches the status predicate (AC(c)).
 *  - Statuses combine disjunctively within their dimension (status ∈ set is
 *    enough — AC(b)).
 *  - "today" / "7d" / "30d" boundaries are computed in Europe/Paris (the
 *    gérant's local day), NOT UTC (AC(a)).
 */
export function filterOrders(
  orders: Doc<"orders">[],
  filter: OrdersFilter,
  opts: FilterOpts = {},
): Doc<"orders">[] {
  // Fast-path: no filter at all → passthrough. Avoids the Paris day
  // computation (and any allocation) when the UI hasn't selected anything.
  if (filter.dateRange === "tout" && filter.statuses.length === 0) {
    return orders;
  }

  const now = opts.now ?? Date.now();
  const bounds = computeDateBounds(filter.dateRange, now);
  const statusSet =
    filter.statuses.length === 0 ? null : new Set<string>(filter.statuses);

  return orders.filter((o) => {
    if (bounds !== null) {
      if (o.createdAt < bounds.minInclusive) return false;
      if (o.createdAt >= bounds.maxExclusive) return false;
    }
    if (statusSet !== null && !statusSet.has(o.status)) return false;
    return true;
  });
}

/**
 * Compute the half-open [minInclusive, maxExclusive) window for the date
 * filter, expressed as millisecond UTC epochs. Both bounds align to Paris-day
 * boundaries (00:00 Paris on the relevant day):
 *
 *  - "today" → [start of today's Paris day, start of tomorrow's Paris day).
 *  - "7d"    → [start of (today − 6 days) Paris day, start of tomorrow Paris day).
 *  - "30d"   → [start of (today − 29 days) Paris day, start of tomorrow Paris day).
 *  - "tout"  → null (no date filter).
 *
 * The upper bound is start-of-tomorrow (exclusive) — a future-dated order
 * (e.g. clock drift on the device, or test fixtures past `now`) is rejected
 * by the "today" preset, otherwise the « aujourd'hui » filter would
 * misleadingly include them. The lower bound is inclusive.
 *
 * Implementation: we ask `Intl.DateTimeFormat({timeZone: "Europe/Paris"})`
 * for the Paris wall-clock year/month/day of "now", then bisect a UTC epoch
 * until its Paris wall clock matches midnight on the target Paris day. This
 * handles DST transitions correctly (no hard-coded ±1/+2h).
 */
function computeDateBounds(
  dateRange: DateRangeKey,
  now: number,
): { minInclusive: number; maxExclusive: number } | null {
  if (dateRange === "tout") return null;
  const startOfTodayParis = startOfParisDay(now);
  // Start of tomorrow Paris = startOfParisDay(now + 24h) — re-snap so a DST
  // jump-back doesn't yield the same Paris day twice.
  const startOfTomorrowParis = startOfParisDay(
    startOfTodayParis + 25 * 60 * 60 * 1000,
  );
  const daysBack = dateRange === "today" ? 0 : dateRange === "7d" ? 6 : 29;
  // Subtract `daysBack` Paris days. We step back 24h × N AND re-snap to the
  // Paris-day start of the result (so a DST transition inside the window
  // doesn't shift the bound by an hour).
  const approx = startOfTodayParis - daysBack * 24 * 60 * 60 * 1000;
  const minInclusive = startOfParisDay(approx);
  return { minInclusive, maxExclusive: startOfTomorrowParis };
}

const PARIS_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * Return the UTC ms epoch matching 00:00:00 of the Paris day that contains
 * the given `epochMs`. Robust across DST: a small bisection until the
 * formatted Paris components show midnight on the target day.
 */
function startOfParisDay(epochMs: number): number {
  // First read the Paris year/month/day of `epochMs`.
  const parts = parisParts(epochMs);
  const targetYear = parts.year;
  const targetMonth = parts.month; // 1-12
  const targetDay = parts.day;

  // Initial guess: UTC midnight of (targetYear, targetMonth, targetDay) — off
  // by 1 or 2 hours depending on DST. We then correct in at most 3 iterations.
  let guess = Date.UTC(targetYear, targetMonth - 1, targetDay, 0, 0, 0);
  for (let i = 0; i < 5; i += 1) {
    const got = parisParts(guess);
    if (
      got.year === targetYear &&
      got.month === targetMonth &&
      got.day === targetDay &&
      got.hour === 0 &&
      got.minute === 0 &&
      got.second === 0
    ) {
      return guess;
    }
    // Adjust guess by the drift in Paris-wall seconds.
    const driftMs = ((got.hour * 60 + got.minute) * 60 + got.second) * 1000;
    if (
      got.year === targetYear &&
      got.month === targetMonth &&
      got.day === targetDay
    ) {
      // Same Paris day, wrong time of day — subtract the drift.
      guess -= driftMs;
    } else {
      // Different Paris day — step in 1h increments toward the target.
      // We compare the calendar tuple lexicographically.
      const before =
        got.year < targetYear ||
        (got.year === targetYear && got.month < targetMonth) ||
        (got.year === targetYear &&
          got.month === targetMonth &&
          got.day < targetDay);
      guess += (before ? 1 : -1) * 60 * 60 * 1000;
    }
  }
  return guess;
}

function parisParts(epochMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const map = new Map<string, string>();
  for (const p of PARIS_FMT.formatToParts(new Date(epochMs))) {
    map.set(p.type, p.value);
  }
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour") ?? "0") % 24, // Intl emits "24" for midnight
    minute: Number(map.get("minute") ?? "0"),
    second: Number(map.get("second") ?? "0"),
  };
}
