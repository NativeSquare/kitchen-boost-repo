import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { uberWebhook } from "./lib/delivery/webhooks";
import { resend } from "./emails";
import { stripeWebhook } from "./lib/stripe";

const http = httpRouter();

// Auth routes
auth.addHttpRoutes(http);

// 2.5-A — Stripe Connect webhook (PRD 30 §1, payment CONTEXT). Verifies the HMAC
// on the raw body (POC #1, default Convex runtime) then applies `account.updated`
// idempotently. Point the Stripe dashboard webhook at:
//   https://<deployment>.convex.site/stripe-webhook
// Enable `account.updated` and set STRIPE_WEBHOOK_SECRET (`whsec_…`).
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: stripeWebhook,
});

// Resend webhook for email delivery tracking
// Set up webhook in Resend dashboard pointing to:
// https://<your-deployment>.convex.site/resend-webhook
// Enable all email.* events and set RESEND_WEBHOOK_SECRET env var
http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await resend.handleResendEventWebhook(ctx, req);
  }),
});

// 2.6-C — per-tenant Uber Direct delivery-status webhook (PRD 40 §1/§4, delivery
// CONTEXT). V1 self-signup ⇒ one Uber account + one webhook URL PER tenant. Convex
// `httpRouter` has no named path params (POC #5 ✅), so we use a `pathPrefix` and
// parse the `<tenantId>` off the end of the path; the handler then resolves the
// tenant, verifies the `x-uber-signature` HMAC on the RAW body (POC #1) and applies
// the event idempotently. Configure each resto's Uber dashboard webhook at:
//   https://<deployment>.convex.site/webhooks/uber/<tenantId>
http.route({
  pathPrefix: "/webhooks/uber/",
  method: "POST",
  handler: uberWebhook,
});

export default http;
