import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import {
  deactivateWebPushSubscription,
  listActiveWebPushSubscriptions,
  markTenantNotificationEventInactive,
  requireTenantNotificationEvent,
  setTenantNotificationEventFailed,
  setTenantNotificationEventSent,
} from "../tenancy";
import { signInternalRequest } from "../wallet/internalAuth";

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
export const WALLET_CHANNELS = ["wallet_push", "wallet_silent"] as const;
export type WalletChannel = (typeof WALLET_CHANNELS)[number];

/**
 * PURE — whether a journaled channel is a Wallet channel this slice dispatches. The
 * single source of truth shared by the emitter (`notify` selects the Wallet sends to
 * schedule) and the dispatcher (it defensively re-checks the channel off the row), so
 * the "Wallet only" boundary lives in ONE place. No Convex ctx — unit-testable.
 */
export function isWalletChannel(channel: string): channel is WalletChannel {
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

// ─────────────────────────────────────────────────────────────────────────────
// 2.7-C (#54) — the WEB-PUSH DISPATCHER (slice C, restricted to the `web_push`
// channel — the second effective channel after Wallet #126).
//
// ── Where the crypto runs (STACK §5.5 / POC #2) ──────────────────────────────
// The Web Push Protocol encryption (ECDH P-256 + HKDF + AES-128-GCM, RFC 8291) and
// the VAPID JWT do NOT run in the V8 Convex runtime — they live in the Next.js Node
// route (`apps/web/app/api/push/send`, `web-push` lib, VAPID keys from env). This
// action runs in the DEFAULT Convex runtime: it is the SOURCE OF TRUTH for the data
// (resolve the active subscriptions via the #128 read seam), then HMAC-signs the
// payload (`crypto.subtle`, same `signInternalRequest` primitive as the Wallet
// channel) and `fetch`es the Node route. There is NO VAPID key read here — never.
//
// ── web_push ONLY (the rest stays as #126 left it) ───────────────────────────
// `notifyOrderEvent` passes this action ONLY the `web_push` event ids; the action
// defensively re-checks the channel off the row. wallet / email / sms rows are never
// read, never sent and never `failed` here.
//
// Status (PRD 80 §7 "Endpoint expiré : marker inactive", notifications CONTEXT):
//  - pushed to ≥ 1 live endpoint               → `sent` (+`sentAt`).
//  - no active subscription / EVERY endpoint 410 Gone → `inactive_endpoint`, and each
//    gone endpoint is soft-deactivated via the #128 seam `deactivateWebPushSubscription`.
//  - the transport THREW or answered non-OK    → `failed` (transient — no endpoint
//    deactivation, no retry storm; NOT a reachability signal).
//
// ── Isolation (ADR 0010) ─────────────────────────────────────────────────────
// `dispatchWebPushSends` is an `internalAction` (system-side; the scheduler calls it,
// NEVER client-callable, so the barrel does NOT re-export it). It receives a
// `tenantId` the emitting `tenantMutation` already resolved + the journaled event ids.
// Every journal read/patch AND the subscription read/deactivate go through the
// sanctioned tenant-scoped `lib/tenancy` seams (a foreign `eventId`/`tenantId` →
// NOT_FOUND / out-of-scope, no cross-tenant access). MOAT (ADR 0012): the customer is
// referenced strictly BY ID; the action returns only an aggregate count.
// ─────────────────────────────────────────────────────────────────────────────

/** The web-push channel this slice dispatches. */
export const WEB_PUSH_CHANNEL = "web_push" as const;

/** The RFC 8291 subscription the Node route needs to encrypt + POST a push to. */
type WebPushSubscriptionPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** A queued web-push send resolved for dispatch — customer BY ID only (MOAT). */
type WebPushSend = {
  customerId: Id<"customers">;
  subscriptions: WebPushSubscriptionPayload[];
};

/** Read the internal-channel HMAC secret server-side (never via a query). */
function webPushInternalSecret(): string {
  const secret = process.env.WEB_PUSH_INTERNAL_HMAC_SECRET;
  if (!secret || secret === "") {
    throw new ConvexError({
      code: "MISCONFIGURED",
      message: "WEB_PUSH_INTERNAL_HMAC_SECRET is not configured.",
    });
  }
  return secret;
}

/** The Node web-push route URL, read server-side. The fetch TARGET (STACK §5.5). */
function webPushRouteUrl(): string {
  const url = process.env.WEB_PUSH_ROUTE_URL;
  if (!url || url === "") {
    throw new ConvexError({
      code: "MISCONFIGURED",
      message: "WEB_PUSH_ROUTE_URL is not configured.",
    });
  }
  return url;
}

/** Project a stored subscription row to the narrow RFC 8291 payload (no nominative). */
function toSubscriptionPayload(
  row: Doc<"webPushSubscriptions">,
): WebPushSubscriptionPayload {
  return { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

/**
 * INTERNAL — resolve a tenant's journaled send into a web-push dispatch instruction,
 * or `null` when the row is NOT a `web_push` channel (a later slice / #126 owns it)
 * or is no longer `queued` (already dispatched — idempotent). Tenant-scoped: the row
 * is read through the sanctioned seam (foreign `eventId` → NOT_FOUND) and the ACTIVE
 * subscriptions through the #128 tenant-scoped read seam (only the dispatching
 * tenant's subscriptions, never another origin's). Returns the customer id + the
 * subscriptions to encrypt to — never a nominative field (MOAT).
 */
export const resolveWebPushSend = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    eventId: v.id("notificationEvents"),
  },
  returns: v.union(
    v.object({
      customerId: v.id("customers"),
      subscriptions: v.array(
        v.object({
          endpoint: v.string(),
          p256dh: v.string(),
          auth: v.string(),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<WebPushSend | null> => {
    const row = await requireTenantNotificationEvent(
      ctx,
      args.tenantId,
      args.eventId,
    );
    if (row.channel !== WEB_PUSH_CHANNEL || row.status !== "queued") {
      return null;
    }
    const subs = await listActiveWebPushSubscriptions(
      ctx,
      row.customerId,
      args.tenantId,
    );
    return {
      customerId: row.customerId,
      subscriptions: subs.map(toSubscriptionPayload),
    };
  },
});

/**
 * INTERNAL — write the web-push dispatch outcome onto a tenant's journal row AND
 * soft-deactivate the gone endpoints (410), all through the sanctioned tenant-scoped
 * seams (foreign `eventId` → NOT_FOUND; the subscription deactivate is keyed on the
 * unique endpoint). `sent` stamps `sentAt`; `failed` records a transport error;
 * `inactive_endpoint` marks the row + flips every gone subscription `inactive` (the
 * #128 seam, soft — history kept). One mutation so the status + deactivations commit
 * together. The gone endpoints are the ones the route reported as 410.
 */
export const recordWebPushDispatch = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    eventId: v.id("notificationEvents"),
    outcome: dispatchOutcome,
    sentAt: v.optional(v.number()),
    goneEndpoints: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // A 410 means the endpoint expired — soft-deactivate it regardless of the row
    // outcome (a partial 410 still soft-deactivates the dead ones while the row is
    // `sent` on the live ones).
    for (const endpoint of args.goneEndpoints ?? []) {
      await deactivateWebPushSubscription(ctx, endpoint);
    }

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

/** The result of firing one web-push send through the Node route. */
type WebPushFireResult = {
  outcome: DispatchOutcome;
  goneEndpoints: string[];
};

/** The shape the Node web-push route answers (the endpoints it got 410 Gone on). */
type WebPushRouteResult = { goneEndpoints?: unknown };

/**
 * Fire ONE web-push send through the Node route: HMAC-sign the subscriptions +
 * payload and POST them. Classify the result:
 *  - thrown / non-OK            → `failed` (transient transport problem; no gone list).
 *  - every endpoint reported gone (410) → `inactive_endpoint` (+ the gone list).
 *  - ≥ 1 live endpoint          → `sent` (+ any partial gone list to soft-deactivate).
 * A thrown error is caught here so one dead send never aborts the rest of the batch.
 */
async function fireWebPushSend(send: WebPushSend): Promise<WebPushFireResult> {
  const body = JSON.stringify({
    customerId: send.customerId,
    subscriptions: send.subscriptions,
  });
  const { timestamp, signature } = await signInternalRequest(
    webPushInternalSecret(),
    body,
  );

  let res: Response;
  try {
    res = await fetch(webPushRouteUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kb-timestamp": timestamp,
        "x-kb-signature": signature,
      },
      body,
    });
  } catch {
    // Route unreachable — transient, no endpoint is "gone".
    return { outcome: "failed", goneEndpoints: [] };
  }

  if (!res.ok) {
    return { outcome: "failed", goneEndpoints: [] };
  }

  const parsed = (await res.json()) as WebPushRouteResult;
  const goneEndpoints = Array.isArray(parsed.goneEndpoints)
    ? parsed.goneEndpoints.filter((e): e is string => typeof e === "string")
    : [];

  // Every targeted endpoint reported 410 Gone ⇒ the customer is no longer reachable
  // on web-push for this tenant (US 27 equivalent) ⇒ inactive_endpoint.
  const total = send.subscriptions.length;
  if (goneEndpoints.length >= total) {
    return { outcome: "inactive_endpoint", goneEndpoints };
  }
  return { outcome: "sent", goneEndpoints };
}

/**
 * Dispatch the web-push sends a transactional event journaled (`web_push`). For each
 * event id: resolve it (skip non-web_push / already-handled rows), fire the Node
 * route per active subscription, soft-deactivate any 410 endpoint and record the
 * outcome on the journal row. No active subscription → `inactive_endpoint` (no fetch).
 * Returns an aggregate count only (`{ dispatched }`) — never a raw customer (the MOAT).
 */
export const dispatchWebPushSends = internalAction({
  args: {
    tenantId: v.id("tenants"),
    eventIds: v.array(v.id("notificationEvents")),
  },
  returns: v.object({ dispatched: v.number() }),
  handler: async (ctx, args): Promise<{ dispatched: number }> => {
    let dispatched = 0;
    for (const eventId of args.eventIds) {
      const send = await ctx.runQuery(
        internal.lib.notifications.dispatch.resolveWebPushSend,
        { tenantId: args.tenantId, eventId },
      );
      // Not a web-push send, or already dispatched ⇒ leave the row untouched.
      if (send === null) continue;

      let outcome: DispatchOutcome;
      let goneEndpoints: string[] = [];
      if (send.subscriptions.length === 0) {
        // Enrolled per the fiche but no active subscription ⇒ nothing to send.
        outcome = "inactive_endpoint";
      } else {
        const fired = await fireWebPushSend(send);
        outcome = fired.outcome;
        goneEndpoints = fired.goneEndpoints;
      }

      await ctx.runMutation(
        internal.lib.notifications.dispatch.recordWebPushDispatch,
        {
          tenantId: args.tenantId,
          eventId,
          outcome,
          ...(outcome === "sent" ? { sentAt: Date.now() } : {}),
          ...(goneEndpoints.length > 0 ? { goneEndpoints } : {}),
        },
      );
      dispatched += 1;
    }
    return { dispatched };
  },
});

/** PURE — whether a journaled channel is the web-push channel this slice dispatches. */
export function isWebPushChannel(channel: string): channel is "web_push" {
  return channel === WEB_PUSH_CHANNEL;
}
