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
 * 2.2-D — Disponibilité item : toggle out-of-stock + auto-réactivation au
 * lendemain (PRD 10 §edge "Item out of stock" — "Auto-réactivation au
 * lendemain"; client-ordering CONTEXT "Item out of stock" — "Auto-réactivation
 * automatique au lendemain à l'ouverture du resto selon [[Plage horaire de
 * service]]"; multi-tenant CONTEXT — `staff` may "toggle out of stock"; ADR 0010).
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
 *    each unavailable item back ON once the resto has crossed the NEXT day's
 *    opening (per its service hours, Europe/Paris). The "which items now?"
 *    decision is the PURE `itemsToReactivate` (windows + items + clock → ids),
 *    tested deterministically on injected clocks; `reactivateTenantUnavailableItems`
 *    is the tenant-aware wiring the cron calls per tenant.
 *
 * Reactivation timing rule (NOT invented — read from the PRD/CONTEXT): an item
 * marked unavailable on a given Europe/Paris calendar day is reactivated once
 * (a) the current clock is on a STRICTLY LATER Paris calendar day, AND (b) the
 * resto has actually OPENED on that later day (a service window for that weekday
 * whose `startMinute` has been reached). The exact hour is therefore the resto's
 * own opening — never a guessed constant. A resto with no windows never opens, so
 * its items are never auto-reactivated (the manager reactivates them manually).
 */

const PARIS_TZ = "Europe/Paris";

/**
 * A stable, comparable Europe/Paris CALENDAR-DAY number for a UTC instant (days
 * since the Unix epoch, in Paris local time). PURE. Comparing two ordinals tells
 * whether `now` is on a strictly later Paris day than `unavailableSince`,
 * correctly across month/year and DST boundaries (the local Y-M-D is read via the
 * IANA tz data, then converted to a day count with `Date.UTC`).
 */
export function parisDayOrdinal(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  let year = 0;
  let month = 1;
  let day = 1;
  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  // Day count since the epoch for the Paris calendar date (time-of-day dropped).
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** The minimal item shape the reactivation decision needs (pure-testable). */
export type ReactivatableItem = {
  _id: Id<"menuItems">;
  available: boolean;
  unavailableSince?: number;
};

/** Whether the resto has reached an opening on `now`'s Europe/Paris weekday. */
function hasOpenedToday(windows: ServiceWindow[], nowMs: number): boolean {
  const { dayOfWeek, minuteOfDay } = parisLocalParts(nowMs);
  return windows.some(
    (w) => w.dayOfWeek === dayOfWeek && w.startMinute <= minuteOfDay,
  );
}

/**
 * The ids of the items to auto-reactivate at `nowMs`, given the tenant's service
 * `windows`. PURE (no I/O, no wall-clock) — the single reactivation decision
 * point. An item qualifies iff it is currently unavailable WITH an
 * `unavailableSince` stamp, the clock is on a strictly later Paris calendar day
 * than that stamp, AND the resto has opened on the current day (per `windows`).
 * No windows ⇒ never opens ⇒ nothing reactivates.
 */
export function itemsToReactivate(
  windows: ServiceWindow[],
  items: ReactivatableItem[],
  nowMs: number,
): Id<"menuItems">[] {
  if (!hasOpenedToday(windows, nowMs)) return [];
  const nowDay = parisDayOrdinal(nowMs);
  const out: Id<"menuItems">[] = [];
  for (const item of items) {
    if (item.available || item.unavailableSince === undefined) continue;
    if (parisDayOrdinal(item.unavailableSince) < nowDay) {
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
