import { describe, expect, it } from "vitest";
import { decideOnboardingStep } from "./decide-onboarding-step";

/**
 * #398 — `decideOnboardingStep` pinned as a pure function (PRD 20 §1a, séquence
 * post-login). The `(onboarding)` route in `apps/native/src/app/(onboarding)/index.tsx`
 * is a thin adapter: it resolves the OS push permission status via
 * `expo-notifications`, persists the per-item acknowledgements in component
 * state, calls `markOnboardingCompleted` against Convex at the tail of the
 * flow, then delegates the step verdict to this function on every render.
 *
 * Same split convention as `decideForceUpdate` (#394) and
 * `decidePushPermissionBanner` (#395) — keep React, `expo-notifications` and
 * Convex out of the decision so the matrix is pinned by a fast deterministic
 * vitest suite (Node env, no jsdom, no native mocks).
 *
 * Truth table (cf. PRD 20 §1a steps 2 → 4 → 5):
 *
 *  | pushStatus  | pushAsked | volumeAck | sleepAck | step        |
 *  | ----------- | --------- | --------- | -------- | ----------- |
 *  | undefined   | -         | -         | -        | loading     |
 *  | undetermined| false     | -         | -        | push-prompt |
 *  | undetermined| true      | false     | false    | checklist   |
 *  | granted     | -         | false     | false    | checklist   |
 *  | denied      | -         | false     | false    | checklist   |
 *  | (any known) | -         | true      | true     | completing  |
 *
 *  - We DO NOT block the user when the OS push is denied — the red persistent
 *    banner (#395) already surfaces that. Onboarding has to MOVE FORWARD even
 *    if the user refuses push (the checklist is what Alex called « plus
 *    important que les push » in PRD 20 §1a step 4).
 *
 *  - `pushAsked` flips to `true` once `Notifications.requestPermissionsAsync()`
 *    has been called once on this device for this onboarding run; it is a
 *    one-shot soft latch so the checklist UI shows up exactly once after the
 *    rationale screen, even if the OS prompt was dismissed without granting
 *    (still `undetermined` on iOS in some edge cases).
 *
 *  - `volumeAck` / `sleepAck` are the « J'ai fait » buttons of the two
 *    checklist items. They are NOT programmatically validated (acceptance
 *    criteria: « non-validation programmatique, juste guide UX »). Both must
 *    be acknowledged before we move to `completing` (which triggers the Convex
 *    `markOnboardingCompleted` mutation and a redirect to `(tabs)/index`).
 */

describe("#398 decideOnboardingStep — pre-resolution guard", () => {
  it("pushStatus=undefined (still pending) → loading", () => {
    // First render of `(onboarding)` before `Notifications.getPermissionsAsync()`
    // resolves. A flash to push-prompt before we know if the user has already
    // granted/denied would be a UX bug (would re-show the rationale to a user
    // who passed onboarding 5 seconds ago on another device but the state
    // hasn't hydrated).
    expect(
      decideOnboardingStep({
        pushStatus: undefined,
        pushAsked: false,
        volumeAck: false,
        sleepAck: false,
      }),
    ).toBe("loading");
  });
});

describe("#398 decideOnboardingStep — step 2 push permission prompt (PRD 20 §1a)", () => {
  it("pushStatus=undetermined + not yet asked → push-prompt", () => {
    // First time on this device — show the custom rationale screen
    // (« KB Orders a besoin des notifs pour ne pas rater une commande »).
    expect(
      decideOnboardingStep({
        pushStatus: "undetermined",
        pushAsked: false,
        volumeAck: false,
        sleepAck: false,
      }),
    ).toBe("push-prompt");
  });

  it("pushStatus=undetermined + ALREADY asked → checklist (don't loop the rationale)", () => {
    // Edge case iOS: the prompt was dismissed by tapping outside / by going to
    // the home screen — the status stays `undetermined` but we've already
    // asked once. We MUST move forward (looping the rationale screen would
    // wedge the user).
    expect(
      decideOnboardingStep({
        pushStatus: "undetermined",
        pushAsked: true,
        volumeAck: false,
        sleepAck: false,
      }),
    ).toBe("checklist");
  });
});

describe("#398 decideOnboardingStep — step 4 checklist réglages device (PRD 20 §1a)", () => {
  it("pushStatus=granted → checklist (move forward, push is healthy)", () => {
    expect(
      decideOnboardingStep({
        pushStatus: "granted",
        pushAsked: true,
        volumeAck: false,
        sleepAck: false,
      }),
    ).toBe("checklist");
  });

  it("pushStatus=denied → checklist (we move forward — banner #395 surfaces the failure)", () => {
    // Alex acted in PRD 20 §1a step 4: the checklist is « plus important que
    // les push ». Refusing push must NOT wedge onboarding — the persistent
    // red banner (#395) already nags the user about it on every (app) screen.
    expect(
      decideOnboardingStep({
        pushStatus: "denied",
        pushAsked: true,
        volumeAck: false,
        sleepAck: false,
      }),
    ).toBe("checklist");
  });

  it("only volumeAck → still checklist (sleepAck still pending)", () => {
    expect(
      decideOnboardingStep({
        pushStatus: "granted",
        pushAsked: true,
        volumeAck: true,
        sleepAck: false,
      }),
    ).toBe("checklist");
  });

  it("only sleepAck → still checklist (volumeAck still pending)", () => {
    expect(
      decideOnboardingStep({
        pushStatus: "granted",
        pushAsked: true,
        volumeAck: false,
        sleepAck: true,
      }),
    ).toBe("checklist");
  });
});

describe("#398 decideOnboardingStep — step 5 completing (PRD 20 §1a → redirect home)", () => {
  it("both checklist items acknowledged + push granted → completing", () => {
    // The mutation `markOnboardingCompleted` is fired by the adapter once the
    // verdict flips to `completing`. Convex `getMyDevice` then sees
    // `onboardingCompleted: true` and the root layout rebases on `(app)`.
    expect(
      decideOnboardingStep({
        pushStatus: "granted",
        pushAsked: true,
        volumeAck: true,
        sleepAck: true,
      }),
    ).toBe("completing");
  });

  it("both checklist items acknowledged + push denied → completing (push is optional)", () => {
    // Even if the user refused push, completing the checklist marks the device
    // as onboarded — the persistent banner takes over from there.
    expect(
      decideOnboardingStep({
        pushStatus: "denied",
        pushAsked: true,
        volumeAck: true,
        sleepAck: true,
      }),
    ).toBe("completing");
  });

  it("both checklist items acknowledged + push undetermined (prompted but dismissed) → completing", () => {
    expect(
      decideOnboardingStep({
        pushStatus: "undetermined",
        pushAsked: true,
        volumeAck: true,
        sleepAck: true,
      }),
    ).toBe("completing");
  });
});
