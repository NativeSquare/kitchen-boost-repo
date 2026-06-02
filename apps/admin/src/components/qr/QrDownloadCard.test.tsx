/**
 * `QrDownloadCard` — source-level contract for the shared SVG-only QR export
 * surface (2026-06-02 extraction, used by both the standalone `/t/[tenantId]/qr`
 * page and the wizard step 6).
 *
 * Pinned at the source-file level (same pattern as the sibling QR tests).
 * The vitest config here is `environment: "node"` (no DOM, no RTL), so we
 * verify the SVG-build contract + the download-anchor wiring by inspecting
 * the source file.
 *
 * Hard constraints pinned :
 *   - The component uses the `qrcode` lib in SVG mode with the exact options
 *     that guarantee scan reliability (type:"svg", margin:0, black-on-white).
 *   - The download is a `data:image/svg+xml` href via `encodeURIComponent`,
 *     filename exactly `qr-<slug>.svg`.
 *   - The component does NOT depend on the legacy PDF pipeline
 *     (QrGeneratorView / QrPdfDocument / jspdf / @react-pdf/renderer).
 *   - No cross-app imports (apps/web, apps/native) and no raw backend
 *     `convex/lib/` imports.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
  path.resolve(__dirname, "./QrDownloadCard.tsx"),
  "utf8",
);

/** Strip comments + template strings before checks on executable code. */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("QrDownloadCard.tsx — SVG-only QR shared surface", () => {
  it("uses the `qrcode` lib in SVG mode (max-contrast black on white, zero margin)", () => {
    const code = stripNonCode(SOURCE);
    expect(code).toMatch(/from\s+["']qrcode["']/);
    expect(code).toMatch(/type:\s*["']svg["']/);
    expect(code).toMatch(/margin:\s*0/);
    expect(code).toMatch(/dark:\s*["']#000000["']/);
    expect(code).toMatch(/light:\s*["']#FFFFFF["']/);
  });

  it("downloads `qr-<slug>.svg` via a `data:image/svg+xml` href (no server round-trip)", () => {
    // These pins live inside template strings, which `stripNonCode` removes —
    // we check the raw source so the backtick content survives the scan.
    expect(SOURCE).toMatch(/qr-\$\{slug\}\.svg/);
    expect(SOURCE).toMatch(/data:image\/svg\+xml/);
    expect(SOURCE).toMatch(/encodeURIComponent/);
    expect(SOURCE).toMatch(/download=\{fileName\}/);
  });

  it("does NOT depend on the legacy PDF pipeline", () => {
    const code = stripNonCode(SOURCE);
    expect(code).not.toMatch(/QrGeneratorView/);
    expect(code).not.toMatch(/QrPdfDocument/);
    expect(code).not.toMatch(/jspdf/);
    expect(code).not.toMatch(/@react-pdf\/renderer/);
  });

  it("exposes the public `QrDownloadCardProps` (pwaUrl, slug)", () => {
    expect(SOURCE).toMatch(/export type QrDownloadCardProps/);
    expect(SOURCE).toMatch(/pwaUrl:\s*string/);
    expect(SOURCE).toMatch(/slug:\s*string/);
  });

  it("never imports from `apps/web`, `apps/native`, or the raw backend functions tree", () => {
    const code = stripNonCode(SOURCE);
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
    expect(code).not.toMatch(/@packages\/backend\/convex\/lib\//);
  });
});
