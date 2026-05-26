/**
 * Public API of the `uberDirect` backend module (chantier 2.6 — Delivery via
 * Uber Direct, PRD 40, delivery CONTEXT).
 *
 * 2.6-A — the credential persistence + delivery store socle. No real Uber call,
 * no UI: this slice lays the tenant-scoped `deliveries` table access + the
 * per-tenant Uber credential storage (REUSING the foundation `lib/crypto`
 * envelope encryption, `provider = "uber_direct"`, master key `KMS_MASTER_KEY`).
 *
 * Isolation (ADR 0010): every function goes through a tenancy wrapper and reaches
 * the datastore only through the sanctioned `lib/tenancy` / `lib/crypto` seams —
 * no raw `ctx.db` in this module. Decryption of the Uber credential is
 * ACTION-ONLY (never an exposed query — MOAT). Both sub-modules ship cross-tenant
 * fuzz suites.
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.uberDirect.credentials.*` / `api.lib.uberDirect.deliveries.*`;
 * re-exporting here does not change that path — it states the module's contract
 * in one place. The guarded query/mutation/action functions are therefore NOT
 * re-exported (a barrel re-export would not change their callable address); only
 * the shared TYPES + validators are surfaced here.
 *
 *  - credentials: `setUberCredentials` (write/rotate, audited), `getUberCredentialBlob`
 *    (encrypted envelope only), `getDecryptedUberCredentials` (ACTION — the only
 *    decrypt). Credential shape: `UberCredentials` / `uberCredentials`.
 *  - deliveries: `createDelivery`, `patchDelivery`, `listDeliveries`,
 *    `getDeliveryByOrder`. The row shape (mode / status / incident) lives in the
 *    table validators, surfaced here as the module's typed contract.
 *  - quote (2.6-B): `requestQuote` (ACTION — the address-first Uber Direct quote;
 *    decrypts the creds in-action, OAuth + `delivery_quotes`, the ONLY Uber
 *    conversation). Result shape `UberQuoteResult` / `uberQuoteResult`; the pure
 *    `interpretQuoteResponse` maps the HTTP result onto fee/eta or a refusal
 *    reason. The livrabilité cross with service hours lives in `lib/delivery`.
 *  - createDelivery (2.6-C): `createDelivery` (ACTION — the ONLY caller of Uber
 *    `POST /deliveries`; decrypts the creds in-action, OAuth, binds the accepted
 *    `quote_id` + manifest + idempotency key). Result `CreateDeliveryResult` /
 *    `createDeliveryResult`; the pure `interpretCreateDeliveryResponse` maps the
 *    HTTP result onto a created course or the PRD 40 §5 Cas A refusal.
 *  - webhookEvents (2.6-C): the PURE `mapWebhookEvent(payload)` mapping an Uber
 *    delivery-status / courier-update event onto the internal transition
 *    (`WebhookTransition`: status / courier / ETA / incident + the notification
 *    trigger consumed by 2.7 + the KDS signal). The per-tenant webhook httpAction
 *    that consumes it lives in `lib/delivery/webhooks`.
 */
export { type UberCredentials, uberCredentials } from "./credentials";
export {
  type UberQuoteResult,
  interpretQuoteResponse,
  uberQuoteResult,
} from "./quote";
export {
  type CreateDeliveryResult,
  createDeliveryResult,
  interpretCreateDeliveryResponse,
} from "./createDelivery";
export {
  type KdsSignal,
  type WebhookTransition,
  mapWebhookEvent,
} from "./webhookEvents";
export {
  type DeliveryIncidentType,
  type DeliveryMode,
  type DeliveryStatus,
  deliveryIncidentType,
  deliveryMode,
  deliveryStatus,
} from "../../table/deliveries";
