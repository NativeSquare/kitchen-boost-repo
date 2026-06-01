/**
 * F-PIPELINE-CRM 04 (#220) — `reduceIntegrationStatus` pure reducer test.
 *
 * Pure module (no React / no Convex / no DOM) — runs in vitest's lean `node`
 * env. Pins the contract of the patch returned to the Convex wiring shell
 * (`recordIntegrationStatus` mutation, B-ONBOARDING-MILESTONES) so the UI
 * dropdown that flips a composite oscillating integration status
 * (Stripe Connect / Uber Direct / Hubrise) stays a thin adapter.
 *
 * Decision matrix (issue #220 acceptance criteria + EPIC F-PIPELINE-CRM
 * "Modules deep" — `integrationStatusReducer`):
 *
 *   - `next !== prev.current`  → `current` replaced + history appended
 *                                with `{ status: next, at: now, by }`.
 *   - `next === prev.current`  → noop, returns `prev` unchanged
 *                                (no duplicated history line).
 *   - History is NEVER truncated — preserved as-is, the new line is appended
 *     at the tail (chronological order).
 *
 * The reducer is generic over `S extends string` so the 3 providers
 * (Stripe Connect / Uber Direct / Hubrise) share one implementation; the
 * concrete enums live next to their schema in
 * `packages/backend/convex/table/prospects.ts` (out of scope for this story).
 */
import { describe, expect, it } from "vitest";

import { reduceIntegrationStatus } from "./integrationStatusReducer";

type StripeStatus = "pending_kyc" | "verified" | "rejected";

describe("reduceIntegrationStatus", () => {
  it("transition pending_kyc → verified — current replaced, history += 1", () => {
    const prev = {
      current: "pending_kyc" as StripeStatus,
      history: [
        { status: "pending_kyc" as StripeStatus, at: 1_000, by: "alex" },
      ],
    };

    const result = reduceIntegrationStatus({
      prev,
      next: "verified",
      now: 2_000,
      by: "alex",
    });

    expect(result).toEqual({
      current: "verified",
      history: [
        { status: "pending_kyc", at: 1_000, by: "alex" },
        { status: "verified", at: 2_000, by: "alex" },
      ],
    });
  });

  it("oscillating transition verified → rejected → pending_kyc — 3 lines appended in order", () => {
    const t0 = {
      current: "verified" as StripeStatus,
      history: [{ status: "verified" as StripeStatus, at: 1_000, by: "alex" }],
    };

    const t1 = reduceIntegrationStatus({
      prev: t0,
      next: "rejected",
      now: 2_000,
      by: "alex",
    });
    const t2 = reduceIntegrationStatus({
      prev: t1,
      next: "pending_kyc",
      now: 3_000,
      by: "alex",
    });

    expect(t2).toEqual({
      current: "pending_kyc",
      history: [
        { status: "verified", at: 1_000, by: "alex" },
        { status: "rejected", at: 2_000, by: "alex" },
        { status: "pending_kyc", at: 3_000, by: "alex" },
      ],
    });
  });

  it("noop — next === current returns prev unchanged (same reference, no duplicated history line)", () => {
    const prev = {
      current: "verified" as StripeStatus,
      history: [
        { status: "pending_kyc" as StripeStatus, at: 1_000, by: "alex" },
        { status: "verified" as StripeStatus, at: 2_000, by: "alex" },
      ],
    };

    const result = reduceIntegrationStatus({
      prev,
      next: "verified",
      now: 9_999,
      by: "alex",
    });

    // Same reference — pure noop, no allocation.
    expect(result).toBe(prev);
    // And of course no duplicated history line.
    expect(result.history).toHaveLength(2);
  });

  it("pre-existing history is preserved (never truncated, never reordered)", () => {
    const prev = {
      current: "verified" as StripeStatus,
      history: [
        { status: "pending_kyc" as StripeStatus, at: 100, by: "alex" },
        { status: "rejected" as StripeStatus, at: 200, by: "alex" },
        { status: "pending_kyc" as StripeStatus, at: 300, by: "alex" },
        { status: "verified" as StripeStatus, at: 400, by: "alex" },
      ],
    };

    const result = reduceIntegrationStatus({
      prev,
      next: "rejected",
      now: 500,
      by: "alex",
    });

    expect(result.current).toBe("rejected");
    expect(result.history).toEqual([
      { status: "pending_kyc", at: 100, by: "alex" },
      { status: "rejected", at: 200, by: "alex" },
      { status: "pending_kyc", at: 300, by: "alex" },
      { status: "verified", at: 400, by: "alex" },
      { status: "rejected", at: 500, by: "alex" },
    ]);
  });

  it("`by` is optional — omitting it stores a history line without the `by` field", () => {
    const prev = {
      current: "pending_kyc" as StripeStatus,
      history: [{ status: "pending_kyc" as StripeStatus, at: 1_000 }],
    };

    const result = reduceIntegrationStatus({
      prev,
      next: "verified",
      now: 2_000,
    });

    expect(result).toEqual({
      current: "verified",
      history: [
        { status: "pending_kyc", at: 1_000 },
        { status: "verified", at: 2_000 },
      ],
    });
  });
});
