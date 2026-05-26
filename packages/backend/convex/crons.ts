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

// 2.2-D / 2.2-fix (#105) — Auto-réactivation of out-of-stock menu items at the
// first service-opening boundary after `unavailableSince` (PRD 10 §edge "Item
// out of stock", client-ordering CONTEXT). Hourly so every tenant's opening
// minute is caught soon after it passes (the per-item decision is the pure
// `itemsToReactivate`, so the cadence never affects correctness — re-runs are
// idempotent). Runs system-side (no actor); the reactivation logic stays
// tenant-isolated through the store seam (ADR 0010).
crons.interval(
  "reactivate-unavailable-menu-items",
  { hours: 1 },
  internal.crons.reactivateUnavailableItems,
  {},
);

// 2.9-F — Monitoring incidents scan (PRD 70 §3.8, kb-admin CONTEXT "Monitoring
// incidents"). Periodically scans for ops incidents (webhook latency > 30 s, KYC
// pending > 48 h, paid order with no Uber course) and posts ONE Slack ops alert
// per incident to `SLACK_OPS_WEBHOOK_URL`. The action no-ops cleanly when no
// incident fires or the webhook URL is unset, so the schedule is always safe to
// run. 15 min keeps alerts timely without hammering Slack (the scan is cheap and
// idempotent — re-runs simply re-emit the still-open incidents). System job (no
// actor); all reads go through the tenancy store seams (ADR 0010).
crons.interval(
  "monitoring-incident-scan",
  { minutes: 15 },
  internal.lib.admin.monitoring.runMonitoringScan,
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
 * 2.2-D / 2.2-fix (#105) — one auto-reactivation pass: flip every tenant's due
 * out-of-stock items back ON once a service opening has occurred strictly after
 * their `unavailableSince` (per service hours, Europe/Paris). `now` is optional
 * and injectable so the pass is deterministic in tests; production passes nothing
 * and uses the wall clock. The decision logic is the pure `itemsToReactivate`
 * (tested in isolation); this only wires the clock and fans out per tenant
 * through the tenant-scoped store seam (ADR 0010).
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
