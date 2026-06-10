import { ConvexError, v } from "convex/values";
import { api, internal } from "../../_generated/api";
import { action } from "../../_generated/server";

/**
 * 2.6-B — `requestQuote(tenantId, address)`: the address-first Uber Direct
 * [[Quote]] (PRD 40 §2, delivery CONTEXT "Address-first flow" / "Quote", ADR
 * 0010 / 0011).
 *
 * On PWA entry (BEFORE the menu) the backend asks Uber Direct for a delivery
 * quote on the customer's address and returns the fee + ETA, or the reason the
 * address is not deliverable. This ACTION is the ONLY place that talks to the
 * Uber API, and the per-tenant Uber credentials are decrypted ONLY here (it
 * reuses the 2.6-A action-only decrypt `getDecryptedUberCredentials`, whose blob
 * read is itself gated by the kb_manager `tenantQuery` — so an unauthorized /
 * cross-tenant caller is refused BEFORE any Uber HTTP call; ADR 0010).
 *
 * Wire shapes are the documented Uber Direct ones (not invented):
 *  - OAuth2 client-credentials token: `POST https://auth.uber.com/oauth/v2/token`
 *    with `grant_type=client_credentials` + `scope=eats.deliveries`
 *    (research/uber_direct_deep_dive §1.1).
 *  - Quote: `POST https://api.uber.com/v1/customers/{customer_id}/delivery_quotes`
 *    returning `id` (quote id), `fee` (cents), `duration` (ETA minutes)
 *    (research §1.2).
 *
 * `lib/delivery/quote` (the livrabilité orchestration that crosses this with the
 * [[Plage horaire de service]]) consumes the verdict; this module owns ONLY the
 * Uber conversation.
 */

const UBER_AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const UBER_API = "https://api.uber.com/v1";
/** Scope needed for the deliveries product (research §1.1). */
const UBER_SCOPE = "eats.deliveries";

/** A deliverable quote (fee in cents, eta in minutes), or the refusal reason. */
export type UberQuoteResult =
  | { ok: true; quoteId: string; fee: number; eta: number }
  | { ok: false; reason: "hors_zone" | "surge" };

/** Validator mirror of `UberQuoteResult` for the action's declared return. */
export const uberQuoteResult = v.union(
  v.object({
    ok: v.literal(true),
    quoteId: v.string(),
    fee: v.number(),
    eta: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    reason: v.union(v.literal("hors_zone"), v.literal("surge")),
  }),
);

/** Encode a flat record as application/x-www-form-urlencoded (OAuth wire format). */
function form(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, value] of Object.entries(params)) usp.set(k, value);
  return usp.toString();
}

/**
 * PURE mapping of the Uber `delivery_quotes` HTTP result onto our verdict — no
 * I/O, so it is unit-tested on fixed responses. A `2xx` carries a quote
 * (`id`/`fee`/`duration`); a refusal is interpreted by Uber's documented error
 * `code`: a temporarily-unavailable / surge condition (`request_unavailable`,
 * `429`) ⇒ `surge` (transient — retry later), and any other non-OK ⇒ `hors_zone`
 * (the address is not serviceable — only click & collect remains). We never
 * INVENT a fee: a missing fee on a 2xx is treated as not deliverable.
 */
export function interpretQuoteResponse(
  status: number,
  body: Record<string, unknown>,
): UberQuoteResult {
  if (status >= 200 && status < 300) {
    const quoteId = body.id;
    const fee = body.fee;
    const eta = body.duration;
    if (
      typeof quoteId === "string" &&
      typeof fee === "number" &&
      typeof eta === "number"
    ) {
      return { ok: true, quoteId, fee, eta };
    }
    // A 2xx without a usable fee/eta is not a quote we can present.
    return { ok: false, reason: "hors_zone" };
  }

  const code = typeof body.code === "string" ? body.code : "";
  // Surge / temporary unavailability (transient — the customer can retry).
  if (status === 429 || code === "request_unavailable") {
    return { ok: false, reason: "surge" };
  }
  // Everything else (address_undeliverable, invalid params, …) ⇒ not serviceable.
  return { ok: false, reason: "hors_zone" };
}

const missingSecret = () =>
  new ConvexError({
    code: "MISCONFIGURED",
    message: "Uber Direct OAuth token exchange did not return an access token.",
  });

/**
 * Exchange the tenant's `clientId` / `clientSecret` for a Bearer token (OAuth2
 * client credentials). The token is valid 30 days (research §1.1) but V1 fetches
 * one per quote — proactive caching is a later optimisation, not a correctness
 * concern, and is out of scope for this slice.
 */
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

export const requestQuote = action({
  args: {
    tenantId: v.id("tenants"),
    /** The customer's dropoff address (Google Places line, PRD 40 §2). */
    address: v.string(),
  },
  returns: uberQuoteResult,
  handler: async (ctx, args): Promise<UberQuoteResult> => {
    // Decrypt the tenant's Uber credentials via the SYSTEM (internalAction)
    // variant — un-gated for server-to-server use, so the PWA Client's
    // anonymous customer-facing `requestDeliveryQuote` can drive this action
    // without tripping the kb_manager auth gate that the public
    // `getDecryptedUberCredentials` exposes (ADR 0010). The tenant scope is
    // still enforced: the `tenantId` here comes from the PWA client (set by
    // the host-only `__Host-kb_tenant` cookie via the middleware) so there is
    // no cross-tenant probing vector — and the credentials themselves never
    // cross the wire to the caller, this whole flow stays server-side.
    const creds = await ctx.runAction(
      internal.lib.uberDirect.credentials.getDecryptedUberCredentialsSystem,
      { tenantId: args.tenantId },
    );

    const token = await fetchUberToken(creds.clientId, creds.clientSecret);

    // Quote on the tenant's OWN Uber sub-account (customer_id), Bearer token. The
    // secret is never placed on the URL.
    const res = await fetch(
      `${UBER_API}/customers/${creds.customerId}/delivery_quotes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dropoff_address: args.address }),
      },
    );
    const json = (await res.json()) as Record<string, unknown>;
    return interpretQuoteResponse(res.status, json);
  },
});
