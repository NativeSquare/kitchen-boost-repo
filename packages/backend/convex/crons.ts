import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const crons = cronJobs();

// Clean up old emails from the resend component every hour
// This removes finalized emails (delivered, cancelled, bounced) older than 7 days
crons.interval(
  "cleanup-old-emails",
  { hours: 1 },
  internal.crons.cleanupResendEmails,
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

export default crons;
