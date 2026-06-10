/**
 * PWA-S11 (#463) — tests for `decideIosBottomSheetVisibility`, the pure
 * decision the `<IOSInstallBottomSheet>` consults to know whether to render
 * on `/c/[orderId]` (decisions-log Q4 « iOS bottom-sheet GIF instructions
 * sur page Tracking T+0 », US 58).
 *
 * Same shape as `decideA2hsButtonVisibility` (#462 / S10) — discriminated
 * union out, every branch pinnable in node env. 4 conditions ALL required
 * to SHOW:
 *   1. `isIosSafari = true`              — only Safari has the Share → A2HS path
 *   2. `isStandalone = false`            — already installed → nothing to instruct
 *   3. `a2hsStatus !== "enrolled"`       — backend already saw the install
 *                                          (heuristique S11 — once flipped, retire)
 *   4. `dismissed = false`               — session-scoped « OK plus tard » respect
 *
 * Precedence rationale (strongest backend/device truth first), mirrors the
 * #462 sibling so the two A2HS surfaces fail/log consistently:
 *   already-enrolled  >  already-standalone  >  not-ios-safari  >  dismissed
 *
 * Why no « tracking-step » gate here :
 *   The PRD/issue places the bottom-sheet at the T+0 « Cmd reçue » state.
 *   The MOUNT POINT enforces that — the sheet is only RENDERED on
 *   `/c/[orderId]` and the route component handles « tracking page only ».
 *   The pure decision intentionally doesn't carry an `orderStatus` input —
 *   keeping it free of order-domain coupling means the same decision can
 *   later drive a different mount point without a contract change.
 */
import { describe, expect, it } from "vitest";
import { decideIosBottomSheetVisibility } from "./decide-ios-bottom-sheet-visibility";

const SHOW = { kind: "show" } as const;

describe("decideIosBottomSheetVisibility — show", () => {
  it("renders on iOS Safari, not standalone, not enrolled, not dismissed", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: true,
        isStandalone: false,
        a2hsStatus: undefined,
        dismissed: false,
      }),
    ).toEqual(SHOW);
  });

  it("renders with a2hsStatus = not_enrolled (same as undefined — not yet enrolled)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: true,
        isStandalone: false,
        a2hsStatus: "not_enrolled",
        dismissed: false,
      }),
    ).toEqual(SHOW);
  });

  it('renders with a2hsStatus = "revoked" (re-offer install — same shape as wallet-prompt revoked)', () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: true,
        isStandalone: false,
        a2hsStatus: "revoked",
        dismissed: false,
      }),
    ).toEqual(SHOW);
  });
});

describe("decideIosBottomSheetVisibility — hidden", () => {
  it("hides when a2hsStatus = enrolled (backend knows we installed — AC 3)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: true,
        isStandalone: false,
        a2hsStatus: "enrolled",
        dismissed: false,
      }),
    ).toEqual({ kind: "hidden", reason: "already-enrolled" });
  });

  it("hides when running in PWA standalone (already installed — nothing to instruct)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: true,
        isStandalone: true,
        a2hsStatus: undefined,
        dismissed: false,
      }),
    ).toEqual({ kind: "hidden", reason: "already-standalone" });
  });

  it("hides on Android (AC 4 « bottom sheet n'apparaît jamais » — détection iOS-only)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: false,
        isStandalone: false,
        a2hsStatus: undefined,
        dismissed: false,
      }),
    ).toEqual({ kind: "hidden", reason: "not-ios-safari" });
  });

  it("hides on desktop Safari (no Add-to-Home-Screen on macOS Safari)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: false,
        isStandalone: false,
        a2hsStatus: undefined,
        dismissed: false,
      }),
    ).toEqual({ kind: "hidden", reason: "not-ios-safari" });
  });

  it("hides when the user tapped « OK plus tard » this session (sessionStorage)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: true,
        isStandalone: false,
        a2hsStatus: undefined,
        dismissed: true,
      }),
    ).toEqual({ kind: "hidden", reason: "dismissed" });
  });
});

describe("decideIosBottomSheetVisibility — precedence", () => {
  // Precedence pins the reason surfaced when multiple hide conditions apply,
  // useful for the analytics breadcrumb. Order mirrors #462:
  //   1. enrolled — loudest backend truth (we already saw the install)
  //   2. standalone — live device truth (running INSIDE the PWA right now)
  //   3. not-ios-safari — we literally can't instruct (other browser)
  //   4. dismissed — soft session preference (last to surface)

  it("enrolled wins over standalone + not-ios + dismissed", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: false,
        isStandalone: true,
        a2hsStatus: "enrolled",
        dismissed: true,
      }),
    ).toEqual({ kind: "hidden", reason: "already-enrolled" });
  });

  it("standalone wins over not-ios + dismissed (when not enrolled yet)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: false,
        isStandalone: true,
        a2hsStatus: undefined,
        dismissed: true,
      }),
    ).toEqual({ kind: "hidden", reason: "already-standalone" });
  });

  it("not-ios-safari wins over dismissed (when not enrolled, not standalone)", () => {
    expect(
      decideIosBottomSheetVisibility({
        isIosSafari: false,
        isStandalone: false,
        a2hsStatus: undefined,
        dismissed: true,
      }),
    ).toEqual({ kind: "hidden", reason: "not-ios-safari" });
  });
});
