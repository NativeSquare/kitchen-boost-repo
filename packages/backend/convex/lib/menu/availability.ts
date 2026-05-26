import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { ServiceWindow } from "../../table/serviceHours";
import {
  listAllTenantIds,
  listTenantServiceWindows,
  listTenantUnavailableItems,
  setTenantItemAvailability,
  tenantMutation,
} from "../tenancy";
import { parisLocalParts } from "./serviceHours";

/**
 * 2.2-D / 2.2-fix (#105) — Disponibilité item : toggle out-of-stock +
 * auto-réactivation à la PREMIÈRE OUVERTURE DE SERVICE après `unavailableSince`
 * (client-ordering CONTEXT "Item out of stock" — indisponible "jusqu'à fin de
 * service", "Auto-réactivation au lendemain à l'ouverture du resto selon [[Plage
 * horaire de service]]"; multi-tenant CONTEXT — `staff` may "toggle out of
 * stock"; ADR 0010).
 *
 * Builds on the `available` / `unavailableSince` fields (2.2-A), the item CRUD
 * (2.2-B), and the service hours (2.2-E).
 *
 *  - `setItemAvailability` — `tenantMutation` allowing BOTH `kb_manager` AND
 *    `staff` (the multi-tenant CONTEXT grants staff the out-of-stock toggle).
 *    The 1-tap KDS trigger lives in the front (out of scope); here = the field +
 *    mutation. Stamps `unavailableSince` on toggle-off, clears it on toggle-on.
 *
 *  - Auto-reactivation — a Convex cron (`crons.ts`) walks every tenant and flips
 *    each unavailable item back ON once the resto has crossed its NEXT service
 *    OPENING (per its service hours, Europe/Paris). The "which items now?"
 *    decision is the PURE `itemsToReactivate` (windows + items + clock → ids),
 *    tested deterministically on injected clocks; `reactivateTenantUnavailableItems`
 *    is the tenant-aware wiring the cron calls per tenant.
 *
 * Reactivation timing rule (#105 — corrects #56's hardcoded "lendemain", NOT
 * invented; read from the CONTEXT): an item marked unavailable is reactivated
 * once a SERVICE-OPENING BOUNDARY (a window's `startMinute`, Europe/Paris) occurs
 * STRICTLY AFTER `unavailableSince` and at/before `now`. Equivalently: the latest
 * opening boundary `≤ now` is strictly later than `unavailableSince`. The exact
 * hour is therefore the resto's own opening — never a guessed constant. Two
 * consequences over the old "next calendar day":
 *   - An item toggled off BEFORE the day's opening returns at that SAME day's
 *     opening (it must not skip a whole day).
 *   - An item toggled off DURING a running service stays "jusqu'à fin de service"
 *     — the next opening (typically the next service / next day) brings it back.
 * A resto with no windows never opens, so its items are never auto-reactivated
 * (the manager reactivates them manually).
 */

const PARIS_TZ = "Europe/Paris";

/** Milliseconds in a full day. */
const MS_PER_DAY = 86_400_000;
/**
 * How far back to scan for the most recent opening. Windows repeat weekly, so any
 * existing opening boundary is at most 7 days behind `now`; +1 day of slack
 * covers DST jitter around the boundary search.
 */
const OPENING_SCAN_DAYS = 8;

/** The minimal item shape the reactivation decision needs (pure-testable). */
export type ReactivatableItem = {
  _id: Id<"menuItems">;
  available: boolean;
  unavailableSince?: number;
};

/** The Europe/Paris local wall-clock parts of a UTC instant (date + time). */
function parisDateTimeParts(nowMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // `Intl` can emit "24" for midnight in some engines; normalise to 0.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * The offset (ms) Europe/Paris is ahead of UTC at `nowMs` (+1h CET, +2h CEST).
 * PURE — derived from the IANA tz data, so the CET/CEST switch is handled for
 * free. Computed as (Paris-wall-clock read as if it were UTC) − (the instant).
 */
function parisOffsetMs(nowMs: number): number {
  const p = parisDateTimeParts(nowMs);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  // Round to the second the instant carries (offsets are whole minutes anyway).
  return asUtc - Math.floor(nowMs / 1000) * 1000;
}

/** The local Europe/Paris calendar Y-M-D of a UTC instant. PURE. */
function parisYmd(nowMs: number): { year: number; month: number; day: number } {
  const { year, month, day } = parisDateTimeParts(nowMs);
  return { year, month, day };
}

/**
 * The UTC instant (ms) of a given Europe/Paris wall-clock (calendar Y-M-D +
 * `minuteOfDay`). PURE. Resolves the CET/CEST offset from the IANA tz data (a
 * naive UTC guess, corrected by the offset the platform reports there), so it
 * lands on the right UTC ms across DST. Windows are real opening minutes (never
 * inside the spring-forward gap), so the single correction pass is exact.
 */
function parisWallClockToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): number {
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  return guess - parisOffsetMs(guess);
}

/**
 * The UTC instant (ms) of the most recent SERVICE-OPENING boundary at or before
 * `nowMs`, evaluated in Europe/Paris, or `undefined` if the resto has no windows
 * (it never opens). PURE (no I/O, no wall-clock). Scans the current Paris day and
 * the preceding `OPENING_SCAN_DAYS - 1`, materialises every window opening on
 * those days, and returns the latest one that is `≤ now`. Used as the single
 * reactivation boundary: an item reactivates iff this is strictly after its
 * `unavailableSince`.
 */
export function latestServiceOpeningAtOrBefore(
  windows: ServiceWindow[],
  nowMs: number,
): number | undefined {
  if (windows.length === 0) return undefined;
  let best: number | undefined;
  for (let back = 0; back < OPENING_SCAN_DAYS; back++) {
    // The Paris calendar date `back` days before `now` (read from a UTC instant
    // that is unambiguously on that local day — noon avoids DST edges).
    const { year, month, day } = parisYmd(nowMs - back * MS_PER_DAY);
    const dayOfWeek = parisLocalParts(
      parisWallClockToUtc(year, month, day, 12 * 60),
    ).dayOfWeek;
    for (const w of windows) {
      if (w.dayOfWeek !== dayOfWeek) continue;
      const opening = parisWallClockToUtc(year, month, day, w.startMinute);
      if (opening <= nowMs && (best === undefined || opening > best)) {
        best = opening;
      }
    }
  }
  return best;
}

/**
 * The ids of the items to auto-reactivate at `nowMs`, given the tenant's service
 * `windows`. PURE (no I/O, no wall-clock) — the single reactivation decision
 * point. An item qualifies iff it is currently unavailable WITH an
 * `unavailableSince` stamp AND a service-opening boundary has occurred STRICTLY
 * AFTER that stamp and at/before `now` (i.e. the latest opening `≤ now` is later
 * than `unavailableSince`). No windows ⇒ never opens ⇒ nothing reactivates.
 */
export function itemsToReactivate(
  windows: ServiceWindow[],
  items: ReactivatableItem[],
  nowMs: number,
): Id<"menuItems">[] {
  const latestOpening = latestServiceOpeningAtOrBefore(windows, nowMs);
  if (latestOpening === undefined) return [];
  const out: Id<"menuItems">[] = [];
  for (const item of items) {
    if (item.available || item.unavailableSince === undefined) continue;
    if (latestOpening > item.unavailableSince) {
      out.push(item._id);
    }
  }
  return out;
}

// --- Convex surface ----------------------------------------------------------

/**
 * Toggle one of the tenant's items in/out of stock (kb_manager OR staff). Stamps
 * `unavailableSince` on the off transition, clears it on the on transition.
 * Refuses a foreign/missing `itemId` (NOT_FOUND) — never a cross-tenant write
 * (ADR 0010). Audited (availability gates whether an item can be sold).
 */
export const setItemAvailability = tenantMutation({
  allow: ["kb_manager", "staff"],
})({
  args: { itemId: v.id("menuItems"), available: v.boolean() },
  audit: true,
  action: "menu.setItemAvailability",
  handler: async (ctx, args): Promise<void> => {
    await setTenantItemAvailability(
      ctx,
      ctx.tenantId,
      args.itemId,
      args.available,
      Date.now(),
    );
  },
});

// --- Cron wiring (called from crons.ts, NOT a registered function) -----------

/**
 * Reactivate ONE tenant's due items at `nowMs` (the per-tenant unit the cron
 * fans out to). Reads only THIS tenant's windows + unavailable items through the
 * sanctioned store seam (keyed on the explicit `tenantId`), decides via the pure
 * `itemsToReactivate`, then clears each due item. Tenant-isolated by construction
 * — it can only ever touch `tenantId`'s rows (ADR 0010). Returns how many it
 * reactivated (for logging / tests).
 */
export async function reactivateTenantUnavailableItems(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  nowMs: number,
): Promise<number> {
  const windows = await listTenantServiceWindows(ctx, tenantId);
  const items: Doc<"menuItems">[] = await listTenantUnavailableItems(
    ctx,
    tenantId,
  );
  const dueIds = itemsToReactivate(windows, items, nowMs);
  for (const itemId of dueIds) {
    // `true` clears `unavailableSince` on the on-transition (idempotent).
    await setTenantItemAvailability(ctx, tenantId, itemId, true, nowMs);
  }
  return dueIds.length;
}

/**
 * Reactivate due items across EVERY tenant at `nowMs` (the whole cron pass). Fans
 * out over `listAllTenantIds` and processes each tenant in isolation. Used by the
 * `crons.ts` internal mutation; `nowMs` is injected so the pass is deterministic
 * in tests.
 */
export async function reactivateAllTenantsUnavailableItems(
  ctx: MutationCtx,
  nowMs: number,
): Promise<number> {
  const tenantIds = await listAllTenantIds(ctx);
  let total = 0;
  for (const tenantId of tenantIds) {
    total += await reactivateTenantUnavailableItems(ctx, tenantId, nowMs);
  }
  return total;
}
