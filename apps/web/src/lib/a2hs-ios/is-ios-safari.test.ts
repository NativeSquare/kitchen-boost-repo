/**
 * PWA-S11 (#463) — tests for `isIosSafari`, the pure UA sniff the iOS A2HS
 * surface relies on (decisions-log Q4 « iOS bottom-sheet trigger sur page
 * Tracking T+0 », US 58).
 *
 * iOS Safari has no `beforeinstallprompt` event (Apple limitation, cf. #462)
 * so the install hint MUST be served via instructions. We only show the
 * bottom-sheet on iPhone / iPad in Safari (NOT Chrome iOS / Firefox iOS —
 * those are WebKit wrappers but their UA strings are distinct and Safari is
 * the only browser that exposes the share-sheet → "Add to Home Screen" path
 * the GIF illustrates).
 *
 * The function is intentionally PERMISSIVE on the « is iOS device » side
 * (iPhone | iPad | iPod) and STRICT on the « is Safari » side (excludes
 * `CriOS` / `FxiOS` / `EdgiOS` / `OPiOS` / `Instagram` / `FBAN`/`FBAV`/
 * embedded WebViews). False positives (showing the sheet on a non-Safari
 * browser) would dead-end the user (the share menu they see isn't the
 * Safari one). False negatives (not showing on a fringe browser) are safe
 * — the user just doesn't see the install hint that wouldn't work anyway.
 */
import { describe, expect, it } from "vitest";
import { isIosSafari } from "./is-ios-safari";

describe("isIosSafari — true on iOS Safari", () => {
  it("matches iPhone Safari iOS 17 (real-world UA)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(true);
  });

  it("matches iPad Safari iPadOS 17", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(true);
  });

  it("matches iPod Touch Safari (legacy device, still in field)", () => {
    const ua =
      "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(true);
  });

  it("matches older iOS 16.4 Safari (Web Push minimum, common in field)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(true);
  });
});

describe("isIosSafari — false on iOS non-Safari (would dead-end install hint)", () => {
  it("rejects Chrome iOS (CriOS — WebKit but different share menu)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects Firefox iOS (FxiOS)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects Edge iOS (EdgiOS)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 EdgiOS/120.0.2210.61 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects Opera iOS (OPiOS)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 OPiOS/16.0.13.131967 Mobile/15E148 Safari/604.1";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects Instagram in-app browser (no share-sheet → add to home)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 318.0.0.20.107 (iPhone15,3; iOS 17_2; en_US; en; scale=3.00; 1290x2796; 532493226)";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects Facebook in-app WebView (FBAN/FBAV)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.2;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]";
    expect(isIosSafari(ua)).toBe(false);
  });
});

describe("isIosSafari — false on non-iOS", () => {
  it("rejects Android Chrome", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects desktop Safari macOS (no iPhone/iPad/iPod token)", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects desktop Chrome", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(isIosSafari(ua)).toBe(false);
  });

  it("rejects empty UA defensively (server snapshot, exotic clients)", () => {
    expect(isIosSafari("")).toBe(false);
  });

  it("rejects undefined UA defensively", () => {
    expect(isIosSafari(undefined)).toBe(false);
  });
});
