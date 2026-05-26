import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  type StripeAccountStatus,
  getTenantByStripeAccount,
  setTenantStripeStatus,
} from "../tenancy";
import { withIdempotence } from "../webhooks";
import { type StripeAccountSnapshot, mapStripeAccountToStatus } from "./status";

/**
 * 2.5-A — Stripe `account.updated` webhook ingestion (PRD 30 §1, payment
 * CONTEXT). The HTTP route is wired in `convex/http.ts`; it verifies the HMAC on
 * the RAW body (POC #1 ✅: `await request.text()` before parse, `crypto.subtle`,
 * default Convex runtime — STACK §2.3 / spike poc-1) and then calls the internal
 * mutation below.
 *
 * The DB write is wrapped in `withIdempotence(ctx, "stripe", eventId, …)` so the
 * SAME `(stripe, eventId)` delivered twice updates the tenant only once
 * (Stripe at-least-once delivery; ADR-style idempotence ledger, STACK §2.7).
 *
 * Status mapping is the PURE `mapStripeAccountToStatus` (a rejected KYC never
 * maps to `ready`). The tenant is resolved BY its `stripeAccountId` (the only id
 * Stripe carries) through the sanctioned `lib/tenancy` seam — no raw `ctx.db`
 * here (`no-untenanted-query`). An event for an unknown account is a clean no-op.
 *
 * The Slack ops alert when the resulting status is `pending` (KYC still pending
 * at the end of the Phase C kickoff — PRD 30 §1) is posted by the HTTP action
 * caller (a network call belongs in an action, not a mutation); this mutation
 * reports back whether an alert is warranted via its return value.
 */

/** Validator for the slice of the Stripe `account` object we read. */
const stripeAccountSnapshot = v.object({
  charges_enabled: v.optional(v.boolean()),
  payouts_enabled: v.optional(v.boolean()),
  requirements: v.optional(
    v.union(
      v.null(),
      v.object({ disabled_reason: v.optional(v.union(v.null(), v.string())) }),
    ),
  ),
});

/** Outcome of applying one `account.updated` event (drives the Slack alert). */
export type AccountUpdatedOutcome = {
  /** false ⇒ duplicate delivery (idempotent no-op) OR unknown account. */
  applied: boolean;
  /** The status written, when `applied`. */
  status?: StripeAccountStatus;
  /** The resolved tenant id, when `applied`. */
  tenantId?: string;
};

/**
 * Apply a Stripe `account.updated` event to the matching tenant, exactly once
 * per `(stripe, eventId)`. Resolves the tenant by `account.id` (= `acct_xxx`);
 * an unknown account is a no-op. Returns whether the status was actually written
 * (false on a duplicate or unknown account), the new status and the tenant id.
 *
 * INTERNAL — called only from the verified webhook `httpAction` in `http.ts`,
 * never exposed publicly. System-side (no actor): the tenant is reached only via
 * the `getTenantByStripeAccount` / `setTenantStripeStatus` tenancy seams keyed on
 * the Stripe-supplied account id, so the webhook can never write a foreign tenant
 * (there is no user-supplied tenant id to forge).
 */
export const applyAccountUpdated = internalMutation({
  args: {
    eventId: v.string(),
    accountId: v.string(),
    account: stripeAccountSnapshot,
  },
  returns: v.object({
    applied: v.boolean(),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("disabled")),
    ),
    tenantId: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<AccountUpdatedOutcome> => {
    let outcome: AccountUpdatedOutcome = { applied: false };
    await withIdempotence(ctx, "stripe", args.eventId, async () => {
      const tenant = await getTenantByStripeAccount(ctx, args.accountId);
      // Unknown account → nothing to update (still marked processed so a replay
      // of this stray event is a clean no-op).
      if (tenant === null) return;
      const status = mapStripeAccountToStatus(
        args.account as StripeAccountSnapshot,
      );
      await setTenantStripeStatus(ctx, tenant._id, status);
      outcome = { applied: true, status, tenantId: tenant._id };
    });
    return outcome;
  },
});
