import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { resend } from "./emails";

const http = httpRouter();

// Auth routes
auth.addHttpRoutes(http);

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
