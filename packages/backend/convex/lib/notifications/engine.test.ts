import { describe, expect, it } from "vitest";
import {
  type ChannelAvailability,
  type PlannedSend,
  channelAvailabilityFrom,
  planTransactionalSends,
} from "./engine";

/**
 * 2.7-B — the PURE Notifications engine, written BEFORE the module (TDD red).
 *
 * `planTransactionalSends(trigger, availability)` takes a business event + the
 * customer's per-channel availability (READ from 2.1 Customer Data, ADR 0012 —
 * never duplicated here) and returns the LIST of effective sends, each marked with
 * its category. NO network I/O: the concrete transport (web-push route #54, APNs
 * #71, email) is a later slice; this slice decides WHAT to send WHERE. Testable in
 * isolation exactly like `packages/shared/pricing`.
 *
 * Routing rules (PRD 80 §1):
 *  - Archive (order_paid / refund / uber_course_failed): wallet_push + web_push +
 *    email — a multi-channel WRITTEN trace; every available channel fires.
 *  - Temps-réel (dropoff / delivered / pickup_ready C&C): wallet_push + web_push.
 *  - Info statut (received_kitchen): wallet_silent only. courier_pickup adds a
 *    light web_push.
 *  - SMS extreme fallback (triggers 1/4/6/7 ONLY): emitted ONLY when the customer
 *    has NEITHER wallet NOR web-push (PRD 80 §1 footnote / edge case). It is
 *    PLANNED but marked `sendable: false` — no SMS provider is wired V1 (PRD 80 §3
 *    "SMS = extreme fallback", Q80-Q4 provider open).
 *  - A channel the customer is not reachable on is SKIPPED.
 */

/** A fully-reachable customer (wallet + web-push enrolled, email + phone). */
const fullyReachable: ChannelAvailability = {
  walletPush: true,
  webPush: true,
  walletSilent: true,
  email: true,
  sms: true,
};

/** Channels the planned sends went out on, in order. */
function channels(sends: PlannedSend[]): string[] {
  return sends.map((s) => s.channel);
}

describe("2.7-B engine — channelAvailabilityFrom (reads 2.1 reachability, ADR 0012)", () => {
  it("derives wallet/web-push availability from the per-channel enrollment status", () => {
    const a = channelAvailabilityFrom({
      email: "x@y.fr",
      phone: "+33600000000",
      pushEnrollment: {
        walletStatus: "enrolled",
        webPushStatus: "not_enrolled",
      },
    });
    expect(a.walletPush).toBe(true);
    expect(a.walletSilent).toBe(true); // a Wallet pass enables the silent update
    expect(a.webPush).toBe(false);
    expect(a.email).toBe(true);
    expect(a.sms).toBe(true);
  });

  it("treats a revoked / absent enrollment as unavailable on that channel", () => {
    const a = channelAvailabilityFrom({
      pushEnrollment: { walletStatus: "revoked", webPushStatus: "enrolled" },
    });
    expect(a.walletPush).toBe(false);
    expect(a.walletSilent).toBe(false);
    expect(a.webPush).toBe(true);
    expect(a.email).toBe(false);
    expect(a.sms).toBe(false);
  });

  it("an anonymised customer (no fields) is reachable on nothing", () => {
    const a = channelAvailabilityFrom({});
    expect(a).toEqual({
      walletPush: false,
      webPush: false,
      walletSilent: false,
      email: false,
      sms: false,
    });
  });
});

describe("2.7-B engine — Archive: multi-channel written trace", () => {
  it("fires wallet_push + web_push + email when all are available (order_paid)", () => {
    const sends = planTransactionalSends("order_paid", fullyReachable);
    expect(channels(sends)).toEqual(["wallet_push", "web_push", "email"]);
    expect(sends.every((s) => s.category === "archive")).toBe(true);
    expect(sends.every((s) => s.sendable)).toBe(true);
  });

  it("skips a channel the customer is not reachable on (email missing)", () => {
    const sends = planTransactionalSends("refund_issued", {
      ...fullyReachable,
      email: false,
    });
    expect(channels(sends)).toEqual(["wallet_push", "web_push"]);
  });

  it("falls back to SMS (not sendable V1) when neither wallet nor web-push, on a fallback trigger", () => {
    const sends = planTransactionalSends("uber_course_failed", {
      walletPush: false,
      webPush: false,
      walletSilent: false,
      email: true,
      sms: true,
    });
    // Email still fires (Archive trace); SMS is the extreme fallback for the push
    // categories, planned but NOT sendable V1 (no provider).
    expect(channels(sends)).toContain("email");
    const smsSend = sends.find((s) => s.channel === "sms");
    expect(smsSend).toBeDefined();
    expect(smsSend?.sendable).toBe(false);
  });

  it("does NOT emit SMS when the customer has a push channel (wallet present)", () => {
    const sends = planTransactionalSends("order_paid", {
      walletPush: true,
      webPush: false,
      walletSilent: true,
      email: false,
      sms: true,
    });
    expect(channels(sends)).not.toContain("sms");
  });
});

describe("2.7-B engine — Temps-réel: wallet_push + web_push", () => {
  it("fires wallet_push + web_push for order_delivered", () => {
    const sends = planTransactionalSends("order_delivered", fullyReachable);
    expect(channels(sends)).toEqual(["wallet_push", "web_push"]);
    expect(sends.every((s) => s.category === "temps_reel")).toBe(true);
  });

  it("never emits email on a Temps-réel trigger (even if reachable)", () => {
    const sends = planTransactionalSends("courier_dropoff", fullyReachable);
    expect(channels(sends)).not.toContain("email");
  });

  it("SMS fallback applies to courier_dropoff (trigger 4) when no push, but not order_delivered (5)", () => {
    const noPush: ChannelAvailability = {
      walletPush: false,
      webPush: false,
      walletSilent: false,
      email: true,
      sms: true,
    };
    expect(
      channels(planTransactionalSends("courier_dropoff", noPush)),
    ).toContain("sms");
    expect(
      channels(planTransactionalSends("order_delivered", noPush)),
    ).not.toContain("sms");
  });
});

describe("2.7-B engine — Info statut: silent Wallet update only", () => {
  it("fires wallet_silent only for order_received_kitchen", () => {
    const sends = planTransactionalSends(
      "order_received_kitchen",
      fullyReachable,
    );
    expect(channels(sends)).toEqual(["wallet_silent"]);
    expect(sends[0].category).toBe("info_statut");
  });

  it("courier_pickup is Info statut + a light web_push", () => {
    const sends = planTransactionalSends("courier_pickup", fullyReachable);
    expect(channels(sends)).toEqual(["wallet_silent", "web_push"]);
    expect(sends.every((s) => s.category === "info_statut")).toBe(true);
  });

  it("never emits SMS on an Info statut trigger (not in 1/4/6/7)", () => {
    const sends = planTransactionalSends("order_received_kitchen", {
      walletPush: false,
      webPush: false,
      walletSilent: false,
      email: true,
      sms: true,
    });
    expect(channels(sends)).not.toContain("sms");
    // No reachable channel at all ⇒ no send.
    expect(sends).toHaveLength(0);
  });
});
