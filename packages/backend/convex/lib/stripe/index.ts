/**
 * Public API of the `stripe` backend module (chantier 2.5 — Payment via Stripe
 * Connect Express, PRD 30, payment CONTEXT).
 *
 * 2.5-A — Onboarding socle: stamp the resto's Stripe Connect Express account on
 * its tenant, generate a PRE-FILLED `account_link` from KB Admin (root), and
 * reflect the account state from the `account.updated` webhook onto
 * `tenants.stripeStatus` (`pending` / `ready` / `disabled`).
 *
 * Isolation (ADR 0010 / 0011): the root surface goes through `kbAdminQuery` /
 * `kbAdminMutation` (root-only, auto-audited); the webhook is system-side and
 * resolves its tenant ONLY by the Stripe-supplied `acct_xxx` through the
 * sanctioned `lib/tenancy` seam — never raw `ctx.db` in this module
 * (`no-untenanted-query`). The Stripe API calls + HMAC verification live in
 * `action`s / the `httpAction` (the `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
 * env vars are KB-wide, NOT per-tenant ⇒ no envelope encryption here). DB writes
 * are ordered AFTER the Stripe calls, in mutations (action↔mutation split, STACK
 * §2.3). The webhook update is wrapped in `withIdempotence(ctx, "stripe", …)`.
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.stripe.account.*` / `internal.lib.stripe.webhook.*`; the guarded
 * query/mutation/action functions are therefore NOT re-exported here (a barrel
 * re-export would not change their callable address). Surfaced here: the PURE
 * helpers (status mapping + signature verification, testable in isolation), the
 * shared types, and the `stripeWebhook` httpAction (imported by `http.ts`).
 *
 *  - `mapStripeAccountToStatus` / `StripeAccountSnapshot` — pure account→status
 *    map (a rejected KYC never → `ready`).
 *  - `verifyStripeSignature` / `parseStripeSignatureHeader` — pure HMAC verify on
 *    the raw webhook body.
 *  - `AccountUpdatedOutcome` — the idempotent webhook mutation's return shape.
 *  - `stripeWebhook` — the verified `account.updated` httpAction (for `http.ts`).
 */
export { type StripeAccountSnapshot, mapStripeAccountToStatus } from "./status";
export { parseStripeSignatureHeader, verifyStripeSignature } from "./signature";
export { type AccountUpdatedOutcome } from "./webhook";
export { stripeWebhook } from "./webhookHandler";
