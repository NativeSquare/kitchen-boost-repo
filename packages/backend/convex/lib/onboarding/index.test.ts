import { describe, expect, it } from "vitest";
import * as onboarding from "./index";

/**
 * B-ONBOARDING-MILESTONES slice 5 (#225) — barrel re-exports + JSDoc
 * deprecation. This module is the public API surface of the `onboarding`
 * backend module (BMAD: no cross-module import outside this index). The two
 * granular milestone mutations + the canonical Closing-set key type added by
 * slices 3/4 (#189 / #213) must be reachable from the barrel so consumers can
 * spell them without reaching across modules.
 */
describe("onboarding/index barrel — slice 5 surface", () => {
  it("re-exports setMilestone (granular binary milestone write, slice 3)", () => {
    expect(onboarding.setMilestone).toBeDefined();
  });

  it("re-exports recordIntegrationStatus (composite integration write, slice 4)", () => {
    expect(onboarding.recordIntegrationStatus).toBeDefined();
  });

  it("re-exports ClosingMilestoneKey type (consumable via the barrel)", () => {
    // Type-only export — assert reachability at compile time. The two
    // assignments fail to typecheck if the type drifts from `pipeline.ts`.
    const sample: onboarding.ClosingMilestoneKey = "contratSigne";
    expect(sample).toBe("contratSigne");
  });
});
