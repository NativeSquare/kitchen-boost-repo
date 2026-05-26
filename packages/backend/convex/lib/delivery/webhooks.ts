import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { mapWebhookEvent } from "../uberDirect/webhookEvents";
import {
  getTenantById,
  getTenantDeliveryByUberId,
  patchTenantDelivery,
} from "../tenancy";
import { withIdempotence } from "../webhooks";
import {
  type IncidentPush,
  incidentRefundPolicy,
  resolveCourierDrift,
} from "./incidents";

/**
 * 2.6-C — the per-tenant Uber Direct webhook (`…/webhooks/uber/<tenantId>`, PRD
 * 40 §1/§4, delivery CONTEXT "Webhook tenant", POC #1 + POC #5).
 *
 * In V1 each resto has its OWN Uber Direct account (self-signup), so each tenant
 * has its OWN webhook URL. The Convex `httpRouter` has no named path params (POC
 * #5 ✅), so the route is registered with `pathPrefix: "/webhooks/uber/"` in
 * `http.ts` and the `tenantId` is parsed from the END of the path. The handler:
 *  1. reads the RAW body FIRST (`await req.text()`), never parsing before the
 *     signature check (POC #1 — a `JSON.parse`→`stringify` would break the HMAC);
 *  2. resolves the tenant from the path; an unknown tenant ⇒ 404;
 *  3. decrypts THAT tenant's `webhookSigningKey` (ACTION-ONLY — the httpAction is
 *     an action; the tenantId is STRUCTURAL, from the validated URL, never a
 *     forgeable arg) and verifies the `x-uber-signature` HMAC-SHA256 on the raw
 *     body (research §1.3). A bad / missing signature ⇒ 400 (no parse, no write);
 *  4. parses the event and applies it `withIdempotence(ctx, "uber_direct",
 *     eventId, …)` (foundation 1.x-F) so a redelivered `(uber_direct, eventId)`
 *     runs exactly once (Uber delivers at-least-once, retries up to 3×);
 *  5. answers 200 fast (Uber retries aggressively past 5s, research §1.3).
 *
 * Isolation (ADR 0010): the apply mutation resolves the delivery by its
 * `uberDeliveryId` and RE-CHECKS it against the routed `tenantId`
 * (`getTenantDeliveryByUberId`), so an event delivered to one tenant's webhook can
 * NEVER patch another tenant's delivery — the routed tenant is the boundary. All
 * persistence goes through the sanctioned `lib/tenancy` seam; this module reaches
 * the secret blob only through the exempt `lib/crypto` seam (decrypt in-action).
 */

const PROVIDER = "uber_direct";

/** Hex-encode bytes. */
function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish equality over two same-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA256(key, rawBody) as lowercase hex — Uber signs the RAW body with the
 * tenant's webhook signing key (research §1.3, `x-uber-signature`). Web Crypto
 * `crypto.subtle`, default Convex runtime (POC #1). Exported for the unit test.
 */
export async function uberSignatureHex(
  key: string,
  rawBody: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(rawBody),
  );
  return toHex(sig);
}

/** Verify the `x-uber-signature` header against the raw body. */
export function verifyUberSignature(
  expectedHex: string,
  header: string | null,
): boolean {
  if (header === null || header === "") return false;
  return timingSafeEqualHex(header.trim().toLowerCase(), expectedHex);
}

/** Whether a tenant id resolves to an existing tenant (path validation, 404). */
export const tenantExists = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<boolean> =>
    (await getTenantById(ctx, args.tenantId)) !== null,
});

/** The raw webhook event payload, parsed but unshaped. */
const webhookEventArg = v.object({
  kind: v.optional(v.string()),
  delivery_id: v.optional(v.string()),
  status: v.optional(v.string()),
  data: v.optional(v.any()),
});

/**
 * Apply ONE verified Uber webhook event to the routed tenant's delivery, exactly
 * once per `(uber_direct, eventId)`, AND drive the 2.6-D incident STATE MACHINE on
 * the result (delivery CONTEXT Q40-Q6→Q40-Q14). Resolves the delivery by
 * `uberDeliveryId` RE-CHECKED against `tenantId` (a foreign delivery is
 * unreachable ⇒ no-op), maps the event through the pure `mapWebhookEvent`, patches
 * the row (status / courier / ETA / incident), and then ACTS per the acted policy:
 *
 *  - Cas C `incident_after_pickup` (canceled/failed) ⇒ auto-refund TOTAL VIA 2.5
 *    (`refundAbortedOrder` scheduled — 2.6 NEVER refunds itself; that pulls the
 *    order out of KB Orders + pushes the client + audits). KB opens NO Uber/resto
 *    reclamation (Article 2 contrat).
 *  - Cas D `customer_absent` (returned) ⇒ NO auto-refund; flags
 *    `manualRefundAvailable` on the row (the resto's discretionary button) and
 *    signals the customer-absent push.
 *  - Cas B `courier_update` (silent re-dispatch) ⇒ passive relay of the new
 *    courier; accumulate the ETA drift (`resolveCourierDrift`) and signal the
 *    "petit retard ⏰" push ONLY on crossing the 10-min cumulative threshold. No
 *    refund, no incident.
 *  - Cas A `refused_post_payment` is NOT a webhook status — it is the Create
 *    Delivery refusal in `createCourseOnPaymentConfirmed`.
 *
 * The notification trigger (2.7, closed taxonomy) + the KDS signal come from the
 * mapping; the customer-absent / petit-retard / incident pushes are NOT closed
 * triggers (ADR 0006) — they are SIGNALS returned for the Phase 3 fronts.
 *
 * INTERNAL + SYSTEM-SIDE: called only from the verified webhook httpAction. The
 * `tenantId` is the structural routed tenant, so a cross-tenant write is
 * impossible. `applied` is false on a duplicate OR an unowned/unknown delivery.
 */
export const applyUberWebhookEvent = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    eventId: v.string(),
    event: webhookEventArg,
  },
  returns: v.object({
    applied: v.boolean(),
    notificationTrigger: v.optional(v.string()),
    kdsSignal: v.optional(v.string()),
    // 2.6-D signals (for the Phase 3 fronts; not closed transactional triggers).
    incidentPush: v.optional(v.string()),
    autoRefundTriggered: v.optional(v.boolean()),
    manualRefundAvailable: v.optional(v.boolean()),
    petitRetard: v.optional(v.boolean()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    applied: boolean;
    notificationTrigger?: string;
    kdsSignal?: string;
    incidentPush?: IncidentPush;
    autoRefundTriggered?: boolean;
    manualRefundAvailable?: boolean;
    petitRetard?: boolean;
  }> => {
    let applied = false;
    let notificationTrigger: string | undefined;
    let kdsSignal: string | undefined;
    let incidentPush: IncidentPush | undefined;
    let autoRefundTriggered: boolean | undefined;
    let manualRefundAvailable: boolean | undefined;
    let petitRetard: boolean | undefined;

    await withIdempotence(ctx, PROVIDER, args.eventId, async () => {
      const transition = mapWebhookEvent(args.event as Record<string, unknown>);
      if (transition === null) return; // irrelevant event → marked processed, no-op

      // Resolve the delivery scoped to the ROUTED tenant — a foreign / unknown
      // uberDeliveryId is unreachable (ADR 0010), so the event is a clean no-op.
      const delivery = await getTenantDeliveryByUberId(
        ctx,
        args.tenantId,
        transition.uberDeliveryId,
      );
      if (delivery === null) return;

      // Cas B — accumulate the ETA drift of a silent re-dispatch (courier_update
      // carries no status). The petit-retard push fires only on the > 10-min
      // crossing; the cumulative slip is persisted for the next update.
      let cumulativeEtaDriftMs: number | undefined;
      if (transition.status === undefined) {
        const drift = resolveCourierDrift(delivery, {
          pickupEta: transition.pickupEta,
          dropoffEta: transition.dropoffEta,
        });
        cumulativeEtaDriftMs = drift.cumulativeEtaDriftMs;
        if (drift.petitRetard) petitRetard = true;
      }

      // Cas C/D — the single acted incident policy lookup (auto-refund vs the
      // manual button, plus the dedicated client push).
      const policy =
        transition.incidentType !== undefined
          ? incidentRefundPolicy(transition.incidentType)
          : undefined;
      const manualRefundFlag = policy?.manualRefundAvailable ? true : undefined;
      if (policy !== undefined) incidentPush = policy.incidentPush;

      await patchTenantDelivery(ctx, args.tenantId, delivery._id, {
        ...(transition.status !== undefined
          ? { status: transition.status }
          : {}),
        ...(transition.courierName !== undefined
          ? { courierName: transition.courierName }
          : {}),
        ...(transition.courierPhone !== undefined
          ? { courierPhone: transition.courierPhone }
          : {}),
        ...(transition.pickupEta !== undefined
          ? { pickupEta: transition.pickupEta }
          : {}),
        ...(transition.dropoffEta !== undefined
          ? { dropoffEta: transition.dropoffEta }
          : {}),
        ...(transition.incidentType !== undefined
          ? { incidentType: transition.incidentType }
          : {}),
        ...(cumulativeEtaDriftMs !== undefined ? { cumulativeEtaDriftMs } : {}),
        ...(manualRefundFlag !== undefined
          ? { manualRefundAvailable: manualRefundFlag }
          : {}),
      });

      // Cas C — the auto-refund is EXECUTED by 2.5 (#49). Scheduled so the Stripe
      // call runs in the payment domain's action after this mutation commits;
      // inside `withIdempotence`, so a redelivered event never double-schedules.
      if (policy?.autoRefund) {
        await ctx.scheduler.runAfter(
          0,
          internal.lib.stripe.refund.refundAbortedOrder,
          {
            tenantId: args.tenantId,
            orderId: delivery.orderId as Id<"orders">,
          },
        );
        autoRefundTriggered = true;
      }

      applied = true;
      notificationTrigger = transition.notificationTrigger;
      kdsSignal = transition.kdsSignal;
      if (manualRefundFlag) manualRefundAvailable = true;
    });

    return {
      applied,
      ...(notificationTrigger !== undefined ? { notificationTrigger } : {}),
      ...(kdsSignal !== undefined ? { kdsSignal } : {}),
      ...(incidentPush !== undefined ? { incidentPush } : {}),
      ...(autoRefundTriggered !== undefined ? { autoRefundTriggered } : {}),
      ...(manualRefundAvailable !== undefined ? { manualRefundAvailable } : {}),
      ...(petitRetard !== undefined ? { petitRetard } : {}),
    };
  },
});

/** Parse the structural `tenantId` from the END of `/webhooks/uber/<tenantId>`. */
function tenantIdFromPath(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
}

export const uberWebhook = httpAction(async (ctx, request) => {
  // 1. RAW body FIRST (POC #1) — never parse before verifying the signature.
  const rawBody = await request.text();

  // 2. Resolve the tenant from the path (POC #5 pathPrefix). A malformed or
  //    unknown tenant id ⇒ 404 before any work.
  const tenantParam = tenantIdFromPath(request.url);
  let tenantId: Id<"tenants">;
  try {
    tenantId = tenantParam as Id<"tenants">;
    const exists = await ctx.runQuery(
      internal.lib.delivery.webhooks.tenantExists,
      { tenantId },
    );
    if (!exists) return new Response("Unknown tenant", { status: 404 });
  } catch {
    return new Response("Unknown tenant", { status: 404 });
  }

  // 3. Decrypt THIS tenant's webhook signing key (action-only, MOAT — via the
  //    2.6-A system decrypt) and verify the x-uber-signature HMAC on the raw
  //    body. Missing creds ⇒ 404, missing signing key ⇒ 500, bad sig ⇒ 400.
  let signingKey: string;
  try {
    const creds = await ctx.runAction(
      internal.lib.uberDirect.credentials.getDecryptedUberCredentialsSystem,
      { tenantId },
    );
    signingKey = creds.webhookSigningKey ?? "";
  } catch {
    // No credentials stored for this tenant ⇒ treat as an unknown webhook target.
    return new Response("Unknown tenant", { status: 404 });
  }
  if (signingKey === "") return new Response("Misconfigured", { status: 500 });

  const expected = await uberSignatureHex(signingKey, rawBody);
  if (!verifyUberSignature(expected, request.headers.get("x-uber-signature"))) {
    return new Response("Invalid signature", { status: 400 });
  }

  // 4. Safe to parse now.
  let event: {
    event_id?: string;
    id?: string;
    kind?: string;
    delivery_id?: string;
    status?: string;
    data?: unknown;
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Uber's event id (the dedup key). Without one we cannot dedup → reject.
  const eventId =
    typeof event.event_id === "string"
      ? event.event_id
      : typeof event.id === "string"
        ? event.id
        : null;
  if (eventId === null) return new Response("Malformed event", { status: 400 });

  await ctx.runMutation(internal.lib.delivery.webhooks.applyUberWebhookEvent, {
    tenantId,
    eventId,
    event: {
      kind: event.kind,
      delivery_id: event.delivery_id,
      status: event.status,
      data: event.data,
    },
  });

  // 5. Acknowledge fast so Uber stops retrying (research §1.3).
  return new Response(null, { status: 200 });
});
