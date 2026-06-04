import {
  customerMutation,
  getOrCreateCustomerFiche,
  logAudit,
  patchCustomerPushEnrollment,
} from "../tenancy";

/**
 * PWA-S6c (#457) — `customer.pushEnrollment.markNoChannelPossible`.
 *
 * Final escape hatch of the push-enrollment 3-paliers flow (PRD 10 PWA Client
 * §9 + decisions-log Q8 (5) + CONTEXT customer-data « Push enrollment »):
 * when the user has exhausted the 3-level frictional « Continuer sans
 * notifs » fallback (2 documented failures Wallet + Web Push + 3 confirm
 * screens re-refused), the front fires this mutation to flip the flag,
 * unlock the « Payer » gate (via the Convex sub on `pushEnrollment`), and
 * close the blocking modal. The customer is then routed through the SMS
 * fallback transactionnel via Cascade Notifications (estimated ~5% of cases).
 *
 * SELF-SCOPED via `customerMutation` (same contract as
 * `reachability.setPushEnrollment` and `webPush.register`): the handler only
 * ever sees `ctx.actor.userId` (resolved by `getCurrentActor`, ADR 0011) and
 * the explicit wrapper `tenantId`. It reaches the GLOBAL `customers` fiche
 * ONLY through the sanctioned `lib/tenancy/customerOrdersStore` seam
 * (`patchCustomerPushEnrollment`), never raw `ctx.db` (ADR 0010 /
 * `no-untenanted-query`). The seam MERGES so the per-channel statuses
 * already on the fiche (a Wallet pass added later, a Web Push subscribe
 * tomorrow) are NOT clobbered by the flip — the historical signal is
 * additive.
 *
 * The action is audited EXPLICITLY (one row tagged
 * `customer.pushEnrollment.markNoChannelPossible` with the customer id as
 * `targetId`) — `customerMutation` does not auto-log (audit is opt-in on
 * customer surfaces, only `kbAdminMutation` auto-logs). The insert commits in
 * the same transaction as the flag flip, so a refused call leaves NO row.
 *
 * Takes ZERO business args. The historical `customerId` mentioned in the
 * issue body would have been a self-scope smell (a customer cannot ask to
 * mark someone else's fiche). The wrapper resolves the SELF customer, in line
 * with the rest of the customer surface (the same shape `webPush.register`
 * and `recordConsentAtCheckout` take).
 */
export const markNoChannelPossible = customerMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    await patchCustomerPushEnrollment(ctx, customerId, {
      noChannelPossible: true,
    });
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: "customer.pushEnrollment.markNoChannelPossible",
      tenantId: ctx.tenantId,
      targetType: "customer",
      targetId: customerId,
    });
  },
});
