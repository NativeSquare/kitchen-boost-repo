import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { reactivateAllTenantsUnavailableItems } from "./lib/menu/availability";

const crons = cronJobs();

// Clean up old emails from the resend component every hour
// This removes finalized emails (delivered, cancelled, bounced) older than 7 days
crons.interval(
  "cleanup-old-emails",
  { hours: 1 },
  internal.crons.cleanupResendEmails,
);

// 2.2-D — Auto-réactivation au lendemain of out-of-stock menu items (PRD 10
// §edge "Item out of stock", client-ordering CONTEXT). Hourly so every tenant's
// opening minute is caught soon after it passes (the per-item decision is the
// pure `itemsToReactivate`, so the cadence never affects correctness — re-runs
// are idempotent). Runs system-side (no actor); the reactivation logic stays
// tenant-isolated through the store seam (ADR 0010).
crons.interval(
  "reactivate-unavailable-menu-items",
  { hours: 1 },
  internal.crons.reactivateUnavailableItems,
  {},
);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FOUR_WEEKS_MS = 4 * ONE_WEEK_MS;

export const cleanupResendEmails = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Clean up old finalized emails (7 days)
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    });
    // Clean up abandoned emails (4 weeks) - these usually indicate bugs
    await ctx.scheduler.runAfter(
      0,
      components.resend.lib.cleanupAbandonedEmails,
      { olderThan: FOUR_WEEKS_MS },
    );
    return null;
  },
});

/**
 * 2.2-D — one auto-reactivation pass: flip every tenant's due out-of-stock items
 * back ON once they have crossed the next-day opening (per service hours,
 * Europe/Paris). `now` is optional and injectable so the pass is deterministic in
 * tests; production passes nothing and uses the wall clock. The decision logic is
 * the pure `itemsToReactivate` (tested in isolation); this only wires the clock
 * and fans out per tenant through the tenant-scoped store seam (ADR 0010).
 */
export const reactivateUnavailableItems = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { now }) => {
    await reactivateAllTenantsUnavailableItems(ctx, now ?? Date.now());
    return null;
  },
});

export default crons;
