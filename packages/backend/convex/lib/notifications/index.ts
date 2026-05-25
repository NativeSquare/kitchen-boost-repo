/**
 * Public API of the `notifications` backend module (chantier 2.7 — Notifications,
 * moteur transactionnel + marketing, PRD 80).
 *
 * 2.7-A — SCHEMA LAYER ONLY. No business query/mutation is exposed yet; this
 * slice lays the `notificationTemplates` + `notificationEvents` tables (in
 * `convex/table/notifications.ts`, registered through `schema.ts`) and the
 * DECLARATIVE template bounds shared with their validators. The tenant-scoped
 * send/campaign functions (via the tenancy wrappers, never raw `ctx.db` — ADR
 * 0010 — each shipping a cross-tenant fuzz suite) land in the later 2.7 slices.
 *
 * The push joignabilité (Wallet serial / web-push id / per-channel status) is NOT
 * here: it lives in 2.1 `customers.pushEnrollment` (ADR 0012). 2.7 only sends.
 *
 *  - `findTemplateBoundViolation` + the bound constants — the pure, declarative
 *    guardrails of a pre-validated campaign template (ADR 0006 / PRD 80 §4):
 *    `{discount}` ≤ 50 %, rendered length < 200 chars, French only, no alcohol,
 *    only known interpolable variables. The single source of truth shared by the
 *    schema validators and the later (slice B) send-time enforcement.
 */
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
