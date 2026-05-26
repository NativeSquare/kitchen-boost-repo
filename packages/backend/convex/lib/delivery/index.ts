/**
 * Public API of the `delivery` backend module (chantier 2.6 — Delivery via Uber
 * Direct, PRD 40, delivery CONTEXT).
 *
 * 2.6-B — the address-first livrabilité orchestration. It crosses the Uber Direct
 * [[Quote]] (owned by `lib/uberDirect`, the only module that talks to Uber) with
 * the [[Plage horaire de service]] (KB source of truth, READ from 2.2) and
 * returns the front's verdict `{ deliverable, fee, eta, reason? }`,
 * `reason ∈ { hors_zone, hors_horaire, surge }`. It also exposes the LATCHING
 * re-capture at payment consumed by 2.5. No UI; 2.6 only READS the schedule
 * (2.2 frontier) and does NOT wire the Stripe webhook (2.5 frontier).
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.delivery.quote.*`; re-exporting here does not change that path — it
 * states the module's contract in one place. The guarded action/query functions
 * (`requestDeliveryQuote`, `recaptureQuoteAtPayment`, `readServiceOpen`) are
 * therefore NOT re-exported (a barrel re-export would not change their callable
 * address); only the shared TYPES + the pure verdict mapping are surfaced here.
 *
 *  - quote: `requestDeliveryQuote` (address-first, gates on service hours then
 *    Uber), `recaptureQuoteAtPayment` (latching re-quote for 2.5),
 *    `readServiceOpen` (tenant-scoped 2.2 read + the fuzzable access gate). The
 *    verdict shape is `DeliveryQuoteVerdict` / `deliveryQuoteVerdict`; the pure
 *    `crossQuoteWithServiceHours` is the deterministically-tested decision.
 *  - course (2.6-C): `createCourseOnPaymentConfirmed` (INTERNAL action — the
 *    delivery-domain executor triggered by 2.5's `payment_intent.succeeded`
 *    signal; turns the seeded `pending` row into a real Uber [[Course]], no-op for
 *    click & collect). The Uber call is owned by `lib/uberDirect.createDelivery`.
 *  - webhooks (2.6-C): `uberWebhook` (the per-tenant `…/webhooks/uber/<tenantId>`
 *    httpAction — raw-body `x-uber-signature` verify, tenant routing, idempotent
 *    apply) + `applyUberWebhookEvent` (the system-side idempotent write). Wired in
 *    `convex/http.ts` via `pathPrefix` (POC #5). These are registered by their
 *    module path, so they are not re-exported here.
 */
export {
  type DeliveryQuoteVerdict,
  crossQuoteWithServiceHours,
  deliveryQuoteVerdict,
} from "./quote";
