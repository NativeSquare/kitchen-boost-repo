import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import {
  type QueryCtx,
  internalAction,
  internalQuery,
} from "../../_generated/server";
import {
  kbAdminQuery,
  listAllTenantIds,
  listProspects,
  listTenantDeliveries,
  listTenantOrders,
} from "../tenancy";

/**
 * 2.9-F — Monitoring incidents (PRD 70 §3.8, kb-admin CONTEXT "Monitoring
 * incidents"): detect ops incidents and emit Slack alerts so KB ops react
 * without watching each tenant manually. Backend only — the monitoring dashboard
 * UI is front Train B.
 *
 * Three detections (PRD 70 §3.8, thresholds NOT invented):
 *  - a webhook (Stripe / Uber) whose processing LATENCY exceeds 30 s,
 *  - a tenant stuck in KYC `pending_kyc` for more than 48 h,
 *  - a paid `delivery` order with no Uber course created.
 *
 * ── Pure detection layer ──────────────────────────────────────────────────────
 * Each detector is PURE (no DB, no ctx): given a CONDITION it returns an
 * `Incident` (the acceptance criteria "testable in isolation"). The Convex wiring
 * (read live data → run the detectors → Slack post) is the thin part below.
 *
 * ── Sources not yet available (2.5/2.6) are feature-flagged ───────────────────
 * Webhook latency tracking and the order↔Uber-course linkage are owned by
 * chantiers 2.5 / 2.6 and are not wired yet. The scan feeds those detectors an
 * EMPTY source (so they never false-fire), gated by env flags
 * (`MONITORING_WEBHOOK_LATENCY_ENABLED` / `MONITORING_PAID_NO_COURSE_ENABLED`):
 * the plumbing (threshold check → Slack post) is fully testable today, and the
 * live source plugs in additively when 2.5/2.6 land. The KYC-pending detector has
 * a REAL source already (the prospect `stripeConnect`/`uberDirect` milestones,
 * 2.9-A) and runs live.
 *
 * ── Isolation (ADR 0010 / 0011) ──────────────────────────────────────────────
 * Monitoring is KB-ADMIN-GLOBAL ops data: `previewIncidents` goes through the
 * root wrapper (`kbAdminQuery`) — every non-root actor is refused (root-only
 * fuzz). All DB reads go through the sanctioned `lib/tenancy` store seams (never
 * raw `ctx.db` in this business module — `no-untenanted-query`). The cron
 * `runMonitoringScan` is a SYSTEM job (no actor, like the menu reactivation cron)
 * and reads through an `internalQuery` that uses the same seams.
 */

// ---------------------------------------------------------------------------
// Thresholds (PRD 70 §3.8 — not invented).
// ---------------------------------------------------------------------------

/** Webhook processing latency over which an incident fires (PRD 70 §3.8: > 30 s). */
export const WEBHOOK_LATENCY_THRESHOLD_MS = 30_000;

/** KYC `pending_kyc` dwell over which an incident fires (PRD 70 §3.8: > 48 h). */
export const KYC_PENDING_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Incident model.
// ---------------------------------------------------------------------------

/** The KYC integration whose `pending_kyc` is being watched (PRD 70 §3.3 enums). */
export type KycProvider = "stripe" | "uber_direct";

/** A webhook latency sample (provider + external id + measured latency, ms). */
export type WebhookLatencySample = {
  provider: string;
  externalId: string;
  latencyMs: number;
};

/** A detected ops incident — one of the three PRD 70 §3.8 kinds. */
export type Incident =
  | {
      kind: "webhook_latency";
      provider: string;
      externalId: string;
      latencyMs: number;
    }
  | {
      kind: "kyc_pending";
      provider: KycProvider;
      prospectId: string;
      prospectName?: string;
      pendingSinceMs: number;
    }
  | { kind: "paid_no_course"; orderId: string; tenantId?: string };

// ---------------------------------------------------------------------------
// PURE detectors (no DB, no ctx — the "testable in isolation" core).
// ---------------------------------------------------------------------------

/**
 * Webhook samples whose latency is STRICTLY over `thresholdMs` (PRD 70 §3.8:
 * latence > 30 s). An at-threshold sample is healthy. Pure.
 */
export function detectWebhookLatencyIncidents(
  samples: WebhookLatencySample[],
  thresholdMs: number,
): Incident[] {
  return samples
    .filter((s) => s.latencyMs > thresholdMs)
    .map((s) => ({
      kind: "webhook_latency" as const,
      provider: s.provider,
      externalId: s.externalId,
      latencyMs: s.latencyMs,
    }));
}

/** The minimal prospect shape the KYC-pending detector needs (pure-testable). */
export type KycScanProspect = {
  _id: string;
  name?: string;
  milestones?: {
    stripeConnect?: {
      current: string;
      history?: { status: string; at: number }[];
    };
    uberDirect?: {
      current: string;
      history?: { status: string; at: number }[];
    };
  };
};

/** When a composite milestone last ENTERED `pending_kyc` (latest such history entry), or null. */
function pendingSince(
  milestone:
    | { current: string; history?: { status: string; at: number }[] }
    | undefined,
): number | null {
  if (milestone === undefined || milestone.current !== "pending_kyc")
    return null;
  const entries = (milestone.history ?? []).filter(
    (h) => h.status === "pending_kyc",
  );
  if (entries.length === 0) return null;
  return entries.reduce(
    (latest, h) => (h.at > latest ? h.at : latest),
    entries[0].at,
  );
}

/**
 * Prospects whose Stripe or Uber Direct KYC has been `pending_kyc` for STRICTLY
 * more than `thresholdMs` at `nowMs` (PRD 70 §3.8: KYC pending > 48 h). The
 * "since" instant is the latest history transition INTO `pending_kyc`. Pure.
 */
export function detectKycPendingIncidents(
  prospects: KycScanProspect[],
  nowMs: number,
  thresholdMs: number,
): Incident[] {
  const out: Incident[] = [];
  const providers: {
    key: KycProvider;
    field: "stripeConnect" | "uberDirect";
  }[] = [
    { key: "stripe", field: "stripeConnect" },
    { key: "uber_direct", field: "uberDirect" },
  ];
  for (const prospect of prospects) {
    for (const { key, field } of providers) {
      const since = pendingSince(prospect.milestones?.[field]);
      if (since !== null && nowMs - since > thresholdMs) {
        out.push({
          kind: "kyc_pending",
          provider: key,
          prospectId: prospect._id,
          prospectName: prospect.name,
          pendingSinceMs: since,
        });
      }
    }
  }
  return out;
}

/** The minimal order shape the paid-no-course detector needs (pure-testable). */
export type PaidScanOrder = {
  _id: string;
  mode: "delivery" | "pickup";
  paidAt?: number;
  tenantId?: string;
};

/** The minimal delivery shape (order ref + whether an Uber course exists). */
export type CourseScanDelivery = { orderId: string; uberDeliveryId?: string };

/**
 * Paid `delivery` orders past the `graceMs` window with NO Uber course created
 * (PRD 70 §3.8: cmd payée sans course Uber). An order is covered iff some
 * delivery row references it AND carries a `uberDeliveryId`. `pickup` (click &
 * collect) and unpaid orders never qualify. `graceMs` is supplied by the caller —
 * no magic constant is baked in here (the dispatch delay is a 2.6 concern). Pure.
 */
export function detectPaidOrdersWithoutCourse(
  orders: PaidScanOrder[],
  deliveries: CourseScanDelivery[],
  nowMs: number,
  graceMs: number,
): Incident[] {
  const courseByOrder = new Set(
    deliveries
      .filter((d) => d.uberDeliveryId !== undefined && d.uberDeliveryId !== "")
      .map((d) => d.orderId),
  );
  const out: Incident[] = [];
  for (const order of orders) {
    if (order.mode !== "delivery") continue;
    if (order.paidAt === undefined) continue;
    if (nowMs - order.paidAt < graceMs) continue;
    if (courseByOrder.has(order._id)) continue;
    out.push({
      kind: "paid_no_course",
      orderId: order._id,
      tenantId: order.tenantId,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Combinator + Slack text (pure).
// ---------------------------------------------------------------------------

/** Everything the combined scan needs, as plain data (no I/O). */
export type ScanInput = {
  now: number;
  webhookSamples: WebhookLatencySample[];
  prospects: KycScanProspect[];
  orders: PaidScanOrder[];
  deliveries: CourseScanDelivery[];
  paidNoCourseGraceMs: number;
};

/** Run the three detectors over the given data and return their union. Pure. */
export function scanIncidents(input: ScanInput): Incident[] {
  return [
    ...detectWebhookLatencyIncidents(
      input.webhookSamples,
      WEBHOOK_LATENCY_THRESHOLD_MS,
    ),
    ...detectKycPendingIncidents(
      input.prospects,
      input.now,
      KYC_PENDING_THRESHOLD_MS,
    ),
    ...detectPaidOrdersWithoutCourse(
      input.orders,
      input.deliveries,
      input.now,
      input.paidNoCourseGraceMs,
    ),
  ];
}

/** A single human-readable Slack line for one incident. Pure. */
export function formatIncidentSlackText(incident: Incident): string {
  switch (incident.kind) {
    case "webhook_latency":
      return `:rotating_light: Webhook *${incident.provider}* latence ${Math.round(
        incident.latencyMs / 1000,
      )} s (> ${WEBHOOK_LATENCY_THRESHOLD_MS / 1000} s) — event \`${incident.externalId}\``;
    case "kyc_pending": {
      const hours = Math.floor(
        (Date.now() - incident.pendingSinceMs) / 3_600_000,
      );
      const who = incident.prospectName ?? incident.prospectId;
      const provider =
        incident.provider === "stripe" ? "Stripe" : "Uber Direct";
      return `:hourglass: KYC ${provider} en attente depuis ~${hours} h — *${who}* (> 48 h)`;
    }
    case "paid_no_course":
      return `:package: Commande payée sans course Uber créée — order \`${incident.orderId}\`${
        incident.tenantId ? ` (tenant \`${incident.tenantId}\`)` : ""
      }`;
  }
}

// ---------------------------------------------------------------------------
// Feature flags for the not-yet-wired sources (2.5 / 2.6).
// ---------------------------------------------------------------------------

const flagOn = (name: string): boolean => process.env[name] === "true";

// ---------------------------------------------------------------------------
// System-side read (no actor): gather live data through the tenancy seams and
// run the detectors. Used by BOTH the root `previewIncidents` query and the
// `runMonitoringScan` cron's internal query.
// ---------------------------------------------------------------------------

/**
 * Read the live monitoring incidents at `now`. Sources not yet available
 * (2.5/2.6) feed an empty list behind their feature flag, so the scan never
 * false-fires before its source lands. Reads ONLY through the sanctioned tenancy
 * store seams (`no-untenanted-query`).
 */
async function readIncidents(ctx: QueryCtx, now: number): Promise<Incident[]> {
  // KYC pending (live source, 2.9-A milestones).
  const prospects = await listProspects(ctx);

  // Paid-order-without-course (source owned by 2.5/2.6 — feature-flagged OFF by
  // default, so nothing fires until that linkage is wired). `graceMs` (the delay
  // before a still-courseless paid order is treated as an incident) is owned by
  // 2.6 and read from env when that chantier enables the flag — NOT a constant
  // invented here in the live path.
  let orders: PaidScanOrder[] = [];
  let deliveries: CourseScanDelivery[] = [];
  const paidNoCourseGraceMs = Number(
    process.env.MONITORING_PAID_NO_COURSE_GRACE_MS ?? 0,
  );
  if (flagOn("MONITORING_PAID_NO_COURSE_ENABLED")) {
    const tenantIds = await listAllTenantIds(ctx);
    const allOrders: Doc<"orders">[] = [];
    const allDeliveries: Doc<"deliveries">[] = [];
    for (const tenantId of tenantIds) {
      allOrders.push(...(await listTenantOrders(ctx, tenantId)));
      allDeliveries.push(...(await listTenantDeliveries(ctx, tenantId)));
    }
    orders = allOrders.map((o) => ({
      _id: o._id,
      mode: o.mode,
      paidAt: o.paidAt,
      tenantId: o.tenantId,
    }));
    deliveries = allDeliveries.map((d) => ({
      orderId: d.orderId,
      uberDeliveryId: d.uberDeliveryId,
    }));
  }

  // Webhook latency (source owned by 2.5/2.6 — no latency tracking exists yet, so
  // there are no samples to scan; the pure `detectWebhookLatencyIncidents` is
  // tested in isolation and the live source plugs in additively when 2.5/2.6
  // wire it behind `MONITORING_WEBHOOK_LATENCY_ENABLED`).
  const webhookSamples: WebhookLatencySample[] = [];

  return scanIncidents({
    now,
    webhookSamples,
    prospects: prospects as KycScanProspect[],
    orders,
    deliveries,
    paidNoCourseGraceMs,
  });
}

// ---------------------------------------------------------------------------
// Convex surface.
// ---------------------------------------------------------------------------

/**
 * Root-only preview of the current ops incidents (PRD 70 §3.8). Backs the front
 * Train B monitoring dashboard and is the on-demand read; `runMonitoringScan` is
 * the scheduled alerting path. `kbAdminQuery` → any non-root actor is refused.
 */
export const previewIncidents = kbAdminQuery({
  args: {},
  handler: async (ctx): Promise<Incident[]> => readIncidents(ctx, Date.now()),
});

/**
 * System-side incident read for the cron action (no actor). Internal — never
 * exposed publicly; the actor-gated public read is `previewIncidents`.
 */
export const collectIncidents = internalQuery({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }): Promise<Incident[]> =>
    readIncidents(ctx, now ?? Date.now()),
});

/**
 * The scheduled monitoring scan (PRD 70 §3.8): read the current incidents and
 * post ONE Slack ops alert per incident to the configured webhook. A SYSTEM job
 * (no actor), wired from `crons.ts`. No-ops (no fetch, no throw) when no incident
 * fires OR when `SLACK_OPS_WEBHOOK_URL` is not configured. Returns how many
 * alerts were posted (for logging / tests).
 */
export const runMonitoringScan = internalAction({
  args: { now: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, { now }): Promise<number> => {
    const webhookUrl = process.env.SLACK_OPS_WEBHOOK_URL;
    const incidents: Incident[] = await ctx.runQuery(
      internal.lib.admin.monitoring.collectIncidents,
      { now },
    );
    if (incidents.length === 0) return 0;
    if (!webhookUrl) {
      // Detections exist but ops Slack is not wired — log and skip (no throw, so
      // a missing env never breaks the scheduled scan).
      console.warn(
        `[monitoring] ${incidents.length} incident(s) but SLACK_OPS_WEBHOOK_URL is unset`,
      );
      return 0;
    }
    let posted = 0;
    for (const incident of incidents) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: formatIncidentSlackText(incident) }),
      });
      posted += 1;
    }
    return posted;
  },
});
