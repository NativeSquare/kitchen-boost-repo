/**
 * F-QR.1 — `generateQrDataUrl` is a thin wrapper around the `qrcode` lib's
 * `toDataURL` so the rest of the app depends on a stable internal contract
 * (string URL in → Promise<string data URL> out). If we ever swap the lib
 * (qr-code-styling, server-side rendering, …) only this module changes.
 *
 * We do NOT decode the QR visually — just assert the wrapper returns a
 * non-empty `data:image/...` URL for a known input. That's enough to catch a
 * busted import / missing dep / API change without coupling the test to PNG
 * byte-level output.
 */
import { describe, expect, it } from "vitest";
import { generateQrDataUrl } from "./qr-data-url";

describe("generateQrDataUrl", () => {
  it("returns a non-empty data:image/... URL for a known input URL", async () => {
    const dataUrl = await generateQrDataUrl(
      "https://lartisan.kitchen-boost.fr",
    );
    expect(typeof dataUrl).toBe("string");
    expect(dataUrl.length).toBeGreaterThan(0);
    expect(dataUrl.startsWith("data:image/")).toBe(true);
  });

  it("forwards options to the underlying lib (margin override produces a different payload)", async () => {
    const tight = await generateQrDataUrl("https://example.com", { margin: 0 });
    const loose = await generateQrDataUrl("https://example.com", { margin: 8 });
    // Different margins → different rasterised PNG → different data URL. This
    // pins that options actually flow through (not silently dropped).
    expect(tight).not.toBe(loose);
  });
});
