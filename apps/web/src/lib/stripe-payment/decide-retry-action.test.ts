/**
 * PWA-S7 (#458) — tests for the pure `decideRetryAction` decision
 * (US 48, acceptance « 1ᵉʳ et 2ᵉ échec → retry inline, 3ᵉ échec → toast +
 * Sentry log »).
 *
 * The decision takes the NEW attempt count AFTER an error (so failure #1 is
 * attemptsSoFar=1) and returns whether to surface an inline retry banner or
 * to escalate to a fatal toast + Sentry log.
 */
import { describe, expect, it } from "vitest";
import { decideRetryAction } from "./decide-retry-action";

describe("decideRetryAction", () => {
  it("returns 'inline-retry' on the 1st failure (attempt #1)", () => {
    expect(decideRetryAction(1)).toEqual({ kind: "inline-retry" });
  });

  it("returns 'inline-retry' on the 2nd failure (attempt #2)", () => {
    expect(decideRetryAction(2)).toEqual({ kind: "inline-retry" });
  });

  it("returns 'fatal-toast' on the 3rd failure (attempt #3)", () => {
    expect(decideRetryAction(3)).toEqual({ kind: "fatal-toast" });
  });

  it("returns 'fatal-toast' on any attempt above 3 (defensive: no infinite retry loop)", () => {
    expect(decideRetryAction(4)).toEqual({ kind: "fatal-toast" });
    expect(decideRetryAction(99)).toEqual({ kind: "fatal-toast" });
  });

  it("treats 0 attempts as 'inline-retry' (defensive — should never happen, parent counts from 1)", () => {
    expect(decideRetryAction(0)).toEqual({ kind: "inline-retry" });
  });
});
