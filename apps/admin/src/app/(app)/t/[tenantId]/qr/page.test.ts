/**
 * `/t/[tenantId]/qr` — source-level wiring contract for the SVG-only export
 * page (2026-06-01 simplification).
 *
 * The page is intentionally minimal :
 *
 *   useCurrentTenantId() + useSession() → resolve current tenant
 *     → tenantPwaUrl({ slug, customDomain }) → pwaUrl
 *       → QRCode.toString({ type: "svg", margin: 0, color: {…} })
 *         → inline preview + `<a download="qr-<slug>.svg" href="data:…">`
 *
 * Pinned at the source-file level (same pattern as the surrounding pages —
 * `parametres/page.test.ts`, `mes-clients/page.test.ts`, `menu/page.test.ts`).
 * The vitest config here is `environment: "node"` (no DOM, no RTL), so we
 * verify the wiring by inspecting the source file.
 *
 * Hard constraints pinned :
 *   - The page reads the tenant via the F-SHELL hooks (no new backend
 *     endpoint — reuses the existing `loadTenantForStripe` admin probe and
 *     the `tenantSettings.getSettings` manager-accessible query).
 *   - The encoded URL goes through `tenantPwaUrl` (no inline duplication).
 *   - The single export is SVG with `type: "svg"`, `margin: 0`, and
 *     pure-black-on-white colours (max scan reliability).
 *   - The download filename is exactly `qr-<slug>.svg`.
 *   - The page does NOT depend on `QrGeneratorView` / `jspdf` / the PDF
 *     pipeline. That code path stays alive for wizard step 6 only.
 *   - No cross-app imports (apps/web, apps/native) and no raw backend
 *     `convex/lib/` imports.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/** Strip comments + template strings before checks on executable code. */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — SVG-only QR export wiring contract", () => {
  it("reads the tenant via the F-SHELL hooks (useCurrentTenantId + useSession)", () => {
    expect(PAGE_SOURCE).toMatch(/useCurrentTenantId/);
    expect(PAGE_SOURCE).toMatch(/useSession/);
  });

  it("does NOT introduce a new backend endpoint (only the two existing reuses are allowed)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    const apiRefs = code.match(/api\.lib\.[A-Za-z0-9_.]+/g) ?? [];
    const allowed = new Set([
      "api.lib.stripe.account.loadTenantForStripe",
      "api.lib.admin.tenantSettings.getSettings",
    ]);
    for (const ref of apiRefs) {
      expect(allowed.has(ref)).toBe(true);
    }
  });

  it("recomposes the PWA URL via `tenantPwaUrl` (no backend call for the URL)", () => {
    expect(PAGE_SOURCE).toMatch(/tenantPwaUrl/);
    expect(PAGE_SOURCE).toMatch(
      /from\s+["'](?:@\/lib\/tenant-url|.*tenant-url)["']/,
    );
  });

  it("uses the `qrcode` lib in SVG mode (max-contrast black on white, zero margin)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // We pin the lib import (the same one used by `qr-data-url.ts`) and the
    // exact SVG options that guarantee scan reliability.
    expect(code).toMatch(/from\s+["']qrcode["']/);
    expect(code).toMatch(/type:\s*["']svg["']/);
    expect(code).toMatch(/margin:\s*0/);
    expect(code).toMatch(/dark:\s*["']#000000["']/);
    expect(code).toMatch(/light:\s*["']#FFFFFF["']/);
  });

  it("downloads `qr-<slug>.svg` via a `data:image/svg+xml` href (no server round-trip)", () => {
    // These pins live inside template strings, which `stripNonCode` removes —
    // we check the raw source so the backtick content survives the scan.
    expect(PAGE_SOURCE).toMatch(/qr-\$\{slug\}\.svg/);
    expect(PAGE_SOURCE).toMatch(/data:image\/svg\+xml/);
    expect(PAGE_SOURCE).toMatch(/encodeURIComponent/);
    // The download anchor must use the native `download` attribute (no
    // server-side blob route, no Convex action).
    expect(PAGE_SOURCE).toMatch(/download=\{fileName\}/);
  });

  it("does NOT mount the legacy PDF pipeline (QrGeneratorView / jspdf / @react-pdf/renderer)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/QrGeneratorView/);
    expect(code).not.toMatch(/jspdf/);
    expect(code).not.toMatch(/@react-pdf\/renderer/);
    expect(code).not.toMatch(/QrPdfDocument/);
  });

  it("never imports from `apps/web`, `apps/native`, or the raw backend functions tree", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
    expect(code).not.toMatch(/@packages\/backend\/convex\/lib\//);
  });
});
