import { describe, expect, it } from "vitest";
import {
  AUTO_EXPIRED_24H_THRESHOLD,
  AUTO_EXPIRED_WINDOW_MS,
  KYC_PENDING_THRESHOLD_MS,
  type Incident,
  WEBHOOK_LATENCY_THRESHOLD_MS,
  detectAutoExpiredBursts,
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

describe("#415 auto_expired_burst threshold (PRD 20 §8 / kb-orders CONTEXT)", () => {
  // PRD 20 §8 (KB Admin onglet Manquées): « alerte ops si auto_expired/jour
  // dépasse un seuil (~3-5 par défaut) ». We pin the low end of that
  // documented range (3) so a future bump can be argued explicitly. NOT
  // invented — the V1 value lives as a constant so it's tunable without
  // a schema change (issue body, #415).
  it("auto_expired daily burst threshold is 3 (PRD 20 §8 — low end of 3-5)", () => {
    expect(AUTO_EXPIRED_24H_THRESHOLD).toBe(3);
  });
  it("rolling window for the burst detection is 24 h (the « par jour » in PRD 20 §8)", () => {
    expect(AUTO_EXPIRED_WINDOW_MS).toBe(24 * HOUR);
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
      {
        kind: "auto_expired_burst",
        tenantId: "t_4",
        tenantName: "Thai Street",
        count: 5,
        windowMs: AUTO_EXPIRED_WINDOW_MS,
        thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
      },
    ];
    for (const incident of cases) {
      const text = formatIncidentSlackText(incident);
      expect(text).toBeTypeOf("string");
      expect(text.length).toBeGreaterThan(0);
    }
    expect(formatIncidentSlackText(cases[0])).toContain("stripe");
    expect(formatIncidentSlackText(cases[1])).toContain("Le Resto");
    expect(formatIncidentSlackText(cases[2])).toContain("o_1");
    // #415 — the auto_expired_burst Slack line surfaces the tenant + the count
    // so the ops dispatcher knows WHICH resto is silently dropping cmds and
    // HOW MANY in the trailing 24 h window. We accept either the tenant name
    // or the tenantId when the name is absent (mirrors the KYC formatter's
    // « name ?? id » fallback).
    expect(formatIncidentSlackText(cases[3])).toContain("Thai Street");
    expect(formatIncidentSlackText(cases[3])).toContain("5");
  });
});

describe("#415 detectAutoExpiredBursts — auto_expired/24 h > seuil par tenant", () => {
  // PRD 20 §8 + kb-orders CONTEXT « Cmd manquée » : un resto qui auto_expire
  // chroniquement des cmds = signal opérationnel (tablette HS, Khan AFK).
  // Le détecteur agrège par tenant les cmds passées en `auto_expired` dans
  // la fenêtre glissante de 24 h et émet UNE incidence par tenant qui DÉPASSE
  // le seuil (strictement, pas ≥ — cohérent avec les autres détecteurs).
  // Pur : pas de DB, pas de ctx ; on lui passe la liste des cmds expirées.

  type AutoExpiredOrder = {
    _id: string;
    tenantId: string;
    autoExpiredAt: number;
  };

  it("flags a tenant with strictly more than the threshold in the window", () => {
    const tenantId = "t_overflow";
    const recent = NOW - HOUR; // well inside the 24 h window
    const orders: AutoExpiredOrder[] = [
      { _id: "o1", tenantId, autoExpiredAt: recent },
      { _id: "o2", tenantId, autoExpiredAt: recent - HOUR },
      { _id: "o3", tenantId, autoExpiredAt: recent - 2 * HOUR },
      { _id: "o4", tenantId, autoExpiredAt: recent - 3 * HOUR }, // 4 > 3 = burst
    ];
    const incidents = detectAutoExpiredBursts({
      orders,
      tenantNames: { [tenantId]: "Overflow Resto" },
      now: NOW,
      windowMs: AUTO_EXPIRED_WINDOW_MS,
      thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: "auto_expired_burst",
      tenantId,
      tenantName: "Overflow Resto",
      count: 4,
      thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
      windowMs: AUTO_EXPIRED_WINDOW_MS,
    });
  });

  it("does NOT flag a tenant at exactly the threshold (strict >)", () => {
    const tenantId = "t_at_threshold";
    const recent = NOW - HOUR;
    const orders: AutoExpiredOrder[] = [
      { _id: "o1", tenantId, autoExpiredAt: recent },
      { _id: "o2", tenantId, autoExpiredAt: recent - HOUR },
      { _id: "o3", tenantId, autoExpiredAt: recent - 2 * HOUR }, // exactly 3
    ];
    expect(
      detectAutoExpiredBursts({
        orders,
        tenantNames: {},
        now: NOW,
        windowMs: AUTO_EXPIRED_WINDOW_MS,
        thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
      }),
    ).toEqual([]);
  });

  it("ignores expirations older than the window (older than 24 h)", () => {
    const tenantId = "t_olderhalf";
    const recent = NOW - HOUR;
    const stale = NOW - 25 * HOUR; // before the rolling window
    const orders: AutoExpiredOrder[] = [
      { _id: "o1", tenantId, autoExpiredAt: recent },
      { _id: "o2", tenantId, autoExpiredAt: stale },
      { _id: "o3", tenantId, autoExpiredAt: stale - HOUR },
      { _id: "o4", tenantId, autoExpiredAt: stale - 2 * HOUR },
    ];
    expect(
      detectAutoExpiredBursts({
        orders,
        tenantNames: {},
        now: NOW,
        windowMs: AUTO_EXPIRED_WINDOW_MS,
        thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
      }),
    ).toEqual([]);
  });

  it("aggregates PER TENANT — one tenant in burst doesn't drag another below threshold", () => {
    const recent = NOW - HOUR;
    const orders: AutoExpiredOrder[] = [
      // tenant A: 4 expirations → burst
      { _id: "a1", tenantId: "t_A", autoExpiredAt: recent },
      { _id: "a2", tenantId: "t_A", autoExpiredAt: recent - HOUR },
      { _id: "a3", tenantId: "t_A", autoExpiredAt: recent - 2 * HOUR },
      { _id: "a4", tenantId: "t_A", autoExpiredAt: recent - 3 * HOUR },
      // tenant B: 2 expirations → healthy
      { _id: "b1", tenantId: "t_B", autoExpiredAt: recent },
      { _id: "b2", tenantId: "t_B", autoExpiredAt: recent - HOUR },
    ];
    const incidents = detectAutoExpiredBursts({
      orders,
      tenantNames: { t_A: "Resto A", t_B: "Resto B" },
      now: NOW,
      windowMs: AUTO_EXPIRED_WINDOW_MS,
      thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: "auto_expired_burst",
      tenantId: "t_A",
      count: 4,
    });
  });

  it("returns [] for an empty input (no tenant exceeds threshold by definition)", () => {
    expect(
      detectAutoExpiredBursts({
        orders: [],
        tenantNames: {},
        now: NOW,
        windowMs: AUTO_EXPIRED_WINDOW_MS,
        thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
      }),
    ).toEqual([]);
  });

  it("falls back to tenantId when the tenant name is absent in the map", () => {
    const tenantId = "t_noname";
    const recent = NOW - HOUR;
    const orders: AutoExpiredOrder[] = [
      { _id: "o1", tenantId, autoExpiredAt: recent },
      { _id: "o2", tenantId, autoExpiredAt: recent - HOUR },
      { _id: "o3", tenantId, autoExpiredAt: recent - 2 * HOUR },
      { _id: "o4", tenantId, autoExpiredAt: recent - 3 * HOUR },
    ];
    const incidents = detectAutoExpiredBursts({
      orders,
      tenantNames: {},
      now: NOW,
      windowMs: AUTO_EXPIRED_WINDOW_MS,
      thresholdCount: AUTO_EXPIRED_24H_THRESHOLD,
    });
    expect(incidents).toHaveLength(1);
    // Name absent → field is undefined so the row presenter falls back to
    // the tenantId; we pin both shapes so a future refactor that swaps to
    // a magic « —Anonymous— » string surfaces here loudly.
    expect(incidents[0]).toMatchObject({
      kind: "auto_expired_burst",
      tenantId,
    });
    expect(
      (incidents[0] as { tenantName?: string }).tenantName,
    ).toBeUndefined();
  });
});

describe("2.9-F scanIncidents — combine the detectors over given data", () => {
  it("returns the union of all detected incidents (#415 adds auto_expired_burst)", () => {
    const recent = NOW - HOUR;
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
      autoExpiredOrders: [
        { _id: "x1", tenantId: "t_burst", autoExpiredAt: recent },
        { _id: "x2", tenantId: "t_burst", autoExpiredAt: recent - HOUR },
        { _id: "x3", tenantId: "t_burst", autoExpiredAt: recent - 2 * HOUR },
        { _id: "x4", tenantId: "t_burst", autoExpiredAt: recent - 3 * HOUR },
      ],
      tenantNames: { t_burst: "Burst Resto" },
    });
    const kinds = incidents.map((i) => i.kind).sort();
    expect(kinds).toEqual([
      "auto_expired_burst",
      "kyc_pending",
      "paid_no_course",
      "webhook_latency",
    ]);
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
        autoExpiredOrders: [],
        tenantNames: {},
      }),
    ).toEqual([]);
  });
});
