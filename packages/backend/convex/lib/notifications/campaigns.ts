import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { marketingEligible } from "../customer";
import {
  type CustomerCampaignFields,
  insertCampaignEvent,
  insertCampaignLaunch,
  kbAdminMutation,
  listCrossTenantCustomerIds,
  listCustomerCampaignSendTimestamps,
  listTenantCampaignLaunches,
  listTenantCustomerIds,
  logAudit,
  readCustomerCampaignFields,
  readNotificationTemplate,
  tenantMutation,
} from "../tenancy";
import { findCampaignAnomaly } from "./antiAnomaly";
import { inDoNotTrackWindow, nextSendableTime } from "./dnt";
import {
  type MarketingChannel,
  type MarketingReachability,
  pickMarketingChannel,
} from "./marketingCascade";
import { withinRateLimit } from "./marketingRateLimit";
import { findRenderedViolation, renderTemplate } from "./templateBounds";

/**
 * 2.7-D — `sendCampaign`, the MARKETING branch of the Notifications moteur and the
 * MOAT-sensitive heart of the chantier (PRD 80 §2/§4/§6/§7, PRD 90 §5, ADR 0005 /
 * 0006 / 0010 / 0012). Two scopes:
 *
 *  - `sendTenantCampaign` — a `kb_manager` fires a PRE-VALIDATED template to its
 *    OWN clients (ADR 0006: no free text). Cascade tenant (Web Push > Wallet >
 *    Email). Tenant-scoped via `tenantMutation` keyed on `ctx.tenantId`.
 *  - `sendCrossTenantCampaign` — ONLY a `kb_admin` (KB proxy) fires a free-content
 *    network campaign, cascade cross-tenant (Wallet > Email, web-push excluded).
 *    Via `kbAdminMutation` (root) — a `kb_manager` can NEVER call it.
 *
 * ── MOAT, the non-negotiable (PRD 90 §3/§5, ADR 0010) ─────────────────────────
 * KB sends in PROXY. The whole targeting + sending runs server-side here; both
 * mutations return ONLY aggregate counters — `targeted`/`sent`/`queued`/skipped.
 * A `kb_manager` NEVER receives a recipient identity (email/phone/name) nor the
 * individual recipient list: the customer fiches are read through the NARROW
 * `readCustomerCampaignFields` seam, reduced to a per-customer channel decision,
 * and discarded. There is NO query that returns a raw `customer` to a resto.
 *
 * ── Guardrails, all enforced + tested (no invented spec) ──────────────────────
 *  - marketingEligible (ADR 0005) — skip ineligible/opted-out customers; a later
 *    checkout re-includes them (re-consent par achat).
 *  - rate-limit 3/sem GLOBAL (PRD 80 §6) — across ALL tenants + cross-tenant.
 *  - DNT 22h-8h Europe/Paris (PRD 80 §6) — a launch inside the window QUEUES the
 *    sends (status `queued`, dispatched at 08:00 by a later slice's scheduler);
 *    never applied to transactional (a different code path).
 *  - anti-anomaly (PRD 80 §7) — > 1 campaign/48h, > 3/week, recipient surge +50 %
 *    → throw + `logAudit` anomaly row (the KB alert hook).
 *  - template bounds (ADR 0006) — the rendered tenant message is re-checked
 *    (discount ≤ 50 %, < 200 chars, FR, no alcohol) before any send.
 *
 * Isolation (ADR 0010): never raw `ctx.db` — every read/write goes through the
 * sanctioned `lib/tenancy` seam; identity via `getCurrentActor` (inside the
 * wrappers). Ships the cross-tenant fuzz suite (campaigns.test.ts). NO network I/O
 * here: the concrete transports (web-push #54, APNs #71, email) are later slices;
 * each send is journaled (`sent` outside DNT, `queued` inside) for the dispatcher.
 */

/** The aggregate-only result of a campaign run (the MOAT — no recipient identity). */
export type CampaignResult = {
  /** Eligible + reachable customers the campaign actually addressed. */
  targeted: number;
  /** Sends journaled as dispatched now (outside DNT). */
  sent: number;
  /** Sends journaled as queued for 08:00 (launched inside DNT). */
  queued: number;
  /** Customers skipped because marketing-ineligible (opted out, ADR 0005). */
  skippedIneligible: number;
  /** Customers skipped because over the global 3/sem rate limit. */
  skippedRateLimited: number;
  /** Customers skipped because reachable on no channel of the cascade. */
  skippedUnreachable: number;
};

/** Build the marketing reachability of a customer from its narrow fiche fields. */
function reachabilityOf(fields: CustomerCampaignFields): MarketingReachability {
  const e = fields.pushEnrollment;
  return {
    webPush: e?.webPushStatus === "enrolled",
    walletPush: e?.walletStatus === "enrolled",
    email: !!fields.email && fields.email.length > 0,
  };
}

const anomalyError = (reason: string) =>
  new ConvexError({
    code: "CAMPAIGN_ANOMALY",
    message: `Campaign anomaly blocked: ${reason}`,
  });

const boundError = (reason: string) =>
  new ConvexError({
    code: "TEMPLATE_BOUND_VIOLATION",
    message: `Campaign template bound violated: ${reason}`,
  });

/**
 * The shared send loop (KB proxy). For every candidate customer: read the narrow
 * fiche, skip if marketing-ineligible (ADR 0005) or over the GLOBAL rate limit
 * (PRD 80 §6), else pick the ONE cascade channel; unreachable → skip. Journal each
 * effective send (`queued` inside DNT, else `sent`). Returns the aggregate counts
 * ONLY (the MOAT — no recipient identity ever leaves this function).
 */
async function runCampaign(
  ctx: MutationCtx,
  opts: {
    tenantId: Id<"tenants">;
    scope: "tenant" | "cross_tenant";
    templateId?: Id<"notificationTemplates">;
    customerIds: Id<"customers">[];
    now: number;
  },
): Promise<CampaignResult> {
  const inDnt = inDoNotTrackWindow(opts.now);
  const status = inDnt ? ("queued" as const) : ("sent" as const);
  const sentAt = inDnt ? nextSendableTime(opts.now) : opts.now;

  const result: CampaignResult = {
    targeted: 0,
    sent: 0,
    queued: 0,
    skippedIneligible: 0,
    skippedRateLimited: 0,
    skippedUnreachable: 0,
  };

  for (const customerId of opts.customerIds) {
    const fields = await readCustomerCampaignFields(ctx, customerId);
    if (fields === null) continue; // fiche vanished — skip silently

    // 1. Marketing eligibility (ADR 0005) — consent + not opted-out (re-consent
    //    by purchase handled by the pure rule).
    if (!marketingEligible(fields)) {
      result.skippedIneligible += 1;
      continue;
    }

    // 2. Global rate limit (PRD 80 §6) — 3/sem across ALL tenants + cross-tenant.
    const priorSends = await listCustomerCampaignSendTimestamps(
      ctx,
      customerId,
    );
    if (!withinRateLimit(priorSends, opts.now)) {
      result.skippedRateLimited += 1;
      continue;
    }

    // 3. Cascade — ONE effective channel for the scope, or skip if unreachable.
    const channel: MarketingChannel | null = pickMarketingChannel(
      opts.scope,
      reachabilityOf(fields),
    );
    if (channel === null) {
      result.skippedUnreachable += 1;
      continue;
    }

    // 4. Journal the send (queued inside DNT, else sent). The customer is carried
    //    BY ID only — no nominative coordinate (the MOAT).
    await insertCampaignEvent(ctx, opts.tenantId, {
      customerId,
      scope: opts.scope,
      templateId: opts.templateId,
      channel,
      status,
      createdAt: opts.now,
      ...(status === "sent" ? { sentAt } : {}),
    });
    result.targeted += 1;
    if (inDnt) result.queued += 1;
    else result.sent += 1;
  }

  return result;
}

/**
 * TENANT campaign — a `kb_manager` fires a pre-validated template to its OWN
 * clients (ADR 0006). The resto fills `variables` (no free text). Enforces the
 * anti-anomaly cadence + the rendered template bounds BEFORE any send, then runs
 * the KB-proxy send loop and records the launch. Returns aggregate counts ONLY.
 *
 * `now` is injectable so DNT / rate-limit / anomaly windows are deterministic in
 * tests; production omits it (wall clock).
 */
export const sendTenantCampaign = tenantMutation({ allow: ["kb_manager"] })({
  args: {
    templateId: v.id("notificationTemplates"),
    variables: v.record(v.string(), v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CampaignResult> => {
    const now = args.now ?? Date.now();

    // Resolve + validate the pre-validated template (ADR 0006). A resto-scoped
    // template must belong to THIS tenant; a KB-central one (no tenantId) is
    // shared. A cross_tenant template is NOT usable by a resto.
    const template = await readNotificationTemplate(ctx, args.templateId);
    if (template === null) {
      throw new ConvexError({
        code: "TEMPLATE_NOT_FOUND",
        message: "Campaign template not found",
      });
    }
    if (template.scope !== "tenant") {
      throw boundError("template is not a tenant template");
    }
    if (template.tenantId !== undefined && template.tenantId !== ctx.tenantId) {
      throw boundError("template belongs to another tenant");
    }
    if (!template.active) {
      throw boundError("template is inactive");
    }

    // Render + re-check the FINAL message bounds (PRD 80 §4 / ADR 0006).
    const rendered = renderTemplate(template.body, args.variables);
    const violation = findRenderedViolation({
      rendered,
      values: args.variables,
      language: template.language,
      containsAlcohol: template.containsAlcohol,
    });
    if (violation !== null) throw boundError(violation);

    // Candidate audience = the tenant's OWN linked customers.
    const customerIds = await listTenantCustomerIds(ctx, ctx.tenantId);

    // Anti-anomaly (PRD 80 §7) — cadence + recipient surge vs the resto's history.
    // The "recipients" the rule weighs is the candidate audience size (the bond
    // the resto is about to push to), checked BEFORE per-customer filtering.
    const history = await listTenantCampaignLaunches(ctx, ctx.tenantId);
    const anomaly = findCampaignAnomaly(history, customerIds.length, now);
    if (anomaly !== null) {
      await logAudit(ctx, {
        actorUserId: ctx.actor.userId,
        actorRole: ctx.actor.effectiveRole ?? ctx.actor.role,
        action: "notifications.campaign.anomaly",
        tenantId: ctx.tenantId,
        targetType: "tenant",
        targetId: ctx.tenantId,
        metadata: { anomaly },
      });
      throw anomalyError(anomaly);
    }

    const result = await runCampaign(ctx, {
      tenantId: ctx.tenantId,
      scope: "tenant",
      templateId: args.templateId,
      customerIds,
      now,
    });

    // Record the launch (anti-anomaly trail) + audit the trigger (PRD 80 §7).
    await insertCampaignLaunch(ctx, ctx.tenantId, {
      scope: "tenant",
      launchedAt: now,
      recipients: result.targeted,
    });
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.effectiveRole ?? ctx.actor.role,
      action: "notifications.campaign.send",
      tenantId: ctx.tenantId,
      targetType: "tenant",
      targetId: ctx.tenantId,
      metadata: { scope: "tenant", templateId: args.templateId },
    });

    return result;
  },
});

/**
 * CROSS-TENANT campaign — ONLY a `kb_admin` (root, KB proxy) fires a network
 * campaign at a target tenant's audience (free content, ADR 0006). Cascade
 * cross-tenant (Wallet > Email, web-push excluded by design). The upstream
 * geo-filter (PRD 80 §2) is KB's responsibility before this call; this enumerates
 * the target tenant's audience and runs the same KB-proxy send loop. A `kb_manager`
 * can NEVER reach this — `kbAdminMutation` rejects every non-root actor (the MOAT:
 * a resto cannot use a cross-tenant campaign to learn other tenants' customers).
 * Auto-audited by the root wrapper. Returns aggregate counts ONLY.
 */
export const sendCrossTenantCampaign = kbAdminMutation({
  args: {
    tenantId: v.id("tenants"),
    body: v.string(),
    now: v.optional(v.number()),
  },
  action: "notifications.campaign.send.cross_tenant",
  handler: async (ctx, args): Promise<CampaignResult> => {
    const now = args.now ?? Date.now();

    // KB content is free (ADR 0006: "KB se fait confiance sur le tone"); only the
    // hard length bound is kept for channel coherence (Wallet/Web Push ~200 chars).
    if (args.body.length >= 200) {
      throw boundError("BODY_TOO_LONG");
    }

    const customerIds = await listCrossTenantCustomerIds(ctx, args.tenantId);

    const result = await runCampaign(ctx, {
      tenantId: args.tenantId,
      scope: "cross_tenant",
      customerIds,
      now,
    });

    await insertCampaignLaunch(ctx, args.tenantId, {
      scope: "cross_tenant",
      launchedAt: now,
      recipients: result.targeted,
    });

    return result;
  },
});
