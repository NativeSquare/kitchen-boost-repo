import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import {
  customerMutation,
  getOrCreateCustomerFiche,
  listTenantCustomerOrders,
  patchCustomerPushEnrollment,
  readCustomerAggregateFields,
  tenantQuery,
} from "../tenancy";

/**
 * 2.1-D — Reachability by channel (push / email / SMS) + push enrollment
 * (PRD 90 §3, ADR 0012, customer-data CONTEXT "Re-engagement channel").
 *
 * Customer Data owns "who is reachable and by which id" (Notifications 2.7 owns
 * the actual sending). This module exposes:
 *  - `channelReachability` — PURE rule: is a customer reachable on push / email /
 *    SMS, given the captation + push-enrollment fields. No Convex ctx.
 *  - `setPushEnrollment` — SELF-scoped (`customerMutation`; the same self contract
 *    is what Notifications 2.7 calls on the customer's behalf): writes
 *    `walletSerialNumber` / `webPushSubscriptionId` + a per-channel status, and a
 *    single status can be UPDATED (web-push expiry, opt-out) without clobbering
 *    the others (US #16). Reaches the GLOBAL `customers` fiche ONLY through the
 *    sanctioned tenancy seam — never raw `ctx.db` (ADR 0010).
 *  - `reachabilityCounts` — per-tenant aggregate, COUNTS ONLY to a `kb_manager`
 *    (never a raw `customer` — the MOAT), reconstructed from
 *    `customerOrdersPerTenant` (which carries `tenantId`).
 *
 * Identity flows ONLY through `getCurrentActor` (ADR 0011, inside the wrappers).
 * `customerOrdersPerTenant` is READ-ONLY here (its stats are written by 2.3).
 */

/** Per-channel push enrollment status (mirrors the schema union). */
const pushChannelStatus = v.union(
  v.literal("enrolled"),
  v.literal("not_enrolled"),
  v.literal("revoked"),
);

/** The fields the reachability rule reads off a customer fiche. */
export type ReachabilityInput = {
  email?: string;
  phone?: string;
  pushEnrollment?: Doc<"customers">["pushEnrollment"];
};

/** Reachability state per channel (PRD 90 §3 KPI atteignabilité). */
export type ChannelReachability = {
  push: boolean;
  email: boolean;
  sms: boolean;
};

/**
 * PURE rule — is the customer reachable on each channel?
 *  - email : a non-empty email is present.
 *  - sms   : a non-empty phone is present.
 *  - push  : ANY push channel is `enrolled` (Wallet OR web-push OR A2HS) —
 *            `not_enrolled` / `revoked` / absent do not count.
 * An anonymised customer (all fields nullified) is reachable on no channel.
 */
export function channelReachability(
  input: ReachabilityInput,
): ChannelReachability {
  const e = input.pushEnrollment;
  const push =
    e?.walletStatus === "enrolled" ||
    e?.webPushStatus === "enrolled" ||
    e?.a2hsStatus === "enrolled";
  return {
    push,
    email: !!input.email && input.email.length > 0,
    sms: !!input.phone && input.phone.length > 0,
  };
}

/**
 * Record / update the caller's OWN push enrollment (ADR 0012). Provisions the
 * fiche on the fly if absent. Only the provided fields are written; the seam
 * MERGES them into the existing `pushEnrollment` so a single-channel update keeps
 * the other channels intact (US #16). Self-scoped: the handler only ever sees
 * `ctx.actor.userId`.
 */
export const setPushEnrollment = customerMutation({
  args: {
    walletSerialNumber: v.optional(v.string()),
    webPushSubscriptionId: v.optional(v.string()),
    walletStatus: v.optional(pushChannelStatus),
    webPushStatus: v.optional(pushChannelStatus),
    a2hsStatus: v.optional(pushChannelStatus),
  },
  handler: async (ctx, args): Promise<void> => {
    const customerId = await getOrCreateCustomerFiche(ctx, ctx.actor.userId);
    await patchCustomerPushEnrollment(ctx, customerId, {
      walletSerialNumber: args.walletSerialNumber,
      webPushSubscriptionId: args.webPushSubscriptionId,
      walletStatus: args.walletStatus,
      webPushStatus: args.webPushStatus,
      a2hsStatus: args.a2hsStatus,
    });
  },
});

/** Per-tenant reachability counts exposed to the resto (counts only — the MOAT). */
export type ReachabilityCounts = {
  push: number;
  email: number;
  sms: number;
  total: number;
};

/**
 * Per-tenant "N clients atteignables par canal" KPI for the calling tenant
 * (kb_manager; kb_admin via root override). Reconstructed from
 * `customerOrdersPerTenant`, scoped to `ctx.tenantId`: for each linked customer,
 * read the NARROW reachability fields off the GLOBAL fiche (sanctioned seam) and
 * reduce to counts. Returns ONLY counts — never a customer fiche or coordinate
 * (PRD 90 §3 / Q90-Q2, the MOAT). This is the source feeding slice E's resto KPI.
 */
export const reachabilityCounts = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<ReachabilityCounts> => {
    const links = await listTenantCustomerOrders(ctx, ctx.tenantId);
    const counts: ReachabilityCounts = {
      push: 0,
      email: 0,
      sms: 0,
      total: 0,
    };
    for (const link of links) {
      const fields = await readCustomerAggregateFields(ctx, link.customerId);
      if (fields === null) continue; // fiche vanished — skip (no phantom count)
      counts.total += 1;
      const r = channelReachability(fields);
      if (r.push) counts.push += 1;
      if (r.email) counts.email += 1;
      if (r.sms) counts.sms += 1;
    }
    return counts;
  },
});
