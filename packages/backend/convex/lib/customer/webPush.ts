import { v } from "convex/values";
import {
  customerMutation,
  getOrCreateCustomerFiche,
  patchCustomerPushEnrollment,
  registerWebPushSubscription,
} from "../tenancy";

/**
 * 2.1-G — Web Push subscription registration (PRD 90 Customer Data, notifications
 * CONTEXT « Push subscription », ADR 0012 push split 2.1/2.7).
 *
 * The PWA calls `PushManager.subscribe()` and POSTs the resulting RFC 8291
 * subscription (endpoint + client keys) here. This slice PERSISTS it (so the send
 * layer #54 can later encrypt + POST to it — `customers.pushEnrollment` only holds
 * the opaque id + status, NOT the endpoint/keys) AND marks the customer reachable
 * on web-push (`pushEnrollment.webPushStatus = "enrolled"`), since reachability is
 * the SOURCE OF TRUTH in 2.1 (ADR 0012 — Notifications 2.7 only sends, keeps no
 * copy).
 *
 * SELF-SCOPED via `customerMutation`: the handler only ever sees `ctx.actor.userId`
 * (resolved by `getCurrentActor`, ADR 0011) and the explicit wrapper `tenantId`
 * (web-push is per-origin). It reaches the tenant-scoped `webPushSubscriptions`
 * table + the GLOBAL `customers` fiche ONLY through the sanctioned `lib/tenancy`
 * seam — never raw `ctx.db` (ADR 0010 / `no-untenanted-query`). The subscription is
 * stored against the caller's OWN fiche, referenced BY ID only (the MOAT).
 *
 * The actual web-push SEND (the VAPID-signed Node route + dispatcher) is #54 (2.7);
 * the PWA subscribe UI is a separate frontend story.
 */

/**
 * Register (idempotent upsert) the caller's OWN web-push subscription for the
 * wrapper tenant and flip its web-push reachability to `enrolled`.
 *
 * Provisions the fiche on the fly if absent. Idempotent by `endpoint` (a
 * re-subscribe of the same endpoint refreshes the client keys + reactivates the
 * row, never a duplicate). The `p256dh`/`auth` are CLIENT public keys (RFC 8291) —
 * runtime data, never a server secret (the VAPID keys are a 2.7 credential, never
 * stored here). Self-scoped: the handler only ever sees `ctx.actor.userId`.
 */
export const register = customerMutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    await registerWebPushSubscription(ctx, customerId, ctx.tenantId, {
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
    });
    // Reachability stays the source of truth in 2.1 (ADR 0012). The seam MERGES,
    // so the other push channels' ids/statuses are untouched (US #16).
    await patchCustomerPushEnrollment(ctx, customerId, {
      webPushStatus: "enrolled",
    });
  },
});
