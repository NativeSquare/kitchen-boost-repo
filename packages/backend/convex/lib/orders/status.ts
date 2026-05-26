import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { isWithinServiceHours } from "../menu/serviceHours";
import {
  getTenantOperationalPause,
  listTenantServiceWindows,
  publicTenantQuery,
} from "../tenancy";

/**
 * 2.3-F — operational status of a resto: "does it accept an order RIGHT NOW?"
 * (PRD 10 §4/§7 + edge "resto fermé / pause", PRD 20 §7, client-ordering CONTEXT,
 * ADR 0010). This is the gate the PWA checkout obeys — there is no pre-order V1
 * (PRD 10 edge), so an order can only be placed when the resto accepts now.
 *
 * `acceptsOrderNow` COMBINES two independent signals:
 *  - the 2.2-E service-hours decision (`isWithinServiceHours`, REUSED verbatim —
 *    the open/closed logic is NOT reimplemented here), and
 *  - the 2.3-A transient `operationalPause` ("Pause exceptionnelle" 15/30/60 min,
 *    carried by `tenants.operationalPause = { until }`).
 *
 * A resto accepts now IFF it is WITHIN a service window AND not currently paused.
 *
 * Auto-reprise (PRD 20 §7 flow 6): the pause expiry is DERIVED from `until` — once
 * `until <= now`, the resto accepts again with NO manual `clearOperationalPause`
 * and NO cron. The pause toggle itself (`setOperationalPause` /
 * `clearOperationalPause`, both audited `tenantMutation`s) lives in the 2.3-A
 * `orders` module; this slice adds only the COMBINED read + the checkout wiring.
 *
 * The combination is a PURE function (open + pause + clock → boolean), so the
 * time-sensitive cases (pause not-yet-expired vs expired) are tested
 * deterministically on injected timestamps, never the real wall-clock. The Convex
 * surface (`acceptsOrderNow`, PUBLIC) and the checkout gate
 * (`tenantAcceptsOrderNow`) only feed the tenant's persisted windows + pause +
 * `Date.now()` into it.
 */

/** A transient operational pause as stored on `tenants` (PRD 20 §7), or none. */
export type OperationalPause = { until: number } | null;

/**
 * Whether a transient operational pause is ACTIVE at `nowMs`. PURE. `until` is
 * EXCLUSIVE: at exactly `until` the pause is over (auto-reprise), so a pause set in
 * the past never gates — no cron is needed to lift it.
 */
export function isPauseActive(pause: OperationalPause, nowMs: number): boolean {
  return pause !== null && pause.until > nowMs;
}

/**
 * Whether the resto accepts an order at `nowMs`. PURE — the single decision point
 * the checkout gates on: OPEN (within a service window) AND NOT paused. Closed OR
 * paused ⇒ refused (PRD 10 edge "resto fermé / pause").
 */
export function acceptsOrders(args: {
  isOpen: boolean;
  pause: OperationalPause;
  nowMs: number;
}): boolean {
  return args.isOpen && !isPauseActive(args.pause, args.nowMs);
}

/**
 * Resolve the COMBINED operational status of `tenantId` against the current clock:
 * read the tenant's service windows + transient pause through the sanctioned
 * tenancy seams (never raw `ctx.db` — `no-untenanted-query` / ADR 0010) and feed
 * them to the pure `acceptsOrders`. Tenant-scoped BY CONSTRUCTION (both reads are
 * keyed on the passed `tenantId`), so one tenant's hours/pause can NEVER gate
 * another tenant. Reused by BOTH the public `acceptsOrderNow` read AND the checkout
 * mutation (`createOrderFromCart`, slice B) so the gate is defined once.
 */
export async function tenantAcceptsOrderNow(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<boolean> {
  const now = Date.now();
  const [windows, pause] = await Promise.all([
    listTenantServiceWindows(ctx, tenantId),
    getTenantOperationalPause(ctx, tenantId),
  ]);
  return acceptsOrders({
    isOpen: isWithinServiceHours(windows, now),
    pause,
    nowMs: now,
  });
}

// --- Convex surface ----------------------------------------------------------

/**
 * PUBLIC, unauthenticated read consumed by the PWA to gate the checkout AND show
 * the resto's live status: `true` iff the tenant is WITHIN a service window AND not
 * currently paused, else `false` (incl. a tenant with no hours, or one whose pause
 * has not yet expired). Tenant-scoped by construction (both signals read through the
 * sanctioned seams keyed on `ctx.tenantId`), so a tenant's status can NEVER gate
 * another tenant (ADR 0010). Mirrors the 2.2-E `isOpenNow` shape, extended with the
 * pause.
 */
export const acceptsOrderNow = publicTenantQuery({
  args: {},
  handler: async (ctx): Promise<boolean> =>
    tenantAcceptsOrderNow(ctx, ctx.tenantId),
});
