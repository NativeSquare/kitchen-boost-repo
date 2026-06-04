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
  listAllTenants,
  listProspects,
  listTenantDeliveries,
  listTenantOrders,
  listTenantOrdersByStatus,
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

/**
 * #415 — `auto_expired` daily burst threshold per tenant (PRD 20 §8: « alerte
 * ops si auto_expired/jour > seuil ~3-5 par défaut »). Low end of the
 * documented range so the alert fires earlier (ops decides to relax it later
 * — a bumped constant is a one-line change, no schema migration). The
 * constant is exported so the front (drill-down detail panel) can render
 * « seuil 3 » alongside the count.
 */
export const AUTO_EXPIRED_24H_THRESHOLD = 3;

/**
 * #415 — Rolling 24 h window over which auto_expired bursts are counted
 * (PRD 20 §8 « par jour »). A constant rather than `Date.now() - 1 jour` so
 * a test can re-pin it explicitly.
 */
export const AUTO_EXPIRED_WINDOW_MS = 24 * 60 * 60 * 1000;

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

/** A detected ops incident — one of the four PRD 70 §3.8 / PRD 20 §8 kinds. */
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
  | { kind: "paid_no_course"; orderId: string; tenantId?: string }
  | {
      /**
       * #415 — A tenant whose `auto_expired` count over the trailing
       * `windowMs` exceeds `thresholdCount` (PRD 20 §8 / ADR 0016
       * « signaux orthogonaux »). Operational alert: the resto is
       * silently dropping cmds (tablette HS / Khan AFK / push OS-bloqué)
       * — ops nudges the gérant before the burst becomes a churn risk.
       */
      kind: "auto_expired_burst";
      tenantId: string;
      tenantName?: string;
      count: number;
      windowMs: number;
      thresholdCount: number;
    };

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
  const entries = (milestone.history ?? [])
    .filter((h) => h.status === "pending_kyc")
    .map((h) => h.at);
  return entries.length === 0 ? null : Math.max(...entries);
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
// #415 — auto_expired daily burst per tenant (PRD 20 §8 + ADR 0016).
// ---------------------------------------------------------------------------

/** The minimal `auto_expired` order shape the burst detector needs (pure-testable). */
export type AutoExpiredScanOrder = {
  _id: string;
  tenantId: string;
  autoExpiredAt: number;
};

/** Per-detector input — `now` + the orders to scan + the tenant display names. */
export type AutoExpiredBurstScanInput = {
  /** Orders whose status is `auto_expired` (caller filters; we don't re-check). */
  orders: AutoExpiredScanOrder[];
  /** Optional `tenantId → display name` lookup for the Slack alert + UI. */
  tenantNames: Record<string, string>;
  /** Reference instant (epoch ms) — orders older than `now - windowMs` are ignored. */
  now: number;
  /** Rolling window (typically `AUTO_EXPIRED_WINDOW_MS` = 24 h). */
  windowMs: number;
  /** Threshold (typically `AUTO_EXPIRED_24H_THRESHOLD` = 3). Strictly greater fires. */
  thresholdCount: number;
};

/**
 * Tenants whose `auto_expired` order count over the trailing `windowMs` is
 * STRICTLY greater than `thresholdCount`. One `Incident` per tenant — counts
 * are aggregated per tenant, not per order, so a `kb_admin` looking at the
 * list reads « tenant X = 5 cmds manquées 24 h » in one row.
 *
 * Pure: no DB, no ctx, no `Date.now()`. The caller (`readIncidents`) reads
 * the live orders through the sanctioned tenancy seam and hands them here.
 * The « at-threshold » case is healthy (strict > matches the other
 * detectors' « > 30 s » / « > 48 h » semantics).
 */
export function detectAutoExpiredBursts(
  input: AutoExpiredBurstScanInput,
): Incident[] {
  const cutoff = input.now - input.windowMs;
  // Aggregate counts per tenant in one pass over the orders.
  const counts = new Map<string, number>();
  for (const order of input.orders) {
    if (order.autoExpiredAt < cutoff) continue;
    counts.set(order.tenantId, (counts.get(order.tenantId) ?? 0) + 1);
  }
  // Emit an incident per tenant whose count strictly exceeds the threshold.
  // Iteration order = first-seen tenant order in `input.orders` (Map preserves
  // insertion order in JS — handy for the Slack alert to read tenants in the
  // same order they appeared on the wire).
  const incidents: Incident[] = [];
  for (const [tenantId, count] of counts) {
    if (count <= input.thresholdCount) continue;
    const tenantName = input.tenantNames[tenantId];
    incidents.push({
      kind: "auto_expired_burst",
      tenantId,
      // Drop the field entirely when absent so the row presenter falls back
      // to `tenantId` (same convention as `kyc_pending.prospectName`).
      ...(tenantName !== undefined ? { tenantName } : {}),
      count,
      windowMs: input.windowMs,
      thresholdCount: input.thresholdCount,
    });
  }
  return incidents;
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
  /** #415 — `auto_expired` orders to scan for the daily burst detector. */
  autoExpiredOrders: AutoExpiredScanOrder[];
  /** #415 — `tenantId → display name` lookup for the burst alert + UI. */
  tenantNames: Record<string, string>;
};

/** Run all detectors over the given data and return their union. Pure. */
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
    ...detectAutoExpiredBursts({
      orders: input.autoExpiredOrders,
      tenantNames: input.tenantNames,
      now: input.now,
      windowMs: AUTO_EXPIRED_WINDOW_MS,
      thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
    }),
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
    case "auto_expired_burst": {
      const who = incident.tenantName ?? incident.tenantId;
      const windowHours = Math.round(incident.windowMs / 3_600_000);
      return `:warning: *${who}* a auto_expired ${incident.count} cmd(s) en ${windowHours} h — > seuil ${incident.thresholdCount}`;
    }
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

  // #415 — `auto_expired` orders within the trailing 24 h, grouped per tenant
  // downstream by `detectAutoExpiredBursts`. We read tenant-by-tenant via the
  // sanctioned `listTenantOrdersByStatus` seam (`by_tenant_status` index), so
  // an off-burst tenant pulls a small list, and we union them — the burst
  // detector is a pure aggregator. Tenant names are denormalised once for the
  // Slack/UI label.
  const tenants = await listAllTenants(ctx);
  const tenantNames: Record<string, string> = {};
  const autoExpiredOrders: AutoExpiredScanOrder[] = [];
  for (const tenant of tenants) {
    tenantNames[tenant._id] = tenant.name;
    const rows = await listTenantOrdersByStatus(
      ctx,
      tenant._id,
      "auto_expired",
    );
    for (const row of rows) {
      // The detector trims the window itself; we only forward rows that have
      // the timestamp set (auto_expired with a missing `autoExpiredAt` is a
      // backend invariant violation — drop defensively, not silently).
      if (row.autoExpiredAt === undefined) continue;
      autoExpiredOrders.push({
        _id: row._id,
        tenantId: row.tenantId,
        autoExpiredAt: row.autoExpiredAt,
      });
    }
  }

  return scanIncidents({
    now,
    webhookSamples,
    prospects: prospects as KycScanProspect[],
    orders,
    deliveries,
    paidNoCourseGraceMs,
    autoExpiredOrders,
    tenantNames,
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
