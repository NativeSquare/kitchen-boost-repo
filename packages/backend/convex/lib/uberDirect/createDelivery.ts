import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import type { DeliveryStatus } from "../../table/deliveries";

/**
 * 2.6-C — `createDelivery`: the Uber Direct [[Course]] creation (PRD 40 §3,
 * delivery CONTEXT "Course", research §1.2/§1.4/§1.7). This is the ONLY caller of
 * `POST /customers/{customer_id}/deliveries`. It is an INTERNAL ACTION: the sole
 * legitimate trigger is the system-side payment-confirmed flow
 * (`createCourseOnPaymentConfirmed`, 2.6-C) — a KB manager never hand-creates a
 * course. The per-tenant Uber credentials are decrypted ONLY here, via the 2.6-A
 * action-only SYSTEM decrypt (`getDecryptedUberCredentialsSystem`). Isolation is
 * STRUCTURAL (ADR 0010): the `tenantId` comes from the seeded `deliveries` /
 * `payments` row the system already resolved, never a user-supplied/forgeable arg
 * — the same no-actor model as 2.5-B `confirmPaymentSucceeded`.
 *
 * Wire shapes are the documented Uber Direct ones, not invented:
 *  - OAuth2 client-credentials token: `POST https://auth.uber.com/oauth/v2/token`
 *    (research §1.1).
 *  - Create: `POST https://api.uber.com/v1/customers/{customer_id}/deliveries`
 *    carrying the accepted `quote_id` (which already prices+binds the resto→client
 *    route — the pickup is the resto's REGISTERED address on its own Uber
 *    sub-account, so KB does not re-send a pickup address it does not model in
 *    V1), the dropoff (the customer address from the order), ONE aggregated
 *    manifest item + `manifest_reference` = the KB order id, and an
 *    `Idempotency-Key` header (research §1.4/§1.7 — avoid a double dispatch).
 *    Returns `id` (the `uberDeliveryId`), `status`, `pickup_eta`/`dropoff_eta`,
 *    `courier`.
 *
 * The orchestration (`createCourseOnPaymentConfirmed`) lives in `lib/delivery`;
 * this module owns ONLY the Uber conversation. A Create refusal is the PRD 40 §5
 * "course refused post-payment" (Cas A), surfaced as `refused_post_payment`.
 */

const UBER_AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const UBER_API = "https://api.uber.com/v1";
const UBER_SCOPE = "eats.deliveries";

/** A created course, or the refusal reason (PRD 40 §5 Cas A). */
export type CreateDeliveryResult =
  | {
      ok: true;
      uberDeliveryId: string;
      status: DeliveryStatus;
      pickupEta?: number;
      dropoffEta?: number;
      courierName?: string;
      courierPhone?: string;
    }
  | { ok: false; reason: "refused_post_payment" };

/** Validator mirror of `CreateDeliveryResult` for the action's declared return. */
export const createDeliveryResult = v.union(
  v.object({
    ok: v.literal(true),
    uberDeliveryId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("pickup"),
      v.literal("pickup_complete"),
      v.literal("dropoff"),
      v.literal("delivered"),
      v.literal("canceled"),
      v.literal("returned"),
      v.literal("failed"),
    ),
    pickupEta: v.optional(v.number()),
    dropoffEta: v.optional(v.number()),
    courierName: v.optional(v.string()),
    courierPhone: v.optional(v.string()),
  }),
  v.object({
    ok: v.literal(false),
    reason: v.literal("refused_post_payment"),
  }),
);

const UBER_STATUSES: readonly DeliveryStatus[] = [
  "pending",
  "pickup",
  "pickup_complete",
  "dropoff",
  "delivered",
  "canceled",
  "returned",
  "failed",
] as const;

function form(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, value] of Object.entries(params)) usp.set(k, value);
  return usp.toString();
}

/**
 * PURE mapping of the Uber `deliveries` create HTTP result onto our outcome — no
 * I/O, unit-tested on fixed responses. A `2xx` WITH an `id` is a created course
 * (status defaults to `pending` if Uber omits/garbles it); a `2xx` without an id,
 * or any non-OK, is a refusal (the PRD 40 §5 Cas A "course refused post-payment").
 */
export function interpretCreateDeliveryResponse(
  status: number,
  body: Record<string, unknown>,
): CreateDeliveryResult {
  if (status >= 200 && status < 300) {
    const id = body.id;
    if (typeof id === "string") {
      const rawStatus = body.status;
      const courier =
        body.courier && typeof body.courier === "object"
          ? (body.courier as Record<string, unknown>)
          : {};
      const mapped =
        UBER_STATUSES.find((s) => s === rawStatus) ?? ("pending" as const);
      const out: CreateDeliveryResult = {
        ok: true,
        uberDeliveryId: id,
        status: mapped,
      };
      if (typeof body.pickup_eta === "number") out.pickupEta = body.pickup_eta;
      if (typeof body.dropoff_eta === "number")
        out.dropoffEta = body.dropoff_eta;
      if (typeof courier.name === "string") out.courierName = courier.name;
      if (typeof courier.phone_number === "string")
        out.courierPhone = courier.phone_number;
      return out;
    }
    return { ok: false, reason: "refused_post_payment" };
  }
  return { ok: false, reason: "refused_post_payment" };
}

const missingSecret = () =>
  new ConvexError({
    code: "MISCONFIGURED",
    message: "Uber Direct OAuth token exchange did not return an access token.",
  });

async function fetchUberToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(UBER_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: UBER_SCOPE,
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  const token = json.access_token;
  if (!res.ok || typeof token !== "string") throw missingSecret();
  return token;
}

export const createDelivery = internalAction({
  args: {
    tenantId: v.id("tenants"),
    /** The accepted [[Quote]] id to bind the course to (re-captured at payment). */
    quoteId: v.string(),
    /** The KB order id — both `manifest_reference` and the `Idempotency-Key`. */
    manifestReference: v.string(),
    /** The resto display name (the tenant name) for the courier's manifest. */
    pickupName: v.string(),
    /** The customer's delivery address (from the order). */
    dropoffAddress: v.string(),
  },
  returns: createDeliveryResult,
  handler: async (ctx, args): Promise<CreateDeliveryResult> => {
    // Decrypt the tenant's Uber credentials — ACTION-ONLY (2.6-A), via the
    // system-side decrypt (the trigger is the no-actor payment-confirmed flow;
    // the tenantId is structural, ADR 0010). The plaintext is produced only here.
    const creds = await ctx.runAction(
      internal.lib.uberDirect.credentials.getDecryptedUberCredentialsSystem,
      { tenantId: args.tenantId },
    );

    const token = await fetchUberToken(creds.clientId, creds.clientSecret);

    const res = await fetch(
      `${UBER_API}/customers/${creds.customerId}/deliveries`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Idempotency on Create Delivery (research §1.7) — avoid double dispatch.
          "Idempotency-Key": args.manifestReference,
        },
        body: JSON.stringify({
          quote_id: args.quoteId,
          pickup_name: args.pickupName,
          dropoff_address: args.dropoffAddress,
          // One aggregated manifest item is enough for KB (research §1.4).
          manifest_items: [{ name: "Commande", quantity: 1, size: "medium" }],
          manifest_reference: args.manifestReference,
        }),
      },
    );
    const json = (await res.json()) as Record<string, unknown>;
    return interpretCreateDeliveryResponse(res.status, json);
  },
});
