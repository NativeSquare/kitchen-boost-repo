import { internal } from "../../_generated/api";
import { httpAction } from "../../_generated/server";
import { verifyStripeSignature } from "./signature";

/**
 * 2.5-A + 2.5-B — the Stripe webhook `httpAction` (PRD 30 §1/§3/§4, payment
 * CONTEXT, STACK §2.3/§2.7). Routed at `/stripe-webhook` in `convex/http.ts`.
 * POC #1 ✅: verify the HMAC on the RAW body (`await request.text()` BEFORE any
 * parse), default Convex runtime (no `"use node"`), `crypto.subtle`.
 *
 * Flow:
 *  1. read the raw body, verify the `Stripe-Signature` HMAC with
 *     `STRIPE_WEBHOOK_SECRET`. Bad / missing signature → 400 (never parse first).
 *  2. parse the event and route by `type`:
 *     - `account.updated` (2.5-A) → idempotent tenant status update + Slack alert;
 *     - `payment_intent.succeeded` (2.5-B) → DISPATCH `confirmPaymentSucceeded`
 *       via `ctx.scheduler.runAfter(0, …)` (confirm the order + seed the course);
 *     - `payment_intent.payment_failed` (2.5-B) → DISPATCH `recordPaymentFailed`
 *       (3 retries max then abandon);
 *     - `charge.refunded` (2.5-C) → DISPATCH `applyChargeRefunded` (reconcile a
 *       refund made outside KB — e.g. the resto's Stripe Dashboard — to the local
 *       `payments` row, idempotently via `withIdempotence`);
 *     - anything else → 200, acknowledged + ignored.
 *  3. exactly-once is enforced inside each internal mutation via
 *     `withIdempotence(ctx, "stripe", eventId, …)` (Stripe at-least-once).
 *  4. always answer 200 on a verified event so Stripe stops retrying.
 *
 * The `payment_intent.*` events are direct-charge CONNECT events of the connected
 * account (`event.account = acct_resto`); the tenant is resolved downstream from
 * the Stripe-supplied `paymentIntentId` (the `payments` row carries `tenantId`),
 * so no user-supplied tenant id is ever trusted (ADR 0010).
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

  const eventId = typeof event.id === "string" ? event.id : null;

  // 2.5-B — direct-charge payment lifecycle. The event's data object is the
  // PaymentIntent; resolve its id (the only handle besides the connected account)
  // and DISPATCH to the idempotent internal mutation (no actor, system side). The
  // tenant is resolved downstream from the paymentIntentId (ADR 0010).
  if (
    event.type === "payment_intent.succeeded" ||
    event.type === "payment_intent.payment_failed"
  ) {
    const pi = event.data?.object ?? {};
    const paymentIntentId = typeof pi.id === "string" ? pi.id : null;
    if (eventId === null || paymentIntentId === null) {
      return new Response("Malformed event", { status: 400 });
    }
    if (event.type === "payment_intent.succeeded") {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.stripe.payment.confirmPaymentSucceeded,
        { eventId, paymentIntentId },
      );
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.stripe.payment.recordPaymentFailed,
        { eventId, paymentIntentId },
      );
    }
    return new Response(null, { status: 200 });
  }

  // 2.5-C — a refund settled (resto's Stripe Dashboard, or KB's own refund webhook
  // echo). The event's data object is the Charge; resolve its PaymentIntent + the
  // latest refund id and DISPATCH the idempotent reconciliation. The tenant is
  // resolved downstream from the paymentIntentId (ADR 0010).
  if (event.type === "charge.refunded") {
    const charge = event.data?.object ?? {};
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : null;
    const refunds = (charge.refunds as { data?: unknown[] } | undefined)?.data;
    const latest =
      Array.isArray(refunds) && refunds.length > 0
        ? (refunds[refunds.length - 1] as { id?: unknown })
        : undefined;
    const refundId = typeof latest?.id === "string" ? latest.id : null;
    if (eventId === null || paymentIntentId === null || refundId === null) {
      return new Response("Malformed event", { status: 400 });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.lib.stripe.refund.applyChargeRefunded,
      { eventId, paymentIntentId, refundId },
    );
    return new Response(null, { status: 200 });
  }

  if (event.type !== "account.updated") {
    // Acknowledged but not handled by this slice.
    return new Response(null, { status: 200 });
  }

  const account = event.data?.object ?? {};
  const accountId = typeof account.id === "string" ? account.id : null;
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
