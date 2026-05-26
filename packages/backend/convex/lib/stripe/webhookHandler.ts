import { internal } from "../../_generated/api";
import { httpAction } from "../../_generated/server";
import { verifyStripeSignature } from "./signature";

/**
 * 2.5-A — the Stripe webhook `httpAction` (PRD 30 §1, payment CONTEXT, STACK
 * §2.3). Routed at `/stripe-webhook` in `convex/http.ts`. POC #1 ✅: verify the
 * HMAC on the RAW body (`await request.text()` BEFORE any parse), default Convex
 * runtime (no `"use node"`), `crypto.subtle`.
 *
 * Flow:
 *  1. read the raw body, verify the `Stripe-Signature` HMAC with
 *     `STRIPE_WEBHOOK_SECRET`. Bad / missing signature → 400 (never parse first).
 *  2. parse the event; only `account.updated` is handled (other types → 200,
 *     acknowledged + ignored).
 *  3. apply via the idempotent internal mutation (exactly-once per
 *     `(stripe, eventId)`), which maps the account to `pending`/`ready`/`disabled`
 *     (a rejected KYC never → `ready`) and writes the tenant.
 *  4. if the freshly-applied status is `pending` (KYC still pending), post ONE
 *     Slack ops alert (network call → in this action, not the mutation). A
 *     duplicate delivery applies nothing, so it never re-alerts.
 *  5. always answer 200 on a verified event so Stripe stops retrying.
 */
export const stripeWebhook = httpAction(async (ctx, request) => {
  // 1. RAW body first (POC #1) — never parse before verifying the signature.
  const rawBody = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfiguration — refuse rather than silently accept unverified events.
    return new Response("Webhook secret not configured", { status: 500 });
  }
  const ok = await verifyStripeSignature({
    rawBody,
    header: request.headers.get("Stripe-Signature"),
    secret,
  });
  if (!ok) return new Response("Invalid signature", { status: 400 });

  // 2. Safe to parse now.
  let event: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.type !== "account.updated") {
    // Acknowledged but not handled by this slice.
    return new Response(null, { status: 200 });
  }

  const account = event.data?.object ?? {};
  const accountId = typeof account.id === "string" ? account.id : null;
  const eventId = typeof event.id === "string" ? event.id : null;
  if (eventId === null || accountId === null) {
    return new Response("Malformed event", { status: 400 });
  }

  // 3. Idempotent status update (exactly once per (stripe, eventId)).
  const outcome = await ctx.runMutation(
    internal.lib.stripe.webhook.applyAccountUpdated,
    {
      eventId,
      accountId,
      account: {
        charges_enabled:
          typeof account.charges_enabled === "boolean"
            ? account.charges_enabled
            : undefined,
        payouts_enabled:
          typeof account.payouts_enabled === "boolean"
            ? account.payouts_enabled
            : undefined,
        requirements:
          account.requirements && typeof account.requirements === "object"
            ? {
                disabled_reason:
                  (account.requirements as { disabled_reason?: unknown })
                    .disabled_reason === undefined
                    ? undefined
                    : (((account.requirements as { disabled_reason?: unknown })
                        .disabled_reason as string | null) ?? null),
              }
            : undefined,
      },
    },
  );

  // 4. KYC still pending at the end of the kickoff → alert ops (once; a duplicate
  //    delivery has applied === false so it never re-alerts).
  if (outcome.applied && outcome.status === "pending") {
    const webhookUrl = process.env.SLACK_OPS_WEBHOOK_URL;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:hourglass: Stripe KYC en attente (account.updated → pending) — tenant \`${outcome.tenantId}\` (compte \`${accountId}\`). À suivre dans le pipeline onboarding.`,
        }),
      });
    } else {
      console.warn(
        `[stripe] account.updated → pending for tenant ${outcome.tenantId} but SLACK_OPS_WEBHOOK_URL is unset`,
      );
    }
  }

  // 5. Acknowledge so Stripe stops retrying.
  return new Response(null, { status: 200 });
});
