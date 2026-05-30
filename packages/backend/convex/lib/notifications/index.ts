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
  findRenderedViolation,
  findTemplateBoundViolation,
  renderTemplate,
} from "./templateBounds";

/**
 * 2.7-D — the MARKETING branch of the moteur (PRD 80 §2/§4/§6/§7, PRD 90 §5, ADRs
 * 0005/0006/0010/0012). The MOAT-sensitive heart: KB sends in PROXY, the resto
 * (`kb_manager`) NEVER sees a recipient identity — campaigns return aggregate
 * counts only. Convex addresses the mutations by their module path
 * (`api.lib.notifications.campaigns.*`, `api.lib.notifications.unsubscribe.*`);
 * these re-exports only state the contract.
 *
 *  - `sendTenantCampaign` — `kb_manager`, pre-validated template (no free text),
 *    cascade tenant (Web Push > Wallet > Email).
 *  - `sendCrossTenantCampaign` — `kb_admin` ONLY (KB proxy), free content, cascade
 *    cross-tenant (Wallet > Email, web-push excluded). A resto can NEVER fire it.
 *  - `unsubscribe` — self-scoped global marketing opt-out (ADR 0005).
 *
 * 2.7-E — the REACHABILITY status FEEDBACK to 2.1 (#16), the source of truth (ADR
 * 0012, PRD 80 §7). 2.7 owns the SENDING, not the reachability, but it discovers
 * when a push channel dies (web-push 410 Gone) and must report it. `recordChannelInactive`
 * (`tenantMutation`, operational) writes `revoked` SIDE 2.1 via 2.1's by-id seam
 * (referencing the customer by id, never 2.7-local, never 2.1's tables directly)
 * and marks the originating `notificationEvents` row `inactive_endpoint`; the
 * cascade then re-derives the next channel from 2.1 on its own. `pushStatusPatchForDeadChannel`
 * is the PURE dead-channel → 2.1-patch seam. The opt-out half of the same loop is
 * `unsubscribe` (slice D) propagating `marketingOptOutDate` to 2.1.
 *
 * The PURE seams (unit-testable in isolation, no Convex ctx):
 *  - `marketingCascade` — pick the ONE effective channel per scope.
 *  - `marketingRateLimit` — 3 marketing push / semaine / client GLOBAL.
 *  - `dnt` — 22h-8h Europe/Paris quiet window + the 08:00 shift.
 *  - `antiAnomaly` — per-resto frequency (> 1/48h, > 3/sem) + recipient surge.
 *
 * 2.7-F — the WALLET DISPATCHER (slice C, restricted to the Wallet channel, PRD 80
 * §1/§7, ADR 0002/0003). After `notifyOrderEvent` journals the `queued` sends it
 * SCHEDULES `dispatch.dispatchWalletSends` with the Wallet event ids; that internal
 * action fires the Wallet transport (#71 `triggerUpdate`) and moves each Wallet row
 * to `sent` / `failed` / `inactive_endpoint`. The `email`/`sms` rows stay `queued`
 * (their transports are later slices / never V1). Like `triggerUpdate`, the dispatch
 * is INTERNAL-ONLY (system-side, scheduler-invoked) and addressed by its module path
 * (`internal.lib.notifications.dispatch.*`) — so the barrel does NOT re-export it.
 *
 * 2.7-C (#54) — the WEB-PUSH DISPATCHER (slice C, the second effective channel after
 * Wallet, PRD 80 §1/§3, STACK §5.5, POC #2). Same shape as the Wallet dispatcher:
 * `notifyOrderEvent` SCHEDULES `dispatch.dispatchWebPushSends` with the `web_push`
 * event ids; that internal action reads the customer's ACTIVE subscriptions through
 * the #128 tenant-scoped read seam, HMAC-signs a `fetch` to the Next.js Node route
 * (`apps/web/app/api/push/send`, where the `web-push` VAPID encryption runs — the V8
 * Convex runtime can't do ECDH AES-GCM), and moves each row to `sent` / `failed` /
 * `inactive_endpoint` (on a 410 Gone it soft-deactivates the endpoint via the #128
 * seam). Also INTERNAL-ONLY — the barrel exposes only the pure channel predicate.
 */
export {
  type CampaignResult,
  type TenantTemplateSummary,
  listTenantTemplates,
  sendCrossTenantCampaign,
  sendTenantCampaign,
} from "./campaigns";
export { unsubscribe } from "./unsubscribe";
export {
  type DeadPushChannel,
  pushStatusPatchForDeadChannel,
  recordChannelInactive,
} from "./reachabilityFeedback";
export {
  CROSS_TENANT_CASCADE,
  TENANT_CASCADE,
  type MarketingChannel,
  type MarketingReachability,
  pickMarketingChannel,
} from "./marketingCascade";
export {
  RATE_LIMIT_PER_WEEK,
  RATE_WINDOW_MS,
  countInWindow,
  withinRateLimit,
} from "./marketingRateLimit";
export {
  DEFAULT_DNT_END_HOUR,
  DEFAULT_DNT_START_HOUR,
  inDoNotTrackWindow,
  nextSendableTime,
  parisHour,
} from "./dnt";
export {
  ANOMALY_MAX_PER_48H,
  ANOMALY_MAX_PER_WEEK,
  ANOMALY_RECIPIENT_SURGE_RATIO,
  type CampaignAnomaly,
  type CampaignLaunchRecord,
  findCampaignAnomaly,
} from "./antiAnomaly";
// 2.7-F / 2.7-C — the dispatchers' PURE contracts (the channel predicates); the
// Convex actions `dispatchWalletSends` / `dispatchWebPushSends` are internal-only and
// reached via internal.* — the barrel deliberately does NOT re-export them.
export {
  WALLET_CHANNELS,
  WEB_PUSH_CHANNEL,
  type WalletChannel,
  isWalletChannel,
  isWebPushChannel,
} from "./dispatch";
