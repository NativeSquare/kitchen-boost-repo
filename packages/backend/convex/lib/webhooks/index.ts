/**
 * Public API of the `webhooks` foundation module (1.x-F) — the shared
 * idempotence guard for every external webhook (Stripe, Uber Direct, Resend;
 * Hubrise in V2). STACK.md §2.7 / §5.2.
 *
 * Consume from HERE:
 *  - `withIdempotence(ctx, provider, eventId, handler)` — run a webhook handler
 *    at most once per `(provider, eventId)`. CALL FROM A WEBHOOK `httpAction`
 *    (after verifying the HMAC on the raw body), with a write-capable mutation
 *    ctx so the dedup mark and the handler commit/roll back atomically.
 *  - `WebhookProvider` — the string union of known providers (Stripe, Uber
 *    Direct, Resend; Hubrise V2), for typing call sites.
 *
 * The dedup ledger table `processedWebhookEvents` and its composite unique
 * index `by_provider_event` (`provider`, `externalId`) are an implementation
 * detail of this module — consumers never touch the ledger directly.
 */
export { type WebhookProvider, withIdempotence } from "./idempotent";
