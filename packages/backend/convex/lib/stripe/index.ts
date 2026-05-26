/**
 * Public API of the `stripe` backend module (chantier 2.5 — Payment via Stripe
 * Connect Express, PRD 30, payment CONTEXT).
 *
 * 2.5-A — Onboarding socle: stamp the resto's Stripe Connect Express account on
 * its tenant, generate a PRE-FILLED `account_link` from KB Admin (root), and
 * reflect the account state from the `account.updated` webhook onto
 * `tenants.stripeStatus` (`pending` / `ready` / `disabled`).
 *
 * 2.5-B — Payment core (direct charge): `createPaymentIntent` creates a direct-
 * charge PaymentIntent ON THE RESTO'S CONNECTED ACCOUNT (header
 * `Stripe-Account: acct_resto`) with the IMMUTABLE `application_fee_amount = 240`
 * cts TTC (Q30-Q1) and `automatic_payment_methods` (Apple/Google Pay), charging
 * the total RECEIVED from Pricing (#20) verbatim — no `on_behalf_of` (direct
 * charge). The `payment_intent.succeeded` webhook CONFIRMS the order (#18) and
 * SEEDS the delivery course (#24/#48); `payment_intent.payment_failed` records the
 * attempt (3 max then abandon). The local source of truth is the tenant-scoped
 * `payments` table (one row per order, indexed by order + by `paymentIntentId`).
 *
 * Isolation (ADR 0010 / 0011): the root surface goes through `kbAdminQuery` /
 * `kbAdminMutation` (root-only, auto-audited); `createPaymentIntent` is customer-
 * scoped (scope self — the client pays only its OWN order); the webhooks are
 * system-side and resolve their tenant ONLY by the Stripe-supplied `acct_xxx` /
 * `paymentIntentId` through the sanctioned `lib/tenancy` seam — never raw
 * `ctx.db` in this module (`no-untenanted-query`). The Stripe API calls + HMAC
 * verification live in `action`s / the `httpAction` (the `STRIPE_SECRET_KEY` /
 * `STRIPE_WEBHOOK_SECRET` env vars are KB-wide, NOT per-tenant ⇒ no envelope
 * encryption here). DB writes are ordered AFTER the Stripe calls, in mutations
 * (action↔mutation split, STACK §2.3). Every webhook side effect is wrapped in
 * `withIdempotence(ctx, "stripe", …)`.
 *
 * 2.5-D — saved card reusable cross-resto (`savedCard.ts`, PRD 30, payment CONTEXT
 * "Stripe Customer (cross-tenant)" / "Sauvegarde carte", POC #6). The Stripe
 * `Customer` (`cus_…`) lives at the KB PLATFORM account level (NOT tenant), so it is
 * stored on the GLOBAL `customers` MOAT fiche (no `tenantId`) with the saved
 * PaymentMethod (`pm_…`). Two CUSTOMER-scoped actions (scope self — the client only
 * operates on its OWN fiche / OWN order, ADR 0010):
 *   - `saveCard` — create-or-reuse the platform Customer + attach the front-collected
 *     PaymentMethod (Stripe SetupIntent is front, hors scope) + stamp `cus_`/`pm_` on
 *     the caller's OWN fiche.
 *   - `payWithSavedCard` — CLONE the platform PaymentMethod to the resto's connected
 *     account (`paymentMethods.create({ customer, payment_method }, { stripeAccount }`,
 *     POC #6), then a confirmed direct charge on that account with the cloned card +
 *     the immutable fee 240 (Q30-Q1, no `on_behalf_of`); the original platform PM
 *     stays intact (re-clonable to resto Y); persists the `payments` row (2.5-B
 *     contract). The customer-scoped guard `assertOwnSavedCardOrder` (the cross-tenant
 *     fuzz target) refuses a non-owner / cross-tenant / not-ready / card-less caller
 *     before any Stripe call. These guarded query/mutation/action functions are
 *     registered by module path — not re-exported here.
 *
 * 2.5-C/D — Refund (`refund.ts`). The payment-domain MECHANISM behind a TOTAL,
 * IMMEDIATE refund (PRD 30 §5, payment CONTEXT "Refund"/"Cmd avortée"). Two trigger
 * paths, both ending in a Stripe `POST /refunds` on the resto's CONNECTED account
 * (a direct charge is refunded where it lives), flipping the `payments` row to
 * `refunded` (+ `refundId`), audited (system-side, `actorRole: "system"`):
 *   - `refundOnRefusal` — scheduled by the Orders [[Refusal]] (#18): Orders is the
 *     trigger (it already transitioned the order + queued the notif), Payment runs
 *     the Stripe refund. KB does NOT refund its commission (Article 3.3).
 *   - `refundAbortedOrder` — scheduled by the delivery course-failure (#48 Cas A,
 *     [[Cmd avortée]]): full auto-refund + the order is pulled OUT of KB Orders
 *     (`nouvelle → refusée`, never transmitted to the resto) + client `refund_issued`
 *     push.
 *   - `applyChargeRefunded` — the `charge.refunded` webhook reconciliation (a refund
 *     made outside KB), idempotent via `withIdempotence` so a redelivered event marks
 *     the row at most once (no double refund).
 * Both actions are idempotent: a `payments` row already `refunded` skips the Stripe
 * call. These are INTERNAL (system-side, no actor) — registered by module path, not
 * re-exported here.
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.stripe.account.*` / `api.lib.stripe.paymentIntent.*` /
 * `internal.lib.stripe.{webhook,payment}.*`; the guarded query/mutation/action
 * functions are therefore NOT re-exported here (a barrel re-export would not
 * change their callable address). Surfaced here: the PURE helpers (status mapping
 * + signature verification + the immutable fee constants, testable in isolation),
 * the shared types, and the `stripeWebhook` httpAction (imported by `http.ts`).
 *
 *  - `APPLICATION_FEE_AMOUNT_TTC` / `APPLICATION_FEE_AMOUNT_HT` — the immutable KB
 *    commission (240 cts TTC sent to Stripe / 200 cts HT stored for reporting).
 *  - `mapStripeAccountToStatus` / `StripeAccountSnapshot` — pure account→status
 *    map (a rejected KYC never → `ready`).
 *  - `verifyStripeSignature` / `parseStripeSignatureHeader` — pure HMAC verify on
 *    the raw webhook body.
 *  - `AccountUpdatedOutcome` — the idempotent `account.updated` mutation's return.
 *  - `PaymentStatus` — the local payment lifecycle union (`payments.status`).
 *  - `stripeWebhook` — the verified webhook httpAction (for `http.ts`).
 */
export { APPLICATION_FEE_AMOUNT_HT, APPLICATION_FEE_AMOUNT_TTC } from "./fees";
export { type StripeAccountSnapshot, mapStripeAccountToStatus } from "./status";
export { parseStripeSignatureHeader, verifyStripeSignature } from "./signature";
export { type AccountUpdatedOutcome } from "./webhook";
export { type PaymentStatus } from "../../table/payments";
export { stripeWebhook } from "./webhookHandler";
