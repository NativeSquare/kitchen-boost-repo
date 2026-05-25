import { defineTable } from "convex/server";
import { type Infer, v } from "convex/values";
import {
  ALLOWED_TEMPLATE_VARIABLES,
  TEMPLATE_LANGUAGE,
} from "../lib/notifications/templateBounds";

/**
 * 2.7-A — Notifications schema layer: `notificationTemplates` (pre-validated
 * campaign presets, ADR 0006) + `notificationEvents` (the send journal). PRD 80
 * (Notifications), notifications CONTEXT, ADR 0006 (templates pré-validés), ADR
 * 0012 (push enrollment split), ADR 0010 (isolation multi-tenant applicative).
 *
 * SCHEMA-ONLY (this slice): the tables + their declarative bounds + the tenant
 * scoping indexes. NO business query/mutation is exposed at 2.7-A; the functions
 * that go through the tenancy wrappers (`tenantQuery`/`tenantMutation`, never raw
 * `ctx.db` — `no-untenanted-query`, ADR 0010) and ship the cross-tenant fuzz
 * suite land in the later 2.7 slices (B = templates/sender, C = campaigns…).
 *
 * ── Joignabilité reste en 2.1 — RIEN N'EST DUPLIQUÉ ICI (ADR 0012) ────────────
 * The push IDENTITY + REACHABILITY (Wallet `serial_number`, web-push subscription
 * id, per-channel enrolment status) live ENTIRELY on `customers.pushEnrollment`
 * (2.1 Customer Data) — "2.1 = qui est joignable et par quel id ; 2.7 = on envoie
 * le message". 2.7 therefore does NOT define a `pushSubscriptions` table: it only
 * REFERENCES the customer by id and READS the reachability from 2.1. The only
 * push asset 2.7 owns is the SERVER SENDING CREDENTIAL (VAPID key pair, APNs/FCM
 * certs) — which is a per-ENVIRONMENT secret (one pair per dev/prod, CONTEXT
 * "VAPID"), NOT customer- or tenant-scoped data, so it is configuration, not a
 * Convex table (and never committed). Hence: no joignabilité row here, by design.
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * Both tables carry `tenantId` and are TENANT-SCOPED. Indexed `by_tenant` (+
 * `by_customer` on events for re-engagement history). When the 2.7 business
 * functions land they reach these tables ONLY through a sanctioned `lib/tenancy`
 * seam, never raw `ctx.db`, and ship a cross-tenant fuzz suite. `customerId` is
 * referenced BY ID only — no nominative coordinate is copied (the MOAT).
 */

// ── notificationTemplates ─────────────────────────────────────────────────────

/**
 * Template scope (ADR 0006). `tenant` = pre-validated preset a resto fires to its
 * own clients (bounds enforced). `cross_tenant` = KB-root network campaign (KB
 * trusts its own tone — free content, ADR 0006). The closed V1 set.
 */
export const templateScope = v.union(
  v.literal("tenant"),
  v.literal("cross_tenant"),
);

/**
 * Deep-link destination of a marketing template (notifications CONTEXT "Deep link
 * tenant"): a tenant campaign opens the PWA `catalogue` with the promoted item
 * pinned, a cross-tenant one the tenant `home`. Closed V1 set — not invented.
 */
export const templateDeepLinkTarget = v.union(
  v.literal("catalogue"),
  v.literal("home"),
);

/** FR only V1 (ADR 0006 / PRD 80 §4); the union is built from the bounds const. */
export const templateLanguage = v.literal(TEMPLATE_LANGUAGE);

/**
 * The closed V1 set of interpolable variable names (ADR 0006 / PRD 80 §4), built
 * from the SAME constant the pure bounds checker uses so schema and checker stay
 * aligned. A persisted `variables` array may only contain these.
 */
export const templateVariable = v.union(
  ...ALLOWED_TEMPLATE_VARIABLES.map((name) => v.literal(name)),
);

export type TemplateScope = Infer<typeof templateScope>;
export type TemplateDeepLinkTarget = Infer<typeof templateDeepLinkTarget>;

/**
 * Pre-validated campaign template (ADR 0006): a body with interpolable variables
 * + a deep link + a scope, carrying the DECLARATIVE bounds (discount cap, FR,
 * alcohol flag) as columns so the runtime check (slice B) and the schema agree.
 * `key` is the stable identifier of a library entry; `label` the human name. NOT
 * tenant-owned by default (the library is KB-central, CONTEXT) — a template made
 * available to a single resto carries that resto's `tenantId`, else absent.
 */
export const notificationTemplates = defineTable({
  key: v.string(), // stable library key (e.g. "promo_weekend")
  label: v.string(), // human-facing name
  body: v.string(), // text with {variables}
  variables: v.array(templateVariable), // declared interpolable variables (closed set)
  deepLinkTarget: templateDeepLinkTarget,
  scope: templateScope,
  // Declarative bounds (ADR 0006 / PRD 80 §4). `maxDiscountPercent` ≤ 50 and the
  // body length < 200 are ENFORCED by `findTemplateBoundViolation` at write time
  // (slice B); stored here so the bound travels with the row.
  maxDiscountPercent: v.number(),
  language: templateLanguage, // "fr" only V1
  containsAlcohol: v.boolean(), // must be false for a valid template (no alcohol)
  active: v.boolean(),
  // A template scoped to a single resto carries its tenantId; KB-central library
  // entries (available to all) leave it absent (the library is cross-tenant).
  tenantId: v.optional(v.id("tenants")),
  createdAt: v.number(),
})
  // A resto's own (single-tenant) templates — the only tenant-scoped access path.
  .index("by_tenant", ["tenantId"])
  // Library lookup by stable key.
  .index("by_key", ["key"]);

// ── notificationEvents ────────────────────────────────────────────────────────

/** Transactional vs marketing-campaign send (PRD 80 §1 / §2). */
export const notificationKind = v.union(
  v.literal("transactional"),
  v.literal("campaign"),
);

/**
 * The 8 V1 transactional triggers (PRD 80 §1 matrix). Closed taxonomy — NOT
 * invented: each maps 1:1 to a documented trigger row (1 cmd payée, 2 reçue
 * cuisine, 3 courier pickup, 4 courier dropoff, 5 livrée, 6 refund, 7 course Uber
 * refusée, 8 pickup ready C&C).
 */
export const transactionalTrigger = v.union(
  v.literal("order_paid"), // 1 — Stripe payment_intent.succeeded
  v.literal("order_received_kitchen"), // 2 — resto accepte
  v.literal("courier_pickup"), // 3 — Uber pickup_complete
  v.literal("courier_dropoff"), // 4 — Uber dropoff
  v.literal("order_delivered"), // 5 — Uber delivered
  v.literal("refund_issued"), // 6 — KB backend
  v.literal("uber_course_failed"), // 7 — Uber failed (re-quote)
  v.literal("pickup_ready_click_collect"), // 8 — C&C ready
);

/**
 * The 3 transactional categories driving the hardcoded V1 channel routing (PRD 80
 * §1 / notifications CONTEXT "Catégorie transactionnelle"). Closed set.
 */
export const transactionalCategory = v.union(
  v.literal("archive"), // multi-canal + email (trace écrite)
  v.literal("temps_reel"), // Wallet + Web Push (info périme vite)
  v.literal("info_statut"), // Wallet update silencieux uniquement
);

/**
 * The effective channel a single send went out on (PRD 80 §3 canaux V1). Closed
 * set: web push (PWA), Wallet push, the silent Wallet update, email, SMS extreme
 * fallback. The cascade picks ONE effective channel per client (CONTEXT).
 */
export const notificationChannel = v.union(
  v.literal("web_push"),
  v.literal("wallet_push"),
  v.literal("wallet_silent"),
  v.literal("email"),
  v.literal("sms"),
);

/**
 * Send status (PRD 80 §7 garde-fous techniques). `queued` covers the DNT shift
 * (campagne lancée pendant 22h-8h → envoi à 8h). `inactive_endpoint` is the 410
 * Gone / expired-subscription marker. Closed V1 set.
 */
export const notificationStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("failed"),
  v.literal("inactive_endpoint"),
);

export type NotificationKind = Infer<typeof notificationKind>;
export type TransactionalTrigger = Infer<typeof transactionalTrigger>;
export type TransactionalCategory = Infer<typeof transactionalCategory>;
export type NotificationChannel = Infer<typeof notificationChannel>;
export type NotificationStatus = Infer<typeof notificationStatus>;

/**
 * The send journal (PRD 80 §1/§2): one row per delivered/attempted notification.
 * Carries `tenantId` (ADR 0010) + `customerId` BY ID ONLY (no nominative copy,
 * the MOAT). A transactional row carries its `transactionalTrigger` +
 * `transactionalCategory`; a campaign row carries its `campaignScope` + optional
 * `templateId` (a tenant campaign references a pre-validated template, ADR 0006;
 * a cross-tenant KB campaign may have free content, hence the template is
 * optional). NO reachability is copied here — it stays in 2.1 (ADR 0012).
 */
export const notificationEvents = defineTable({
  tenantId: v.id("tenants"),
  customerId: v.id("customers"), // referenced by id only (MOAT, ADR 0010/0012)
  kind: notificationKind,
  // Present for kind = "transactional".
  transactionalTrigger: v.optional(transactionalTrigger),
  transactionalCategory: v.optional(transactionalCategory),
  // Present for kind = "campaign". `templateId` optional: cross-tenant KB content
  // may be free (ADR 0006), so a campaign row need not reference a template.
  campaignScope: v.optional(templateScope),
  templateId: v.optional(v.id("notificationTemplates")),
  channel: notificationChannel, // the effective channel of the cascade
  status: notificationStatus,
  createdAt: v.number(),
  sentAt: v.optional(v.number()),
})
  .index("by_tenant", ["tenantId"])
  .index("by_customer", ["customerId"])
  // A tenant's events for one customer (re-engagement history, rate-limit reads).
  .index("by_tenant_customer", ["tenantId", "customerId"]);
