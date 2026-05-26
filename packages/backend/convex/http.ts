import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
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

export default http;
