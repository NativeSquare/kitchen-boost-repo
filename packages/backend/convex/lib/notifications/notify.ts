import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { transactionalTrigger } from "../../table/notifications";
import {
  type TenantRole,
  insertTenantNotificationEvent,
  readCustomerAggregateFields,
  requireTenantOrder,
  tenantMutation,
} from "../tenancy";
import {
  type PlannedSend,
  channelAvailabilityFrom,
  planTransactionalSends,
} from "./engine";

/**
 * 2.7-B — the SEMANTIC event API of the Notifications moteur (PRD 80, "API
 * métier"). Callers (Orders / Delivery on the 8 transactional triggers, KB Admin)
 * pass a BUSINESS event + the order it concerns; they pass NO channel — the engine
 * decides the category + channels from the hardcoded V1 routing (PRD 80 §1). Adding
 * In-App V2 or retiring SMS is a change INSIDE the moteur, zero impact on callers.
 *
 * Isolation (ADR 0010): `notifyOrderEvent` is a `tenantMutation` keyed on
 * `ctx.tenantId`. The order is resolved through the sanctioned `requireTenantOrder`
 * seam (ownership re-check ⇒ a foreign `orderId` is NOT_FOUND, never leaked), the
 * customer reachability is READ from 2.1's narrow projection (ADR 0012 — never
 * duplicated here), and each planned send is journaled through the sanctioned
 * `insertTenantNotificationEvent` seam — never raw `ctx.db` in this module
 * (`no-untenanted-query`). Operational roles may emit (kitchen accepts the order,
 * a webhook handler running on the resto's behalf, KB-admin root override).
 *
 * NO network I/O here: the concrete transports (web-push route #54, APNs #71,
 * email) are later slices. Each planned send is journaled as `queued` — the engine
 * decided WHAT/WHERE, the dispatch (and the move to `sent`/`delivered`) is slice C.
 * The SMS extreme fallback is journaled too but carries `sendable: false` (no
 * provider V1, Q80-Q4) so the dispatcher knows never to attempt it.
 */

/** Emitting a transactional event is an operational action (kitchen / webhook). */
const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

/**
 * Fire the transactional notifications for an order event. Resolves the order
 * (tenant-scoped), reads the customer's per-channel reachability from 2.1, asks the
 * pure engine for the effective sends, journals one `notificationEvents` row per
 * send, and returns the planned sends so the caller (and the later dispatcher) can
 * see what was routed. Returns `[]` when the customer is reachable on no channel.
 */
export const notifyOrderEvent = tenantMutation(OPERATIONAL_ALLOW)({
  args: {
    orderId: v.id("orders"),
    eventType: transactionalTrigger,
  },
  handler: async (ctx, args): Promise<PlannedSend[]> => {
    // Tenant-scoped order lookup — a foreign orderId throws NOT_FOUND (no leak).
    const order = await requireTenantOrder(ctx, ctx.tenantId, args.orderId);

    // Reachability READ from 2.1 (ADR 0012). A vanished fiche ⇒ reachable on
    // nothing ⇒ no send (defensive; the order's customer normally exists).
    const fields = await readCustomerAggregateFields(ctx, order.customerId);
    const availability = channelAvailabilityFrom(fields ?? {});

    const sends = planTransactionalSends(args.eventType, availability);

    for (const send of sends) {
      await insertTenantNotificationEvent(ctx, ctx.tenantId, {
        customerId: order.customerId as Id<"customers">,
        trigger: args.eventType,
        category: send.category,
        channel: send.channel,
        // Planned, not yet dispatched (the transport is slice C). SMS stays queued
        // and is never dispatched V1 (sendable: false).
        status: "queued",
      });
    }

    return sends;
  },
});
