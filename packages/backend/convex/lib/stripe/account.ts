import { ConvexError, v } from "convex/values";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { action } from "../../_generated/server";
import {
  getTenantById,
  kbAdminMutation,
  kbAdminQuery,
  setTenantStripeAccount,
  setTenantStripeStatus,
} from "../tenancy";

/**
 * 2.5-A — Stripe Connect Express onboarding from KB Admin (root) (PRD 30 §1,
 * payment CONTEXT). Generate a PRE-FILLED `account_link` so Alex can onboard a
 * resto live in Phase C (~10-15 min on site), and stamp the freshly-created
 * connected account on the tenant.
 *
 * The Stripe API calls live in an ACTION (`createStripeAccountLink`) — the
 * `STRIPE_SECRET_KEY` env var (KB-wide, NOT per-tenant ⇒ no envelope encryption
 * here, issue #35) is read here, and the network call to Stripe runs in the
 * action runtime. No Stripe SDK dependency: the two REST endpoints
 * (`POST /v1/accounts`, `POST /v1/account_links`) are called over `fetch` with
 * form-encoded bodies (the documented Stripe wire format). The DB writes go
 * through root-gated `kbAdminMutation`s ordered AFTER the Stripe calls — Stripe
 * code in the action, DB writes in mutations, the action↔mutation split STACK
 * §2.3 prescribes. Every write is root-only AND auto-audited (`kbAdminMutation`).
 *
 * Root-only: the action first re-asserts the caller is `kb_admin` (via the
 * guarded `loadTenantForStripe` query, which inherits the action's auth
 * identity), so a non-root caller is refused BEFORE any Stripe call.
 */

const STRIPE_API = "https://api.stripe.com/v1";

const missingSecret = () =>
  new ConvexError({
    code: "MISCONFIGURED",
    message: "STRIPE_SECRET_KEY is not configured.",
  });

const tenantNotFound = () =>
  new ConvexError({ code: "NOT_FOUND", message: "Tenant not found." });

/**
 * Server-side mirror of the client email regex (cf.
 * `apps/admin/.../stripe-settings-view.tsx` → `EMAIL_REGEX`). Defence-in-
 * depth: the admin UI already disables the submit button on an invalid
 * syntax (commit e5e6b18), but that gate is bypassable (curl direct, another
 * client, bot…). Stripe's own answer on an invalid email is a cryptic 400
 * « Invalid email address: » that surfaces poorly in the Network tab —
 * gating here lets us throw a clear typed `INVALID_EMAIL` before any
 * Stripe call.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const invalidEmail = (email: string) =>
  new ConvexError({
    code: "INVALID_EMAIL",
    message: `Email invalide : ${email}`,
  });

/** Encode a flat record as application/x-www-form-urlencoded (Stripe wire format). */
function form(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, value] of Object.entries(params)) usp.set(k, value);
  return usp.toString();
}

async function stripePost(
  secret: string,
  path: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message;
    throw new ConvexError({
      code: "STRIPE_ERROR",
      message: `Stripe API error: ${err ?? res.status}`,
    });
  }
  return json;
}

async function stripeGet(
  secret: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message;
    throw new ConvexError({
      code: "STRIPE_ERROR",
      message: `Stripe API error: ${err ?? res.status}`,
    });
  }
  return json;
}

// ---------------------------------------------------------------------------
// Root-gated Convex surface (kbAdminQuery / kbAdminMutation) — root only,
// mutations auto-audited. The action orchestrates these between Stripe calls.
// ---------------------------------------------------------------------------

/** Root-only read of one tenant (used by the action to re-assert root + load). */
export const loadTenantForStripe = kbAdminQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<Doc<"tenants"> | null> =>
    getTenantById(ctx, args.tenantId),
});

/**
 * Root-only stamp of the connected Stripe account on a tenant, with an initial
 * `pending` status (KYC begins). Auto-audited by `kbAdminMutation`. Idempotent:
 * a re-stamp with the same account id leaves the status untouched if already
 * past `pending`? No — the initial stamp always lands `pending`; subsequent
 * status moves come from the webhook. Re-running with an existing account is a
 * no-op-equivalent write (same id, status reset to pending is acceptable only
 * pre-onboarding — the action only stamps when the account is freshly created).
 */
export const stampStripeAccount = kbAdminMutation({
  args: { tenantId: v.id("tenants"), stripeAccountId: v.string() },
  action: "stripe.account.stamp",
  handler: async (ctx, args): Promise<void> => {
    await setTenantStripeAccount(
      ctx,
      args.tenantId,
      args.stripeAccountId,
      "pending",
    );
  },
});

/**
 * Root-only manual override of the tenant's Stripe Connect status. Backup path
 * for when the `account.updated` webhook fails to fire / arrive (Stripe Connect
 * webhook misconfig, sandbox flakiness, signature mismatch, network blip) — the
 * admin completed the KYC with the resto IRL but the badge stays « En attente »
 * forever. With this mutation, the admin can flip the status from the UI in one
 * click instead of waiting / debugging the webhook.
 *
 * Auto-audited via `kbAdminMutation` so every manual override leaves a trail
 * (who, when, from-status → to-status — the wrapper records the action + actor;
 * we add an explicit richer `logAudit` carrying the previous status for ops
 * reconstruction, same pattern as `tenant.activate`).
 *
 * Refuses if the tenant has no `stripeAccountId` yet (overriding the status of
 * a non-existent account makes no sense — generate a Stripe Connect link first).
 *
 * Args:
 *  - `tenantId` — the tenant to patch
 *  - `status`   — `"ready" | "disabled" | "pending"` (the full union; admin can
 *                 roll back if a misclick happened — the audit log records it).
 */
export const forceStripeStatusOverride = kbAdminMutation({
  args: {
    tenantId: v.id("tenants"),
    status: v.union(
      v.literal("ready"),
      v.literal("disabled"),
      v.literal("pending"),
    ),
  },
  action: "stripe.account.forceStatusOverride",
  handler: async (ctx, args): Promise<void> => {
    const tenant = await getTenantById(ctx, args.tenantId);
    if (tenant === null) throw tenantNotFound();
    if (tenant.stripeAccountId === undefined) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message:
          "Cannot force a Stripe status on a tenant with no Stripe account. Generate a Stripe Connect link first.",
      });
    }
    await setTenantStripeStatus(ctx, args.tenantId, args.status);
  },
});

/**
 * Root-only: create (or reuse) the resto's Stripe Connect Express account,
 * PRE-FILLED with its SIRET / email / first + last name, and return a fresh
 * onboarding `account_link` URL. Stamps `stripeAccountId` + initial `pending`
 * status on the tenant (audited). The guarded query refuses any non-root actor
 * before any Stripe call.
 */
export const createStripeAccountLink = action({
  args: {
    tenantId: v.id("tenants"),
    refreshUrl: v.string(),
    returnUrl: v.string(),
    prefill: v.object({
      siret: v.string(),
      email: v.string(),
    }),
  },
  handler: async (ctx, args): Promise<{ accountId: string; url: string }> => {
    // Re-assert root + load the tenant (inherits this action's auth identity);
    // a non-root caller is refused here, before any Stripe call.
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      api.lib.stripe.account.loadTenantForStripe,
      { tenantId: args.tenantId },
    );
    if (tenant === null) throw tenantNotFound();

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw missingSecret();

    // 1. Reuse the account if already created for this tenant, else create one
    //    pre-filled with the resto's known data (SIRET + email).
    //
    //    `business_type: "company"` is the V1 default — most KitchenBoost restos
    //    are SARL / SAS / SASU (sociétés). For `company`, Stripe REJECTS any
    //    `individual[*]` param (the two contracts are mutually exclusive). The
    //    legal representative's first name / last name / personal email are
    //    collected by the Stripe Express KYC UI during onboarding (the gérant
    //    fills them in via the `account_link` URL we hand off). If we later need
    //    to support EI / micro-entreprise, add a `businessType` arg + map to
    //    `business_type: "individual"` + send `individual[*]` (mutually exclusive
    //    with the `company` branch).
    let accountId = tenant.stripeAccountId;
    if (accountId === undefined) {
      // Defence-in-depth: validate the prefilled email server-side BEFORE
      // any Stripe call. The check only fires on the create branch — on a
      // regen (`accountId !== undefined`, `POST /v1/account_links` only),
      // Stripe doesn't re-read the email, so skipping the gate preserves
      // the « Régénérer » UX pinned by client commit e5e6b18.
      const email = args.prefill.email.trim();
      if (!EMAIL_REGEX.test(email)) throw invalidEmail(args.prefill.email);
      const account = await stripePost(secret, "/accounts", {
        type: "express",
        country: "FR",
        business_type: "company",
        email,
        "company[tax_id]": args.prefill.siret,
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
      });
      accountId = account.id as string;
    }

    // 2. Fresh single-use onboarding link for that account.
    const link = await stripePost(secret, "/account_links", {
      account: accountId,
      refresh_url: args.refreshUrl,
      return_url: args.returnUrl,
      type: "account_onboarding",
    });

    // 3. Persist via the root-audited mutation (DB write OUT of the action,
    //    ordered after the Stripe calls).
    await ctx.runMutation(api.lib.stripe.account.stampStripeAccount, {
      tenantId: args.tenantId,
      stripeAccountId: accountId,
    });

    return { accountId, url: link.url as string };
  },
});

/**
 * Root-only READ-ONLY probe of the tenant's connected Stripe account, used
 * by the Paramètres → Stripe Connect page as a SANITY CHECK before deciding
 * to override the local status. Calls `GET /v1/accounts/<acct>` and surfaces
 * the four facts an admin needs to judge « peut-on encaisser maintenant ? » :
 *
 *  - `chargesEnabled` / `payoutsEnabled` (Stripe's authoritative answer)
 *  - `detailsSubmitted` (KYC complete server-side)
 *  - `requirementsCurrentlyDue` (the blockers, if any) + `disabledReason`
 *  - `capabilityCardPayments` / `capabilityTransfers` (per-capability status)
 *
 * Why read-only: the local `tenants.stripeStatus` is a derived projection of
 * Stripe state. The probe never patches the DB — that's the explicit
 * `forceStripeStatusOverride` mutation (which logs an audit row). This split
 * lets the admin SEE the truth, then DECIDE whether to override (because
 * sometimes the local DB diverged from Stripe for non-obvious reasons:
 * webhook lost, signature mismatch, manual Stripe-side action).
 *
 * No audit — pure read with no side-effect, called interactively by an admin.
 * The query is gated root-only via `loadTenantForStripe` (kbAdminQuery), so a
 * non-root caller is refused BEFORE the network call.
 */
export const probeStripeAccount = action({
  args: { tenantId: v.id("tenants") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirementsCurrentlyDue: string[];
    disabledReason: string | null;
    capabilityCardPayments: string | null;
    capabilityTransfers: string | null;
    email: string | null;
    country: string | null;
    defaultCurrency: string | null;
  }> => {
    const tenant: Doc<"tenants"> | null = await ctx.runQuery(
      api.lib.stripe.account.loadTenantForStripe,
      { tenantId: args.tenantId },
    );
    if (tenant === null) throw tenantNotFound();
    if (tenant.stripeAccountId === undefined) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message:
          "Pas de compte Stripe à tester (générer un lien Stripe Connect d'abord).",
      });
    }
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw missingSecret();

    const account = await stripeGet(
      secret,
      `/accounts/${encodeURIComponent(tenant.stripeAccountId)}`,
    );

    const requirements = (account.requirements as
      | { currently_due?: unknown; disabled_reason?: unknown }
      | undefined) ?? { currently_due: [], disabled_reason: null };
    const currentlyDue = Array.isArray(requirements.currently_due)
      ? (requirements.currently_due.filter(
          (x): x is string => typeof x === "string",
        ) ?? [])
      : [];
    const disabledReason =
      typeof requirements.disabled_reason === "string"
        ? requirements.disabled_reason
        : null;

    const caps = (account.capabilities as
      | { card_payments?: unknown; transfers?: unknown }
      | undefined) ?? { card_payments: null, transfers: null };

    return {
      accountId: tenant.stripeAccountId,
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      detailsSubmitted: account.details_submitted === true,
      requirementsCurrentlyDue: currentlyDue,
      disabledReason,
      capabilityCardPayments:
        typeof caps.card_payments === "string" ? caps.card_payments : null,
      capabilityTransfers:
        typeof caps.transfers === "string" ? caps.transfers : null,
      email: typeof account.email === "string" ? account.email : null,
      country: typeof account.country === "string" ? account.country : null,
      defaultCurrency:
        typeof account.default_currency === "string"
          ? account.default_currency
          : null,
    };
  },
});
