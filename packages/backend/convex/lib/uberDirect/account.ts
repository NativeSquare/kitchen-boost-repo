import { ConvexError, v } from "convex/values";
import { api, internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { action } from "../../_generated/server";
import { getTenantById, kbAdminQuery } from "../tenancy";

/**
 * Uber Direct admin probe — root-only READ-ONLY check that the per-tenant
 * credentials stored in `tenantCredentials` (envelope-encrypted, slice 2.6-A)
 * actually authenticate against Uber Direct's OAuth + Customers API.
 *
 * Symmetric to `lib/stripe/account.probeStripeAccount` — same DX in the
 * Paramètres → Uber Direct page : admin presses « Tester la connexion » and
 * gets a structured payload covering the 5 facts that decide « peut-on créer
 * des courses pour ce tenant ? » :
 *   - `tokenObtained`     — OAuth client-credentials grant succeeded (the
 *                            clientId / clientSecret pair is valid)
 *   - `customerReachable` — `GET /v1/customers/<id>/deliveries?limit=1`
 *                            returned 2xx (the customerId belongs to this
 *                            developer account, not someone else's)
 *   - `customerId`        — echoed back from the credentials (for UI display)
 *   - `hasWebhookSigningKey` — surface whether the optional webhook secret
 *                              is set (status webhooks won't verify without it)
 *   - `deliveryCountSample` — how many records the API returned (≥0, usually
 *                              0 in sandbox until the first course is created)
 *
 * Why read-only / no audit: same rationale as `probeStripeAccount` — pure read,
 * no DB write, called interactively by an admin who wants to SEE the truth
 * before deciding to keep / rotate / reconfigure the credentials. Probing
 * happens via the public `getDecryptedUberCredentials` action (which itself
 * inherits this action's auth identity, so a non-root caller is refused
 * BEFORE the network calls).
 *
 * Errors :
 *  - `NOT_FOUND`       — no tenant for that id
 *  - `INVALID_STATE`   — no credentials stored yet (configure them first)
 *  - `UBER_ERROR`      — OAuth or Customers API rejected the request (the
 *                         upstream error description is surfaced verbatim)
 *
 * Endpoints used (Uber Direct documented surface — research/uber_direct_deep_dive) :
 *  - `POST https://login.uber.com/oauth/v2/token`
 *  - `GET  https://api.uber.com/v1/customers/<id>/deliveries?limit=1`
 */

const UBER_OAUTH_URL = "https://login.uber.com/oauth/v2/token";
const UBER_API = "https://api.uber.com/v1";

const tenantNotFound = () =>
  new ConvexError({ code: "NOT_FOUND", message: "Tenant not found." });

/** Form-encoded body builder (Uber OAuth wire format). */
function form(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, value] of Object.entries(params)) usp.set(k, value);
  return usp.toString();
}

/** Root-only re-assert + tenant load (used by the action's auth gate). */
export const loadTenantForUber = kbAdminQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<Doc<"tenants"> | null> =>
    getTenantById(ctx, args.tenantId),
});

export const probeUberAccount = action({
  args: { tenantId: v.id("tenants") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    customerId: string;
    tokenObtained: boolean;
    customerReachable: boolean;
    hasWebhookSigningKey: boolean;
    deliveryCountSample: number;
    organizationLikelyName: string | null;
  }> => {
    // Re-assert root + load tenant (gate-check before any network call).
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      api.lib.uberDirect.account.loadTenantForUber,
      { tenantId: args.tenantId },
    );
    if (tenant === null) throw tenantNotFound();

    // Decrypt credentials via the SYSTEM internal action (the public action
    // would inherit our identity too but we're already root-asserted, and the
    // internal path is the documented "no-actor" seam — same pattern as the
    // webhook handler in `lib/delivery/webhooks.ts`).
    let creds: {
      clientId: string;
      clientSecret: string;
      customerId: string;
      webhookSigningKey?: string;
    };
    try {
      creds = await ctx.runAction(
        internal.lib.uberDirect.credentials.getDecryptedUberCredentialsSystem,
        { tenantId: args.tenantId },
      );
    } catch {
      throw new ConvexError({
        code: "INVALID_STATE",
        message:
          "Aucune credential Uber Direct enregistrée pour ce tenant. Configure-les d'abord.",
      });
    }

    // 1. OAuth client-credentials grant. On OMET volontairement le `scope` :
    //    Uber retourne alors un token avec les scopes par défaut autorisés sur
    //    l'app (cf. OAuth2 RFC 6749 §4.4.2). Le code précédent forçait
    //    `eats.deliveries`, mais les nouvelles apps créées via direct.uber.com
    //    n'ont QUE `direct.organizations` (Uber a renommé / séparé l'API Direct
    //    de l'API Eats) → l'OAuth jetait « scope(s) are invalid ». En omettant,
    //    on est compatible avec les deux générations d'app.
    const tokenRes = await fetch(UBER_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        grant_type: "client_credentials",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      const description =
        typeof tokenJson.error_description === "string"
          ? tokenJson.error_description
          : typeof tokenJson.error === "string"
            ? tokenJson.error
            : `HTTP ${tokenRes.status}`;
      throw new ConvexError({
        code: "UBER_ERROR",
        message: `Uber OAuth error: ${description}`,
      });
    }
    const accessToken =
      typeof tokenJson.access_token === "string" ? tokenJson.access_token : "";
    if (accessToken === "") {
      throw new ConvexError({
        code: "UBER_ERROR",
        message: "Uber OAuth response missing access_token.",
      });
    }

    // 2. Validate the customerId via a cheap deliveries list (limit=1). 200 ⇒
    //    the customerId belongs to this developer account; 404 ⇒ mismatch;
    //    403 ⇒ wrong scope / wrong account.
    const probeRes = await fetch(
      `${UBER_API}/customers/${encodeURIComponent(creds.customerId)}/deliveries?limit=1`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const probeJson = (await probeRes.json()) as Record<string, unknown>;
    if (!probeRes.ok) {
      const message =
        (probeJson.error as { message?: string } | undefined)?.message ??
        (typeof probeJson.message === "string" ? probeJson.message : null) ??
        `HTTP ${probeRes.status}`;
      throw new ConvexError({
        code: "UBER_ERROR",
        message: `Uber Customers API error: ${message}`,
      });
    }

    // `data` is the documented list field; some endpoints return `next_href`
    // etc. — count only the array length we got (sampling, not authoritative).
    const data = probeJson.data;
    const deliveryCountSample = Array.isArray(data) ? data.length : 0;

    return {
      customerId: creds.customerId,
      tokenObtained: true,
      customerReachable: true,
      hasWebhookSigningKey: creds.webhookSigningKey !== undefined,
      deliveryCountSample,
      // Uber doesn't return the organization name on this endpoint; surfaced
      // as `null` for now (future: probe `/v1/customers/<id>` if Uber exposes
      // it). Keeps the return shape stable for the UI today.
      organizationLikelyName: null,
    };
  },
});
