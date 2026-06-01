/**
 * F-CAMPAGNES [5/7] (#228) — `classifySendError`, the PURE error classifier the
 * stateful shell uses to decide WHICH UX branch follows a failed
 * `sendTenantCampaign` mutation.
 *
 * Two branches per the issue body:
 *   - `ConvexError({ code: "CAMPAIGN_ANOMALY", message, reason? })` → open the
 *     `CampaignAnomalyDialog` with the (possibly null) anomaly reason.
 *   - everything else (network, TEMPLATE_BOUND_VIOLATION, unknown) → generic
 *     fallback (toast + retry).
 *
 * Mirror of the backend `anomalyError` shape (`campaigns.ts` line 105):
 *   throw new ConvexError({ code: "CAMPAIGN_ANOMALY", message: "Campaign anomaly blocked: <reason>" });
 *
 * The reason is encoded in the message suffix (`<reason>` is the `CampaignAnomaly`
 * union from `antiAnomaly.ts`: TOO_FREQUENT_48H / TOO_FREQUENT_WEEK /
 * RECIPIENT_SURGE). The classifier parses it back so the dialog can pick the
 * right FR copy — a `null` reason falls back to the generic FR message.
 *
 * Pure — no React, no Convex ctx. Imported by the stateful shell + tested in
 * isolation here under `environment: "node"`.
 */
import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";

import { classifySendError } from "./classifySendError";

describe("classifySendError — F-CAMPAGNES [5/7] (#228)", () => {
  it("ConvexError with CAMPAIGN_ANOMALY → kind=anomaly + parsed reason (TOO_FREQUENT_48H)", () => {
    const err = new ConvexError({
      code: "CAMPAIGN_ANOMALY",
      message: "Campaign anomaly blocked: TOO_FREQUENT_48H",
    });
    const result = classifySendError(err);
    expect(result.kind).toBe("anomaly");
    if (result.kind === "anomaly") {
      expect(result.reason).toBe("TOO_FREQUENT_48H");
    }
  });

  it("ConvexError with CAMPAIGN_ANOMALY → reason TOO_FREQUENT_WEEK", () => {
    const err = new ConvexError({
      code: "CAMPAIGN_ANOMALY",
      message: "Campaign anomaly blocked: TOO_FREQUENT_WEEK",
    });
    const result = classifySendError(err);
    expect(result.kind).toBe("anomaly");
    if (result.kind === "anomaly") {
      expect(result.reason).toBe("TOO_FREQUENT_WEEK");
    }
  });

  it("ConvexError with CAMPAIGN_ANOMALY → reason RECIPIENT_SURGE", () => {
    const err = new ConvexError({
      code: "CAMPAIGN_ANOMALY",
      message: "Campaign anomaly blocked: RECIPIENT_SURGE",
    });
    const result = classifySendError(err);
    expect(result.kind).toBe("anomaly");
    if (result.kind === "anomaly") {
      expect(result.reason).toBe("RECIPIENT_SURGE");
    }
  });

  it("ConvexError CAMPAIGN_ANOMALY with unparseable message → reason=null (fallback)", () => {
    const err = new ConvexError({
      code: "CAMPAIGN_ANOMALY",
      message: "no recognisable suffix here",
    });
    const result = classifySendError(err);
    expect(result.kind).toBe("anomaly");
    if (result.kind === "anomaly") {
      expect(result.reason).toBeNull();
    }
  });

  it("ConvexError with a DIFFERENT code (TEMPLATE_BOUND_VIOLATION) → kind=generic", () => {
    const err = new ConvexError({
      code: "TEMPLATE_BOUND_VIOLATION",
      message: "Campaign template bound violated: BODY_TOO_LONG",
    });
    const result = classifySendError(err);
    expect(result.kind).toBe("generic");
  });

  it("ConvexError with TEMPLATE_NOT_FOUND → kind=generic", () => {
    const err = new ConvexError({
      code: "TEMPLATE_NOT_FOUND",
      message: "Campaign template not found",
    });
    const result = classifySendError(err);
    expect(result.kind).toBe("generic");
  });

  it("plain Error (network failure) → kind=generic", () => {
    const err = new Error("Failed to fetch");
    const result = classifySendError(err);
    expect(result.kind).toBe("generic");
  });

  it("unknown thrown value (string) → kind=generic", () => {
    const result = classifySendError("oops");
    expect(result.kind).toBe("generic");
  });

  it("null / undefined → kind=generic", () => {
    expect(classifySendError(null).kind).toBe("generic");
    expect(classifySendError(undefined).kind).toBe("generic");
  });
});
