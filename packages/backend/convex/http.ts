import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { uberWebhook } from "./lib/delivery/webhooks";
import { resend } from "./emails";
import { stripeWebhook } from "./lib/stripe";
import {
  walletPassDownload,
  walletRegistrationWebhook,
} from "./lib/wallet/webService";

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

// 2.8-B — Apple Wallet Web Service device registration over the HMAC-signed
// internal channel (PRD 80, ADR 0003, STACK §2.3/§5.4, US 23). Apple's servers
// call the device-facing Node routes (`apps/admin/api/wallet/*`); after parsing
// the `Authorization: ApplePass …` header + URL params, those routes FORWARD the
// register/unregister to this endpoint signed with `WALLET_INTERNAL_HMAC_SECRET`
// (x-kb-timestamp / x-kb-signature). The handler verifies the channel HMAC on the
// RAW body, then dispatches to registerDevice / unregisterDevice (which re-verify
// the per-pass PassKit token). Only authenticated KB traffic mutates the registry.
http.route({
  path: "/wallet/registrations",
  method: "POST",
  handler: walletRegistrationWebhook,
});

// 2.8-B — Apple Wallet Web Service pass DOWNLOAD over the HMAC-signed internal
// channel (US 9). The device-facing Node route (`apps/admin/api/wallet/pass/
// [serial]`) verifies the PassKit token, then forwards the serial here signed with
// `WALLET_INTERNAL_HMAC_SECRET`; this endpoint re-builds + signs the latest
// `.pkpass` through slice A's `"use node"` seam and returns the base64 bytes the
// route streams as `application/vnd.apple.pkpass`.
http.route({
  path: "/wallet/pass",
  method: "POST",
  handler: walletPassDownload,
});

export default http;
