import { v } from "convex/values";
import {
  customerMutation,
  getOrCreateCustomerFiche,
  logAudit,
  patchCustomerConsent,
} from "../tenancy";

/**
 * 2.7-D — `unsubscribe(sourcePushId)`, the moteur's marketing opt-out entry point
 * (PRD 80 §5 "Unsubscribe global", ADR 0005). The customer taps the unsubscribe
 * link in ANY marketing push/email; that is a SELF action, so this is a
 * `customerMutation` keyed on `ctx.actor.userId` (the link carries no foreign
 * customer id — the caller's own identity is resolved via `getCurrentActor`, ADR
 * 0011; `sourcePushId` is the originating message, recorded for the audit trail).
 *
 * V1 granularity = GLOBAL (ADR 0005): one tap exits the customer from ALL
 * marketing — tenant AND cross-tenant — by stamping `marketingOptOutDate`. The
 * `marketingEligible` rule then excludes them everywhere until a later checkout
 * re-consents (re-consent par achat). TRANSACTIONAL messaging is UNAFFECTED (base
 * contractuelle) — it never reads `marketingEligible`. Reaches the GLOBAL
 * `customers` fiche ONLY through the sanctioned tenancy seam — never raw `ctx.db`
 * (ADR 0010).
 */
export const unsubscribe = customerMutation({
  args: {
    /** The marketing push/email the unsubscribe link came from (audit trail). */
    sourcePushId: v.optional(v.id("notificationEvents")),
  },
  handler: async (ctx, args): Promise<void> => {
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    // Global marketing opt-out (ADR 0005): tenant + cross-tenant in one geste.
    await patchCustomerConsent(ctx, customerId, {
      marketingOptOutDate: Date.now(),
    });
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: "notifications.unsubscribe",
      tenantId: ctx.tenantId,
      targetType: "customer",
      targetId: customerId,
      metadata: { sourcePushId: args.sourcePushId ?? null, scope: "global" },
    });
  },
});
