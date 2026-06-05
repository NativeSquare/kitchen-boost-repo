import { describe, expect, it } from "vitest";

import {
  TABLET_MIN_WIDTH_PX,
  decideFormFactorShell,
} from "./decide-form-factor";

/**
 * Truth table for the form-factor decision (cf. `decideFormFactorShell` doc).
 *
 * Threshold is 768px. `kiosque` always wins. `telephone` and `null` defer to
 * the viewport width.
 */
describe("decideFormFactorShell", () => {
  it("kiosque mode → drawer even on a narrow viewport", () => {
    expect(decideFormFactorShell({ width: 360, deviceMode: "kiosque" })).toBe(
      "drawer",
    );
    expect(decideFormFactorShell({ width: 1280, deviceMode: "kiosque" })).toBe(
      "drawer",
    );
  });

  it("telephone mode + narrow viewport → tabs", () => {
    expect(decideFormFactorShell({ width: 360, deviceMode: "telephone" })).toBe(
      "tabs",
    );
    expect(
      decideFormFactorShell({
        width: TABLET_MIN_WIDTH_PX - 1,
        deviceMode: "telephone",
      }),
    ).toBe("tabs");
  });

  it("telephone mode + tablet viewport → drawer (exotic case spec'd in brief)", () => {
    expect(
      decideFormFactorShell({
        width: TABLET_MIN_WIDTH_PX,
        deviceMode: "telephone",
      }),
    ).toBe("drawer");
    expect(
      decideFormFactorShell({ width: 1024, deviceMode: "telephone" }),
    ).toBe("drawer");
  });

  it("device mode still loading (null) → width-only heuristic", () => {
    expect(decideFormFactorShell({ width: 360, deviceMode: null })).toBe(
      "tabs",
    );
    expect(decideFormFactorShell({ width: 1024, deviceMode: null })).toBe(
      "drawer",
    );
    expect(
      decideFormFactorShell({
        width: TABLET_MIN_WIDTH_PX,
        deviceMode: null,
      }),
    ).toBe("drawer");
  });

  it("threshold is exactly 768 (inclusive)", () => {
    expect(decideFormFactorShell({ width: 767, deviceMode: "telephone" })).toBe(
      "tabs",
    );
    expect(decideFormFactorShell({ width: 768, deviceMode: "telephone" })).toBe(
      "drawer",
    );
  });
});
