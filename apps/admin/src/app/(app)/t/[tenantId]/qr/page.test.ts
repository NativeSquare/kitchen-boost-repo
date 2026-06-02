/**
 * `/t/[tenantId]/qr` — source-level wiring contract for the SVG-only export
 * page (2026-06-01 simplification ; preview + download surface extracted to
 * the shared `<QrDownloadCard />` 2026-06-02).
 *
 * The page is intentionally minimal :
 *
 *   useCurrentTenantId() + useSession() → resolve current tenant
 *     → tenantPwaUrl({ slug, customDomain }) → pwaUrl
 *       → <QrDownloadCard pwaUrl={pwaUrl} slug={slug} />
 *
 * The actual SVG build (`qrcode` lib, type/margin/color options, data-url
 * download anchor) lives in the shared `QrDownloadCard` component and is
 * pinned by `QrDownloadCard.test.tsx`. This file only pins the page-level
 * wiring : the right session/tenant hooks, the URL recomposition through
 * `tenantPwaUrl`, the mount of the shared component, and the absence of any
 * legacy PDF pipeline reference.
 *
 * Pinned at the source-file level (same pattern as the surrounding pages —
 * `parametres/page.test.ts`, `mes-clients/page.test.ts`, `menu/page.test.ts`).
 * The vitest config here is `environment: "node"` (no DOM, no RTL), so we
 * verify the wiring by inspecting the source file.
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

  it("mounts the shared `<QrDownloadCard />` (preview + download UI lives in one place)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/QrDownloadCard/);
    expect(code).toMatch(
      /from\s+["'](?:@\/components\/qr\/QrDownloadCard|.*QrDownloadCard)["']/,
    );
    // `slug` + `pwaUrl` are the two props threaded to the shared component.
    expect(code).toMatch(/pwaUrl=\{pwaUrl\}/);
    expect(code).toMatch(/slug=\{slug\}/);
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
