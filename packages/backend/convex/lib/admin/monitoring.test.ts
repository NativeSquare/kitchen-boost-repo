import { describe, expect, it } from "vitest";
import {
  KYC_PENDING_THRESHOLD_MS,
  type Incident,
  WEBHOOK_LATENCY_THRESHOLD_MS,
  detectKycPendingIncidents,
  detectPaidOrdersWithoutCourse,
  detectWebhookLatencyIncidents,
  formatIncidentSlackText,
  scanIncidents,
} from "./monitoring";

/**
 * 2.9-F — PURE monitoring detection logic (PRD 70 §3.8, kb-admin CONTEXT
 * "Monitoring incidents"), written BEFORE the implementation (TDD red).
 *
 * The whole detection layer is pure (no DB, no ctx): given a CONDITION it
 * produces an INCIDENT (the acceptance-criteria "testable in isolation"). The
 * Convex wiring (scan over the tenancy seams + the Slack `internalAction`) is
 * covered separately by `monitoringScan.test.ts`; here we pin the thresholds and
 * the three detectors + the Slack text formatter, with no I/O at all.
 */

const NOW = Date.UTC(2026, 4, 26, 12, 0, 0); // 2026-05-26T12:00:00Z (memory date)
const HOUR = 60 * 60 * 1000;

describe("2.9-F thresholds (PRD 70 §3.8 — not invented)", () => {
  it("webhook latency threshold is 30 s", () => {
    expect(WEBHOOK_LATENCY_THRESHOLD_MS).toBe(30_000);
  });
  it("KYC pending threshold is 48 h", () => {
    expect(KYC_PENDING_THRESHOLD_MS).toBe(48 * HOUR);
  });
});

describe("2.9-F detectWebhookLatencyIncidents — webhook latence > threshold", () => {
  it("flags a sample strictly over the threshold, leaves an at-threshold one", () => {
    const incidents = detectWebhookLatencyIncidents(
      [
        { provider: "stripe", externalId: "evt_slow", latencyMs: 31_000 },
        { provider: "uber_direct", externalId: "evt_edge", latencyMs: 30_000 },
        { provider: "stripe", externalId: "evt_fast", latencyMs: 1_200 },
      ],
      WEBHOOK_LATENCY_THRESHOLD_MS,
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: "webhook_latency",
      provider: "stripe",
      externalId: "evt_slow",
      latencyMs: 31_000,
    });
  });

  it("returns nothing for an empty sample set (no data source yet)", () => {
    expect(
      detectWebhookLatencyIncidents([], WEBHOOK_LATENCY_THRESHOLD_MS),
    ).toEqual([]);
  });
});

describe("2.9-F detectKycPendingIncidents — tenant KYC pending > 48 h", () => {
  const prospectPendingSince = (id: string, enteredAt: number) => ({
    _id: id,
    name: `Resto ${id}`,
    milestones: {
      stripeConnect: {
        current: "pending_kyc" as const,
        history: [
          { status: "not_started" as const, at: enteredAt - HOUR },
          { status: "pending_kyc" as const, at: enteredAt },
        ],
      },
    },
  });

  it("flags a prospect pending KYC for strictly more than 48 h", () => {
    const stale = prospectPendingSince("p_stale", NOW - 49 * HOUR);
    const incidents = detectKycPendingIncidents(
      [stale],
      NOW,
      KYC_PENDING_THRESHOLD_MS,
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: "kyc_pending",
      provider: "stripe",
      prospectId: "p_stale",
      pendingSinceMs: NOW - 49 * HOUR,
    });
  });

  it("does NOT flag one pending for exactly 48 h or less", () => {
    const fresh = prospectPendingSince("p_fresh", NOW - 48 * HOUR);
    const recent = prospectPendingSince("p_recent", NOW - HOUR);
    expect(
      detectKycPendingIncidents([fresh, recent], NOW, KYC_PENDING_THRESHOLD_MS),
    ).toEqual([]);
  });

  it("ignores a prospect whose KYC is no longer pending (verified)", () => {
    const verified = {
      _id: "p_ok",
      name: "Resto OK",
      milestones: {
        stripeConnect: {
          current: "verified" as const,
          history: [
            { status: "pending_kyc" as const, at: NOW - 100 * HOUR },
            { status: "verified" as const, at: NOW - 90 * HOUR },
          ],
        },
      },
    };
    expect(
      detectKycPendingIncidents([verified], NOW, KYC_PENDING_THRESHOLD_MS),
    ).toEqual([]);
  });

  it("flags an Uber Direct KYC pending > 48 h too", () => {
    const stale = {
      _id: "p_uber",
      name: "Resto Uber",
      milestones: {
        uberDirect: {
          current: "pending_kyc" as const,
          history: [{ status: "pending_kyc" as const, at: NOW - 72 * HOUR }],
        },
      },
    };
    const incidents = detectKycPendingIncidents(
      [stale],
      NOW,
      KYC_PENDING_THRESHOLD_MS,
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: "kyc_pending",
      provider: "uber_direct",
      prospectId: "p_uber",
    });
  });

  it("handles a prospect with no milestones at all", () => {
    expect(
      detectKycPendingIncidents(
        [{ _id: "p_bare", name: "Bare" }],
        NOW,
        KYC_PENDING_THRESHOLD_MS,
      ),
    ).toEqual([]);
  });
});

describe("2.9-F detectPaidOrdersWithoutCourse — cmd payée sans course Uber", () => {
  const paidDeliveryOrder = (id: string, paidAt: number) => ({
    _id: id,
    mode: "delivery" as const,
    paidAt,
  });
  const GRACE = 5 * 60 * 1000; // explicit grace passed by the caller (not invented in prod)

  it("flags a paid delivery order past the grace with no uber course", () => {
    const order = paidDeliveryOrder("o_orphan", NOW - 10 * 60 * 1000);
    const incidents = detectPaidOrdersWithoutCourse(
      [order],
      [], // no delivery row with a uberDeliveryId for this order
      NOW,
      GRACE,
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: "paid_no_course",
      orderId: "o_orphan",
    });
  });

  it("does NOT flag when a delivery course exists for the order", () => {
    const order = paidDeliveryOrder("o_ok", NOW - 10 * 60 * 1000);
    const incidents = detectPaidOrdersWithoutCourse(
      [order],
      [{ orderId: "o_ok", uberDeliveryId: "del_123" }],
      NOW,
      GRACE,
    );
    expect(incidents).toEqual([]);
  });

  it("does NOT flag within the grace window (course may still be in flight)", () => {
    const justPaid = paidDeliveryOrder("o_fresh", NOW - 60 * 1000);
    expect(detectPaidOrdersWithoutCourse([justPaid], [], NOW, GRACE)).toEqual(
      [],
    );
  });

  it("ignores pickup (click & collect) orders — they never get an uber course", () => {
    const pickup = {
      _id: "o_pickup",
      mode: "pickup" as const,
      paidAt: NOW - HOUR,
    };
    expect(detectPaidOrdersWithoutCourse([pickup], [], NOW, GRACE)).toEqual([]);
  });

  it("ignores unpaid orders", () => {
    const unpaid = { _id: "o_unpaid", mode: "delivery" as const };
    expect(detectPaidOrdersWithoutCourse([unpaid], [], NOW, GRACE)).toEqual([]);
  });

  it("does NOT flag when a delivery row exists but has no uber course yet within grace-less link", () => {
    // A delivery row exists for the order BUT no uberDeliveryId → still orphan.
    const order = paidDeliveryOrder("o_pending", NOW - 10 * 60 * 1000);
    const incidents = detectPaidOrdersWithoutCourse(
      [order],
      [{ orderId: "o_pending", uberDeliveryId: undefined }],
      NOW,
      GRACE,
    );
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: "paid_no_course",
      orderId: "o_pending",
    });
  });
});

describe("2.9-F formatIncidentSlackText — one human line per incident", () => {
  it("renders each incident kind", () => {
    const cases: Incident[] = [
      {
        kind: "webhook_latency",
        provider: "stripe",
        externalId: "evt_1",
        latencyMs: 42_000,
      },
      {
        kind: "kyc_pending",
        provider: "uber_direct",
        prospectId: "p_1",
        prospectName: "Le Resto",
        pendingSinceMs: NOW - 72 * HOUR,
      },
      { kind: "paid_no_course", orderId: "o_1", tenantId: "t_1" },
    ];
    for (const incident of cases) {
      const text = formatIncidentSlackText(incident);
      expect(text).toBeTypeOf("string");
      expect(text.length).toBeGreaterThan(0);
    }
    expect(formatIncidentSlackText(cases[0])).toContain("stripe");
    expect(formatIncidentSlackText(cases[1])).toContain("Le Resto");
    expect(formatIncidentSlackText(cases[2])).toContain("o_1");
  });
});

describe("2.9-F scanIncidents — combine the three detectors over given data", () => {
  it("returns the union of all detected incidents", () => {
    const incidents = scanIncidents({
      now: NOW,
      webhookSamples: [
        { provider: "stripe", externalId: "evt_slow", latencyMs: 99_000 },
      ],
      prospects: [
        {
          _id: "p_stale",
          name: "Stale",
          milestones: {
            stripeConnect: {
              current: "pending_kyc",
              history: [{ status: "pending_kyc", at: NOW - 60 * HOUR }],
            },
          },
        },
      ],
      orders: [{ _id: "o_orphan", mode: "delivery", paidAt: NOW - HOUR }],
      deliveries: [],
      paidNoCourseGraceMs: 5 * 60 * 1000,
    });
    const kinds = incidents.map((i) => i.kind).sort();
    expect(kinds).toEqual(["kyc_pending", "paid_no_course", "webhook_latency"]);
  });

  it("is empty when nothing breaches (and the latency source is absent)", () => {
    expect(
      scanIncidents({
        now: NOW,
        webhookSamples: [],
        prospects: [],
        orders: [],
        deliveries: [],
        paidNoCourseGraceMs: 5 * 60 * 1000,
      }),
    ).toEqual([]);
  });
});
