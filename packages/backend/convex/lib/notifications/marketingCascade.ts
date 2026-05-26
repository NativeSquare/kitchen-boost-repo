import type { TemplateScope } from "../../table/notifications";

/**
 * 2.7-D — the PURE marketing cascade (PRD 80 §2 / notifications CONTEXT "Cascade
 * marketing", Notes "2 cascades marketing distinctes"). NO Convex ctx, no I/O —
 * unit-testable in isolation like the transactional `engine`.
 *
 * A marketing campaign picks ONE effective channel per customer (NOT multi-canal,
 * unlike the transactional Archive trace): the FIRST channel of the scope's
 * preference order the customer is reachable on, falling through on a missing /
 * inactive channel. Two cascades, hardcoded V1 (the caller never overrides them):
 *  - tenant       : Web Push > Wallet push > Email — the PWA tenant Web Push is
 *    preferred (campaign from the resto's own domain origin).
 *  - cross_tenant : Wallet push > Email — the PWA tenant Web Push is EXCLUDED BY
 *    DESIGN: a web-push subscription is bound to a single tenant origin (browser
 *    security), so it can never carry a cross-tenant message (PRD 80 §3 "Push web
 *    … Jamais cross-tenant"). The common Wallet pass is the only cross-tenant push.
 *
 * SMS is NOT a marketing channel (PRD 80 Notes "SMS exclu du marketing"): it is
 * the transactional extreme fallback only, so it never appears in either cascade.
 */

/** A channel a marketing campaign may go out on (subset of the V1 channels). */
export type MarketingChannel = "web_push" | "wallet_push" | "email";

/**
 * Per-channel reachability of one customer for the marketing cascade. Derived by
 * the caller from the 2.1 reachability fields (ADR 0012) — `wallet`/`web` push
 * enrolment + an email on file. `false` = absent / `not_enrolled` / `revoked` /
 * `inactive` endpoint ⇒ the cascade falls through to the next channel.
 */
export type MarketingReachability = {
  webPush: boolean;
  walletPush: boolean;
  email: boolean;
};

/** Tenant cascade preference order (PRD 80 §2). */
export const TENANT_CASCADE: MarketingChannel[] = [
  "web_push",
  "wallet_push",
  "email",
];

/**
 * Cross-tenant cascade preference order (PRD 80 §2). Web Push is intentionally
 * absent — it is bound to one tenant origin and can never be cross-tenant.
 */
export const CROSS_TENANT_CASCADE: MarketingChannel[] = [
  "wallet_push",
  "email",
];

/** The cascade for a campaign scope. */
function cascadeFor(scope: TemplateScope): MarketingChannel[] {
  return scope === "tenant" ? TENANT_CASCADE : CROSS_TENANT_CASCADE;
}

/** Whether the customer is reachable on a given marketing channel. */
function reachableOn(
  channel: MarketingChannel,
  reach: MarketingReachability,
): boolean {
  switch (channel) {
    case "web_push":
      return reach.webPush;
    case "wallet_push":
      return reach.walletPush;
    case "email":
      return reach.email;
  }
}

/**
 * Pick the single effective marketing channel for one customer under a scope's
 * cascade, or `null` when the customer is reachable on none of the scope's
 * channels (no marketing send for them this campaign).
 */
export function pickMarketingChannel(
  scope: TemplateScope,
  reach: MarketingReachability,
): MarketingChannel | null {
  for (const channel of cascadeFor(scope)) {
    if (reachableOn(channel, reach)) return channel;
  }
  return null;
}
