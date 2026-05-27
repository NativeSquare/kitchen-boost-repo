import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import {
  markTenantNotificationEventInactive,
  requireTenantNotificationEvent,
  setTenantNotificationEventFailed,
  setTenantNotificationEventSent,
} from "../tenancy";

/**
 * 2.7-F — the Wallet DISPATCHER (slice C of the Notifications moteur, RESTRICTED to
 * the Wallet channel). PRD 80 §1/§7, ADR 0002 (push moat — Wallet = canal de
 * reconquête n°1, ~99 % lock-screen), ADR 0003 (carte commune marque neutre, the
 * only cross-tenant channel), ADR 0010 (isolation), ADR 0012 (push enrollment +
 * MOAT — customer BY ID only).
 *
 * ── The gap this closes ───────────────────────────────────────────────────────
 * The engine (#44, `lib/notifications/notify`) decides WHAT/WHERE and journals one
 * `notificationEvents` row per effective channel as `queued` — it sends NOTHING.
 * The Wallet transport (#71, `lib/wallet/triggerUpdate`) sends, but nothing wired
 * the queued sends to it. This is that glue: after `notifyOrderEvent` journals the
 * `queued` sends it SCHEDULES `dispatchWalletSends` (a `tenantMutation` cannot call
 * an `internalAction` directly), which fires the Wallet transport and reflects the
 * outcome back onto the journal row.
 *
 * ── Wallet ONLY (the rest stays queued) ───────────────────────────────────────
 * Web Push (#54), email and SMS transports are LATER slices; this dispatcher touches
 * ONLY the two Wallet channels — `notifyOrderEvent` passes it ONLY the Wallet event
 * ids, and the action defensively re-checks the channel off the row. A non-Wallet
 * row is NEVER read here, never `triggerUpdate`d and never `failed` — it stays
 * `queued` until its own transport lands.
 *
 *   | queued channel | transport call                       | journal transition |
 *   | -------------- | ------------------------------------ | ------------------ |
 *   | wallet_push    | triggerUpdate(customerId, false)     | lock-screen push   |
 *   | wallet_silent  | triggerUpdate(customerId, true)      | silent card update |
 *
 * Status (PRD 80 §7 "Endpoint expiré : marker inactive"):
 *  - pushed to ≥ 1 live device      → `sent` (+`sentAt`).
 *  - no active device / all tokens dead (US 27, APNs 410-equiv) → `inactive_endpoint`
 *    (consistent with `reachabilityFeedback` #65 — the inactivity seam to 2.1).
 *  - the transport THREW (Node route unreachable / payload rejected) → `failed`
 *    (a transient transport problem, NOT a reachability signal — never fed to 2.1).
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * `dispatchWalletSends` is an `internalAction` (system-side; the scheduler calls it,
 * NEVER client-callable, so it is addressed by its module path and the barrel does
 * NOT re-export it). It receives a `tenantId` the emitting `tenantMutation` already
 * resolved + the journaled event ids — never a user-forgeable scope. Every journal
 * read/patch goes through the sanctioned tenant-scoped `lib/tenancy` seam
 * (`requireTenantNotificationEvent` / `set…Sent` / `set…Failed` /
 * `markTenantNotificationEventInactive`) — never raw `ctx.db` in this business module
 * — and each re-checks ownership (a foreign `eventId` → NOT_FOUND, no cross-tenant
 * write). MOAT (ADR 0012): the customer is referenced strictly BY ID (read off the
 * queued row), `triggerUpdate` returns only an aggregate count, and no nominative
 * coordinate is ever read or logged.
 */

/** The two Wallet channels this slice dispatches (the rest is later slices). */
const WALLET_CHANNELS = ["wallet_push", "wallet_silent"] as const;
type WalletChannel = (typeof WALLET_CHANNELS)[number];

function isWalletChannel(channel: string): channel is WalletChannel {
  return (WALLET_CHANNELS as readonly string[]).includes(channel);
}

/** A queued Wallet send resolved for dispatch — the customer BY ID only (MOAT). */
type WalletSend = {
  customerId: Id<"customers">;
  /** `true` ⇒ silent card update (Info statut); `false` ⇒ lock-screen push. */
  silent: boolean;
};

/**
 * INTERNAL — resolve a tenant's journaled send into a Wallet dispatch instruction,
 * or `null` when the row is NOT a Wallet channel (a later slice owns it) or is no
 * longer `queued` (already dispatched — idempotent, never re-sent). Tenant-scoped
 * via the sanctioned seam (a foreign `eventId` → NOT_FOUND, no cross-tenant read).
 * Returns ONLY the customer id + the silent flag — never a nominative field (MOAT).
 */
export const resolveWalletSend = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    eventId: v.id("notificationEvents"),
  },
  returns: v.union(
    v.object({ customerId: v.id("customers"), silent: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<WalletSend | null> => {
    const row = await requireTenantNotificationEvent(
      ctx,
      args.tenantId,
      args.eventId,
    );
    // Only Wallet channels are dispatched here; only still-queued rows are sent
    // (a re-run never re-pushes an already-resolved send).
    if (!isWalletChannel(row.channel) || row.status !== "queued") {
      return null;
    }
    return {
      customerId: row.customerId,
      // wallet_silent = silent card update (US 16); wallet_push = lock-screen.
      silent: row.channel === "wallet_silent",
    };
  },
});

/** The terminal status the dispatcher writes back for one Wallet send. */
const dispatchOutcome = v.union(
  v.literal("sent"),
  v.literal("failed"),
  v.literal("inactive_endpoint"),
);
type DispatchOutcome = "sent" | "failed" | "inactive_endpoint";

/**
 * INTERNAL — write the dispatch outcome onto a tenant's journal row, through the
 * sanctioned tenant-scoped seam (foreign `eventId` → NOT_FOUND). `sent` stamps
 * `sentAt`; `failed` records a transport error; `inactive_endpoint` reuses the
 * existing #65 marker (a dead Wallet endpoint). The single mutation per send so the
 * status transition commits on its own.
 */
export const recordWalletDispatch = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    eventId: v.id("notificationEvents"),
    outcome: dispatchOutcome,
    sentAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.outcome === "sent") {
      await setTenantNotificationEventSent(
        ctx,
        args.tenantId,
        args.eventId,
        args.sentAt ?? Date.now(),
      );
    } else if (args.outcome === "failed") {
      await setTenantNotificationEventFailed(ctx, args.tenantId, args.eventId);
    } else {
      await markTenantNotificationEventInactive(
        ctx,
        args.tenantId,
        args.eventId,
      );
    }
    return null;
  },
});

/** Map the Wallet transport's aggregate count onto a journal outcome. */
function outcomeFromTransport(res: {
  pushed: number;
  deactivated: number;
}): DispatchOutcome {
  // No active device (no fetch) OR every targeted token was reported dead (410
  // equivalent) ⇒ the endpoint is inactive (US 27). Otherwise at least one live
  // device received it ⇒ sent.
  if (res.pushed === 0 || res.deactivated >= res.pushed) {
    return "inactive_endpoint";
  }
  return "sent";
}

/**
 * Dispatch the Wallet sends a transactional event journaled (`wallet_push` /
 * `wallet_silent`). For each event id: resolve it (skip non-Wallet / already-handled
 * rows), fire the Wallet transport `triggerUpdate(customerId, silent)`, and record
 * the outcome on the journal row. A transport that THROWS → `failed`; an aggregate
 * count of zero live devices → `inactive_endpoint`; otherwise → `sent`. Returns an
 * aggregate count only (`{ dispatched }`) — never a raw customer (the MOAT).
 */
export const dispatchWalletSends = internalAction({
  args: {
    tenantId: v.id("tenants"),
    eventIds: v.array(v.id("notificationEvents")),
  },
  returns: v.object({ dispatched: v.number() }),
  handler: async (ctx, args): Promise<{ dispatched: number }> => {
    let dispatched = 0;
    for (const eventId of args.eventIds) {
      const send = await ctx.runQuery(
        internal.lib.notifications.dispatch.resolveWalletSend,
        { tenantId: args.tenantId, eventId },
      );
      // Not a Wallet send, or already dispatched ⇒ leave the row untouched.
      if (send === null) continue;

      const outcome = await fireWalletSend(ctx, send);
      await ctx.runMutation(
        internal.lib.notifications.dispatch.recordWalletDispatch,
        {
          tenantId: args.tenantId,
          eventId,
          outcome,
          ...(outcome === "sent" ? { sentAt: Date.now() } : {}),
        },
      );
      dispatched += 1;
    }
    return { dispatched };
  },
});

/**
 * Fire ONE Wallet send through the existing transport (#71) and classify the
 * result. A thrown transport error (Node route unreachable / misconfigured /
 * payload rejected) is a `failed` send — caught here so one dead send never aborts
 * the rest of the batch.
 */
async function fireWalletSend(
  ctx: ActionCtx,
  send: WalletSend,
): Promise<DispatchOutcome> {
  try {
    const res = await ctx.runAction(
      internal.lib.wallet.triggerUpdate.triggerUpdate,
      { customerId: send.customerId, silent: send.silent },
    );
    return outcomeFromTransport(res);
  } catch {
    return "failed";
  }
}
