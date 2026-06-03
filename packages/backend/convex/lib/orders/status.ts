import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { isWithinServiceHours } from "../menu/serviceHours";
import {
  getTenantExceptionalClosure,
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
 * A durable exceptional closure (1+ jour) as stored on `tenants` (PRD 20 §7b,
 * #397 / ADR 0018), or none. Distinct from `OperationalPause` (transient
 * 15-60 min) AND from the lifecycle `status` (KB Admin ops suspension): a
 * gérant-initiated absence with an explicit réouverture window.
 */
export type ExceptionalClosure = { from: number; until: number } | null;

/**
 * Whether a transient operational pause is ACTIVE at `nowMs`. PURE. `until` is
 * EXCLUSIVE: at exactly `until` the pause is over (auto-reprise), so a pause set in
 * the past never gates — no cron is needed to lift it.
 */
export function isPauseActive(pause: OperationalPause, nowMs: number): boolean {
  return pause !== null && pause.until > nowMs;
}

/**
 * Whether a durable exceptional closure is ACTIVE at `nowMs`. PURE. `until` is
 * EXCLUSIVE (same auto-reprise discipline as the pause), and `from` is
 * INCLUSIVE — a closure scheduled for the future (`now < from`) does NOT gate
 * yet. Together: `from <= now < until`.
 */
export function isClosureActive(
  closure: ExceptionalClosure,
  nowMs: number,
): boolean {
  if (closure === null) return false;
  return closure.from <= nowMs && closure.until > nowMs;
}

/**
 * Whether the resto accepts an order at `nowMs`. PURE — the single decision point
 * the checkout gates on: OPEN (within a service window) AND NOT paused AND NOT
 * exceptionally closed. Closed OR paused OR exceptionally closed ⇒ refused (PRD
 * 10 edge "resto fermé / pause", PRD 20 §7b « Fermeture exceptionnelle »).
 *
 * `closure` is OPTIONAL on the args shape for backward compat: legacy call
 * sites that don't pass it keep working — `undefined` behaves as no-closure
 * (the closure gate stays inert) so the existing pause + service-hours
 * combination is preserved untouched.
 */
export function acceptsOrders(args: {
  isOpen: boolean;
  pause: OperationalPause;
  closure?: ExceptionalClosure;
  nowMs: number;
}): boolean {
  if (!args.isOpen) return false;
  if (isPauseActive(args.pause, args.nowMs)) return false;
  if (isClosureActive(args.closure ?? null, args.nowMs)) return false;
  return true;
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
  const [windows, pause, closure] = await Promise.all([
    listTenantServiceWindows(ctx, tenantId),
    getTenantOperationalPause(ctx, tenantId),
    // #397 — the exceptional closure (PRD 20 §7b) is the third independent
    // signal the gate fuses. Reading it through the sanctioned seam means
    // the PWA gate inherits the closure check for free — no checkout-side
    // duplication, no future drift between the gate and the toggle.
    getTenantExceptionalClosure(ctx, tenantId),
  ]);
  return acceptsOrders({
    isOpen: isWithinServiceHours(windows, now),
    pause,
    closure,
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
