/**
 * Public API of the `notifications` backend module (chantier 2.7 — Notifications,
 * moteur transactionnel + marketing, PRD 80).
 *
 * 2.7-A — SCHEMA LAYER. Lays the `notificationTemplates` + `notificationEvents`
 * tables (in `convex/table/notifications.ts`, registered through `schema.ts`) and
 * the DECLARATIVE template bounds shared with their validators.
 *
 * 2.7-B — the transactional MOTEUR: the semantic event API + the hardcoded V1
 * channel routing (3 categories), but NOT the concrete senders (web-push #54,
 * APNs #71, email = later slices) and NOT campaigns (slice C/D).
 *
 *  - `notifyOrderEvent` (the semantic event API) — a `tenantMutation` callers
 *    (Orders / Delivery, KB Admin) invoke with a BUSINESS event + an order id; they
 *    pass NO channel. The moteur decides the category + channels and journals the
 *    planned sends. Routes through the tenancy wrappers (never raw `ctx.db`, ADR
 *    0010) and ships a cross-tenant fuzz suite. Convex addresses it by its module
 *    path (`api.lib.notifications.notify.notifyOrderEvent`); this re-export only
 *    states the contract.
 *  - `categories` — the PURE, hardcoded routing of the 8 V1 triggers → the 3
 *    transactional categories (Archive / Temps-réel / Info statut) + the candidate
 *    channel set + SMS-fallback eligibility (PRD 80 §1 matrix). No invented mapping.
 *  - `engine` — the PURE deep module: a trigger + a customer's channel availability
 *    (READ from 2.1 reachability, ADR 0012 — never duplicated) → the LIST of
 *    effective sends. No network I/O; the dispatch is a later slice.
 *
 * The push joignabilité (Wallet serial / web-push id / per-channel status) is NOT
 * here: it lives in 2.1 `customers.pushEnrollment` (ADR 0012). 2.7 only sends.
 *
 *  - `findTemplateBoundViolation` + the bound constants — the pure, declarative
 *    guardrails of a pre-validated campaign template (ADR 0006 / PRD 80 §4):
 *    `{discount}` ≤ 50 %, rendered length < 200 chars, French only, no alcohol,
 *    only known interpolable variables. The single source of truth shared by the
 *    schema validators and the later (slice C/D) send-time enforcement.
 */
export {
  ARCHIVE_TRIGGERS,
  INFO_STATUT_TRIGGERS,
  SMS_FALLBACK_TRIGGERS,
  TEMPS_REEL_TRIGGERS,
  TRANSACTIONAL_ROUTING,
  type TriggerRouting,
  categoryForTrigger,
  channelsForTrigger,
  smsFallbackEligible,
} from "./categories";
export {
  type ChannelAvailability,
  type PlannedSend,
  channelAvailabilityFrom,
  planTransactionalSends,
} from "./engine";
export { notifyOrderEvent } from "./notify";
export {
  ALLOWED_TEMPLATE_VARIABLES,
  MAX_DISCOUNT_PERCENT,
  MAX_RENDERED_LENGTH,
  TEMPLATE_LANGUAGE,
  type TemplateBoundInput,
  type TemplateBoundViolation,
  type TemplateVariable,
  findTemplateBoundViolation,
} from "./templateBounds";
