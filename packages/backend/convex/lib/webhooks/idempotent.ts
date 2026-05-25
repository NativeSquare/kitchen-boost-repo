import type { MutationCtx } from "../../_generated/server";

/**
 * 1.x-F — `withIdempotence`, the single anti-double-processing guard shared by
 * every external webhook (Stripe, Uber Direct, Resend; Hubrise in V2).
 * STACK.md §2.7 / §5.2.
 *
 * External providers deliver webhook events AT LEAST ONCE: the same event may
 * arrive several times (provider retry, our 5xx, a network hiccup after we
 * committed). Re-running the handler would double-charge / double-fulfil. This
 * helper makes a webhook handler effectively run **exactly once** per
 * `(provider, eventId)`.
 *
 * It is an INTERNAL helper — NOT an exposed query/mutation. A webhook
 * `httpAction` first verifies the HMAC on the raw body, then calls this with a
 * write-capable mutation ctx (the dedup insert + the handler must share one
 * atomic transaction; see "atomicity" below).
 *
 * Mechanism:
 *  1. Look up the dedup ledger `processedWebhookEvents` on its composite index
 *     `by_provider_event` (`provider`, `externalId`).
 *  2. Row already there → this event was already processed → RETURN without
 *     replaying `handler` (silent no-op; the caller answers the provider 200).
 *  3. Otherwise insert the ledger row, then run `handler`.
 *
 * Atomicity / retry semantics: the ledger insert and `handler` run inside the
 * SAME Convex mutation transaction. If `handler` throws, the transaction —
 * including the ledger insert — rolls back, the error propagates, and the
 * webhook can be safely retried by the provider (the event is NOT marked
 * processed). On success, both the side effect and the dedup mark commit
 * together, so a later redelivery is a clean no-op.
 *
 * `provider` is the source name (`"stripe"`, `"uber_direct"`, `"resend"`, …) and
 * `eventId` is that provider's own event identifier — the pair, not the id
 * alone, is the dedup key, so two providers may reuse the same id without
 * colliding.
 */
export async function withIdempotence(
  // The dedup mark and the handler MUST commit/roll back together, so this
  // requires a write-capable ctx (`db.insert`), i.e. a mutation ctx.
  ctx: Pick<MutationCtx, "db">,
  provider: string,
  eventId: string,
  handler: () => Promise<void>,
): Promise<void> {
  const existing = await ctx.db
    .query("processedWebhookEvents")
    .withIndex("by_provider_event", (q) =>
      q.eq("provider", provider).eq("externalId", eventId),
    )
    .unique();

  // Already processed → do NOT replay the handler (idempotent no-op).
  if (existing !== null) return;

  // Mark first, then run: on a throw the whole transaction (mark included)
  // rolls back, leaving the event un-processed and safely retryable.
  await ctx.db.insert("processedWebhookEvents", {
    provider,
    externalId: eventId,
    processedAt: Date.now(),
  });

  await handler();
}
