/**
 * #417 — pure decision functions for the KB Orders Historique screen (PRD 20
 * §8). Same split convention as `decide-order-card.ts` (#401),
 * `decide-refuse-flow.ts` (#403/#413), `decide-pause-control.ts` (#406): no
 * React, no Convex, no Expo here — just the truth table pinned by the
 * node-env vitest next door (`decide-history.test.ts`).
 *
 * The React screen (`apps/native/src/app/(app)/orders/history.tsx`) is a
 * thin adapter that subscribes to the EXISTING tenant-scoped
 * `api.lib.orders.orders.listOrders` (chantier 2.3-A, OPERATIONAL_ALLOW =
 * `kb_manager` + `staff`) and feeds the payload through the three
 * commutative predicates surfaced here:
 *
 *   listOrders → applyHistoryTabFilter → filterOrdersByDateRange → searchOrdersById
 *
 * The composition order is irrelevant (pure set intersection — pinned in
 * the test suite). The page re-runs the pipe on every Convex push so a fresh
 * terminal that lands while the gérant has a tab/search/date active is
 * included / hidden per the current selection without a setState round-trip
 * (same discipline as the admin sister page F-COMMANDES-FILTERS #238 +
 * F-COMMANDES-TABS #415).
 *
 * Three concerns are decided here:
 *
 *  1. **`ORDER_HISTORY_TABS` + `STATUSES_FOR_HISTORY_TAB` +
 *     `applyHistoryTabFilter`** — the 4 tabs of PRD 20 §8 (« Toutes |
 *     Livrées/Collectées | Refusées | Manquées »). Each tab maps to a
 *     CLOSED subset of TERMINAL statuses; the « Toutes » tab is the
 *     UNION of the terminal set, NOT a passthrough on every status (a
 *     `nouvelle` order is not part of the history).
 *
 *  2. **`searchOrdersById`** — case-insensitive substring match over the
 *     order id. **ID-ONLY by MOAT (ADR 0010)** — customer names / phones
 *     are NEVER queryable from a `kb_manager` surface (exposing a name
 *     substring index would let a resto rebuild a customer rolodex one
 *     keystroke at a time). The issue body wrote « par ID cmd ou nom
 *     client » — MOAT forbids the second half, so we keep ID only.
 *
 *  3. **`DATE_RANGE_PRESETS` + `filterOrdersByDateRange`** — the date
 *     period filter (today / 7d / 30d / tout). Local-midnight boundaries
 *     (the gérant thinks in his wall clock, not UTC); inclusive lower /
 *     exclusive upper, half-open `[from, until)` — same convention as the
 *     admin `filterOrders` (#238) and the native `computeQuickClosureWindow`
 *     (#407). DST jumps are handled by the `Date` constructor itself.
 *
 *  4. **`decideAutoExpiredDetailNote`** — the « message neutre si
 *     auto_expired » row PRD 20 §8 mandates on the detail screen reached
 *     from the history. Distinct from the human refusal motif (which the
 *     existing event log already carries) — the auto_expired note is a
 *     UI-level reassurance for the gérant (« le système a remboursé, tu
 *     n'as rien à faire »).
 *
 * The history shows TERMINAL orders only. The `HISTORY_TERMINAL_STATUSES`
 * frozen set + the `isHistoryTerminal` predicate make that invariant
 * explicit, applied INSIDE `applyHistoryTabFilter` so a `nouvelle` row
 * that somehow leaked into the input payload (race, future schema add)
 * never bleeds into the « Toutes » tab. The home queue (`tenantOrders`)
 * symmetrically excludes terminals — the two surfaces are disjoint by
 * construction.
 */

import type { Doc } from "@packages/backend/convex/_generated/dataModel";
import type { OrderStatus } from "@packages/backend/convex/lib/orders";

// ---------------------------------------------------------------------------
// History tabs (PRD 20 §8)
// ---------------------------------------------------------------------------

/** The 4 tab keys (PRD 20 §8 left-to-right reading order). */
export type OrderHistoryTabKey =
  | "all"
  | "delivered_collected"
  | "refused"
  | "missed";

/** One tab as rendered in the screen header. */
export type OrderHistoryTab = {
  key: OrderHistoryTabKey;
  /** FR customer-facing copy (mirrors the gérant's vocabulary + the admin
   * sister page #415). Pinned by the unit test so a reword breaks loudly. */
  label: string;
};

/**
 * The 4 tabs in canonical PRD 20 §8 order. Pinned by the test suite — a
 * reorder fires there so the regression is visible. « Toutes » FIRST so the
 * screen boots on the broadest view (« scan all terminals, then narrow »),
 * same default discipline as the admin sister page (`ORDER_TABS` in
 * `orders-tabs.ts`).
 */
export const ORDER_HISTORY_TABS: readonly OrderHistoryTab[] = [
  { key: "all", label: "Toutes" },
  { key: "delivered_collected", label: "Livrées / Collectées" },
  { key: "refused", label: "Refusées" },
  { key: "missed", label: "Manquées" },
] as const;

/**
 * The closed set of TERMINAL statuses the history screen renders. The home
 * queue (`tenantOrders`) shows IN-FLIGHT statuses (`nouvelle`,
 * `en préparation`, `prête`); the history shows everything terminal that
 * can land in the « 4 onglets ». `remise` is intentionally absent —
 * delivery's `remise` is the courier-handoff transitional, not a terminal
 * (the order moves to `livrée` once the courier confirms the drop).
 * `en attente de paiement` is never surfaced to the resto.
 *
 * Used by:
 *  - `applyHistoryTabFilter("all", …)` to filter the input down to the
 *    terminal universe BEFORE applying the per-tab subset (so a leaked
 *    `nouvelle` row never appears in the « Toutes » tab),
 *  - `isHistoryTerminal` for callers that need the bare predicate (e.g.
 *    the detail screen, which keys its read-only branch on the same set).
 */
export const HISTORY_TERMINAL_STATUSES: readonly OrderStatus[] = [
  "livrée",
  "collectée",
  "refusée",
  "auto_expired",
] as const;

/** True iff the status belongs to the closed terminal set the history surfaces. */
export function isHistoryTerminal(status: OrderStatus): boolean {
  return (HISTORY_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * The status subset a tab maps to, or `null` for the « Toutes » passthrough
 * (the page-level applier distinguishes « show all terminals » from « show
 * nothing » via `null` vs `[]`).
 *
 * The mapping is EXACT — adding a new V2 terminal (e.g. `refunded`,
 * `cancelled_courier`) surfaces here as a TS compilation error
 * (`OrderStatus` literal mismatch) AND in the unit test, so the new status
 * cannot silently land outside any tab.
 */
export function STATUSES_FOR_HISTORY_TAB(
  key: OrderHistoryTabKey,
): OrderStatus[] | null {
  switch (key) {
    case "all":
      // Null = no further status restriction (within the terminal universe
      // the caller already restricts to). The « all » tab still excludes
      // in-flight noise — that filter lives in `applyHistoryTabFilter`.
      return null;
    case "delivered_collected":
      // PRD 20 §5: the two happy-path terminals (delivery vs click & collect).
      return ["livrée", "collectée"];
    case "refused":
      // PRD 20 §6a — human refusal with motif. DISTINCT from auto_expired
      // (ADR 0016 — orthogonal signals: business vs operational).
      return ["refusée"];
    case "missed":
      // PRD 20 §6b + ADR 0016 — operational terminal. The PRD's exact word
      // for the auto_expired row (« le gérant mesure son propre taux de
      // cmds ratées »).
      return ["auto_expired"];
  }
}

/**
 * Restrict `orders` to the tab's status subset. Pure: same input, same
 * output. Preserves input order (the backend already sorts DESC; the tab
 * filter must not re-sort).
 *
 * IMPORTANT: even for the « all » tab, the filter excludes NON-terminal
 * statuses — the history is terminal-only by definition. This guards
 * against a race where a freshly-confirmed `nouvelle` order would briefly
 * appear in both the home and the history if the page composed them in
 * the wrong order.
 */
export function applyHistoryTabFilter(
  orders: Doc<"orders">[],
  tabKey: OrderHistoryTabKey,
): Doc<"orders">[] {
  // First, drop non-terminal noise — the history universe is the 4
  // terminals (HISTORY_TERMINAL_STATUSES).
  const terminals = orders.filter((o) => isHistoryTerminal(o.status));
  const allowed = STATUSES_FOR_HISTORY_TAB(tabKey);
  if (allowed === null) return terminals; // passthrough on « Toutes »
  const set = new Set<string>(allowed);
  return terminals.filter((o) => set.has(o.status));
}

// ---------------------------------------------------------------------------
// ID search (MOAT — ADR 0010, NO name search)
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring search over `String(order._id)`. Empty /
 * whitespace-only query is a passthrough. Pure, no `Date.now()`, no I/O.
 *
 * MOAT discipline (ADR 0010 / PRD 70 §4.4 / customer-data CONTEXT):
 *  - ID-ONLY. Customer names / phones / emails are NEVER searchable from
 *    a `kb_manager` surface. The issue body asked « par ID cmd ou nom
 *    client » — MOAT forbids the second half, so we keep ID only.
 *  - The order id IS surfaced to the gérant (it lands on the Stripe
 *    receipt + the card header « Cmd #XXXX »), so searching by it is the
 *    documented workflow (« Khan a un client au téléphone qui pose une
 *    question, il cherche par ID »).
 *
 * Mirrors the admin sister `searchOrdersById` (#415) exactly so the two
 * surfaces behave identically.
 */
export function searchOrdersById(
  orders: Doc<"orders">[],
  query: string,
): Doc<"orders">[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return orders;
  const needle = trimmed.toLowerCase();
  return orders.filter((o) => String(o._id).toLowerCase().includes(needle));
}

// ---------------------------------------------------------------------------
// Date range period filter (PRD 20 §8 « Filtres période »)
// ---------------------------------------------------------------------------

/**
 * The 4 date-range presets the screen exposes (PRD 20 §8 « Filtres :
 * période (aujourd'hui / 7j / 30j / custom) »). « custom » is V2 — V1
 * sticks to the 3 fixed presets + the « tout » passthrough so the
 * surface stays touch-friendly on a kitchen tablet.
 */
export type DateRangeKey = "today" | "7d" | "30d" | "tout";

/** Read-only tuple of the 4 presets in their canonical reading order. */
export const DATE_RANGE_PRESETS: readonly DateRangeKey[] = [
  "today",
  "7d",
  "30d",
  "tout",
] as const;

/**
 * Inject a fixed "now" so tests stay deterministic across CI clocks. In
 * production the screen passes `Date.now()` (the default).
 */
export type DateRangeFilterOpts = {
  now?: number;
};

/**
 * Restrict `orders` to the date-range preset's window. Local-midnight
 * boundaries: the gérant thinks in his wall clock, not UTC; a closure
 * that says « aujourd'hui » must really end at LOCAL 00:00 tomorrow.
 *
 * Mirror of the admin `filterOrders` date-range bounds (#238), with a
 * simpler local-time implementation (no Europe/Paris ICU bisection): the
 * native runtime's `Date` constructor handles local midnight + DST jumps,
 * and the kitchen tablet's TZ is always the resto's local TZ (mono-tenant
 * device, no cross-TZ split brain).
 *
 *  - `today` → [start of today local, start of tomorrow local).
 *  - `7d`    → [start of today − 6 days local, start of tomorrow local).
 *  - `30d`   → [start of today − 29 days local, start of tomorrow local).
 *  - `tout`  → null (passthrough; returns input as-is).
 *
 * Preserves input order (the backend already sorts DESC).
 */
export function filterOrdersByDateRange(
  orders: Doc<"orders">[],
  dateRange: DateRangeKey,
  opts: DateRangeFilterOpts = {},
): Doc<"orders">[] {
  if (dateRange === "tout") return orders;
  const now = opts.now ?? Date.now();
  const bounds = computeDateBounds(dateRange, now);
  return orders.filter(
    (o) =>
      o.createdAt >= bounds.minInclusive && o.createdAt < bounds.maxExclusive,
  );
}

/**
 * Compute the half-open `[minInclusive, maxExclusive)` window for one of
 * the three day-based presets. The upper bound is start-of-tomorrow local
 * (exclusive) — a future-dated row (clock drift, test fixtures) is
 * rejected by `today`, otherwise « aujourd'hui » would misleadingly
 * include it.
 */
function computeDateBounds(
  dateRange: Exclude<DateRangeKey, "tout">,
  now: number,
): { minInclusive: number; maxExclusive: number } {
  const startOfToday = startOfLocalDay(now);
  const startOfTomorrow = addLocalDays(startOfToday, 1);
  const daysBack = dateRange === "today" ? 0 : dateRange === "7d" ? 6 : 29;
  const minInclusive = addLocalDays(startOfToday, -daysBack);
  return { minInclusive, maxExclusive: startOfTomorrow };
}

/** Local-midnight epoch of the day containing `ms` (handles DST correctly). */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
}

/** Add N calendar days to a local-midnight epoch, snapping back to local midnight. */
function addLocalDays(localMidnightMs: number, days: number): number {
  const d = new Date(localMidnightMs);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + days,
    0,
    0,
    0,
    0,
  ).getTime();
}

// ---------------------------------------------------------------------------
// auto_expired detail note (PRD 20 §8 « message neutre si auto_expired »)
// ---------------------------------------------------------------------------

/** The three mutually-exclusive verdicts for the detail-screen note. */
export type AutoExpiredDetailNoteDecision =
  | { kind: "hide" }
  | {
      kind: "show";
      heading: string;
      body: string;
    };

/**
 * Decide whether the detail screen should surface a neutral note explaining
 * the auto_expired terminal. PRD 20 §8 explicitly demands a « message
 * neutre » — the gérant should not feel blamed (the timeout fired
 * automatically, the refund happened automatically, there is nothing to do).
 *
 * Distinct from the human refusal motif (`refusée` → `decideRefusalReasonLabel`
 * + the event log carries the picked reason), this note is the UI-level
 * reassurance for the auto_expired terminal SPECIFICALLY. Pure: same input,
 * same output.
 */
export function decideAutoExpiredDetailNote(
  status: OrderStatus,
): AutoExpiredDetailNoteDecision {
  if (status === "auto_expired") {
    return {
      kind: "show",
      heading: "Commande manquée",
      body: "Cette commande n'a pas été prise dans les 5 minutes — elle a été automatiquement annulée et le client a été remboursé.",
    };
  }
  return { kind: "hide" };
}
