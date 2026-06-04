/**
 * PWA-S6a (#455) — `decideDeviceTarget` — pure decision returning which Wallet
 * install flow `<AddToWalletButton>` should expose for a given user-agent
 * string (decisions-log Q5 « Distribution device-specific iOS Blob /
 * Android Save link / Desktop disabled »).
 *
 * 3 buckets:
 *   - `"ios"`     → Blob `application/vnd.apple.pkpass` → `URL.createObjectURL`
 *                   → `window.location.assign(blobUrl)` → Safari intercepts MIME
 *                   → native Apple Wallet sheet.
 *   - `"android"` → `window.location.href = googleSaveLink` → Google Wallet
 *                   preview.
 *   - `"desktop"` → button disabled + message « Disponible sur mobile uniquement »
 *                   (Q5 explicitly rejects desktop install — Wallet is mobile-only).
 *
 * Splitting the device detection from the React IO keeps every branch
 * vitest-pinnable in node env (mirroring `decidePaymentGate` /
 * `decideAddressFirstAction` shape). The actual browser detection happens via
 * the user-agent string the React component reads from
 * `navigator.userAgent` — passed as an explicit argument here so the
 * function is pure and the test fixtures can pin every relevant UA.
 *
 * Detection rule (Q5 + the iPadOS-on-desktop-UA quirk):
 *   - iPhone / iPod / iPad UA fragments → ios (iPadOS still ships «Safari» +
 *     «AppleWebKit» but the «iPad» token is enough for the binary triage).
 *   - "iPad" desktop-mode UA on iPadOS 13+ no longer says iPad → it presents
 *     as Mac. Sophie's PWA target is the iPhone (US 31), so we deliberately
 *     do NOT try to detect desktop-mode iPad — Mac UA stays `desktop` and we
 *     surface the « Disponible sur mobile uniquement » message. If a user
 *     hits us from desktop-mode iPad they can switch back; this is the
 *     decisions-log accepted trade-off (V1, no heuristic).
 *   - Android UA fragment → android.
 *   - Everything else (Mac / Windows / Linux / unknown) → desktop.
 *   - Empty / undefined UA → desktop (safest default: never offer a Blob
 *     install we can't support).
 */
import { describe, expect, it } from "vitest";
import { type DeviceTarget, decideDeviceTarget } from "./decide-device-target";

// Real-world UA fixtures (the ones Apple/Google actually emit).
const UA_IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_IPOD = "Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X)";
const UA_ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const UA_ANDROID_FIREFOX =
  "Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0";
const UA_MAC_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const UA_WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_LINUX_FIREFOX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";

describe("decideDeviceTarget — iOS bucket (Blob .pkpass)", () => {
  it("classifies iPhone Safari as ios", () => {
    expect(decideDeviceTarget({ userAgent: UA_IPHONE_SAFARI })).toBe("ios");
  });

  it("classifies iPad Safari as ios", () => {
    expect(decideDeviceTarget({ userAgent: UA_IPAD_SAFARI })).toBe("ios");
  });

  it("classifies iPod as ios (rare but the token is iPhone-family)", () => {
    expect(decideDeviceTarget({ userAgent: UA_IPOD })).toBe("ios");
  });
});

describe("decideDeviceTarget — Android bucket (Google Save link redirect)", () => {
  it("classifies Android Chrome as android", () => {
    expect(decideDeviceTarget({ userAgent: UA_ANDROID_CHROME })).toBe(
      "android",
    );
  });

  it("classifies Android Firefox as android", () => {
    expect(decideDeviceTarget({ userAgent: UA_ANDROID_FIREFOX })).toBe(
      "android",
    );
  });
});

describe("decideDeviceTarget — Desktop bucket (button disabled)", () => {
  it("classifies Mac desktop as desktop (we deliberately do NOT detect iPad-desktop-mode V1)", () => {
    expect(decideDeviceTarget({ userAgent: UA_MAC_DESKTOP })).toBe("desktop");
  });

  it("classifies Windows Chrome as desktop", () => {
    expect(decideDeviceTarget({ userAgent: UA_WINDOWS_CHROME })).toBe(
      "desktop",
    );
  });

  it("classifies Linux Firefox as desktop", () => {
    expect(decideDeviceTarget({ userAgent: UA_LINUX_FIREFOX })).toBe("desktop");
  });

  it("classifies an empty UA as desktop (safe default)", () => {
    expect(decideDeviceTarget({ userAgent: "" })).toBe("desktop");
  });

  it("classifies an undefined UA as desktop (safe default — never offer Blob we can't support)", () => {
    expect(decideDeviceTarget({ userAgent: undefined })).toBe("desktop");
  });
});

describe("decideDeviceTarget — exhaustive typing", () => {
  it("only ever returns one of the 3 buckets (discriminated union)", () => {
    const samples: ReadonlyArray<string | undefined> = [
      UA_IPHONE_SAFARI,
      UA_IPAD_SAFARI,
      UA_ANDROID_CHROME,
      UA_MAC_DESKTOP,
      "",
      undefined,
      "garbage ua",
    ];
    const valid: ReadonlySet<DeviceTarget> = new Set([
      "ios",
      "android",
      "desktop",
    ]);
    for (const ua of samples) {
      expect(valid.has(decideDeviceTarget({ userAgent: ua }))).toBe(true);
    }
  });
});
