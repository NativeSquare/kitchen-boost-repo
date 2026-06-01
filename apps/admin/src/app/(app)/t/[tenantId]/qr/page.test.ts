/**
 * F-QR.4 (#198) — `page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as `parametres/page.test.ts`,
 * `mes-clients/page.test.ts`, `menu/page.test.ts`). The page is a thin wiring
 * layer:
 *
 *   useCurrentTenantId() + useSession() → resolve current tenant
 *     → tenantPwaUrl({ slug, customDomain }) → pwaUrl
 *       → <QrGeneratorView pwaUrl restoName logoUrl primaryColor />
 *
 * The hard rules pinned here come straight from the issue body acceptance
 * criteria:
 *   - AC2 « Lit le tenant courant via le hook fourni par F-SHELL (zéro nouvel
 *     endpoint backend) » → the page uses ONLY the F-SHELL hooks already
 *     exposed by `@/components/app/tenant-context` and `@/lib/session`. It does
 *     NOT introduce a new backend query (no `api.lib.*` reference for a new
 *     surface — only the existing `loadTenantForStripe` for the KB Admin
 *     existence-probe path, mirroring the F-SHELL-04 layout).
 *   - AC3 « Recompose `pwaUrl` via `tenantPwaUrl` (pas d'appel backend pour
 *     l'URL) » → imports `tenantPwaUrl` from `@/lib/tenant-url`.
 *   - AC4 « Monte `QrGeneratorView` avec props branding du tenant » → imports
 *     and references `QrGeneratorView` from the F-QR.3 component module.
 *
 * What's NOT covered here (and on purpose): the rendering branches of
 * `QrGeneratorView` itself — they're pinned by
 * `components/qr/QrGeneratorView.test.tsx`. The pure URL helper is pinned by
 * `lib/tenant-url.test.ts`. The tenant guard (manager / admin / not-found /
 * redirect) is pinned by `tenant-context.decision.test.ts` and the chrome-less
 * layout — this page inherits the guard transitively.
 *
 * Scope discipline (#198 hard constraint, mirrors the surrounding pages):
 * this file lives under `apps/admin/src/app/(app)/t/[tenantId]/qr/` and is the
 * ONLY surface touched by this story. Zero touch to `apps/web`, `apps/native`,
 * or `packages/backend/convex/`. We pin that the source NEVER imports anything
 * from those forbidden roots (defensive — a future copy/paste would fail
 * loudly here even before the lint rule catches it).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

/**
 * Strip comments + template strings before checks on executable code, so a
 * docstring referring to (say) a forbidden symbol doesn't false-positive —
 * only the actual code matters for the wiring pins (same pattern as the
 * sibling page tests).
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("page.tsx — F-QR.4 (#198) wiring contract", () => {
  it("AC2 — reads the tenant via the F-SHELL hooks (useCurrentTenantId + useSession)", () => {
    // `useCurrentTenantId` is the sanctioned hook from F-SHELL-04 (#175) —
    // returns the branded `Id<"tenants">` validated by the chrome-less layout.
    expect(PAGE_SOURCE).toMatch(/useCurrentTenantId/);
    // `useSession` (F-SHELL-01) is the source of the per-tenant
    // `{ slug, name }` we need to recompose the PWA URL via `tenantPwaUrl`.
    expect(PAGE_SOURCE).toMatch(/useSession/);
  });

  it("AC2 — does NOT introduce a new backend endpoint (zero new query path)", () => {
    // The page may legitimately reuse two EXISTING queries:
    //
    //  - `api.lib.stripe.account.loadTenantForStripe` — root-only probe
    //    (same primitive the F-SHELL-04 layout uses for KB Admin tenant
    //    resolution — incidental Stripe naming, no Stripe coupling).
    //
    //  - `api.lib.admin.tenantSettings.getSettings` — added 2026-06-01 by
    //    B-PARAMETRES-04 to back the Paramètres page (cf. its docstring).
    //    Reused here (E2E spot-check QR2 fix 2026-06-01) so the KB Manager
    //    can read `customDomain` (the session payload doesn't carry it),
    //    otherwise the QR pointed at `<slug>.kitchen-boost.fr` instead of
    //    the tenant's configured custom domain.
    //
    // Any OTHER `api.lib.*` reference would imply a fresh backend surface,
    // which the issue forbids. We pin that constraint by allow-listing
    // exactly these two acceptable paths.
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

  it("AC3 — recomposes the PWA URL via `tenantPwaUrl` (no backend call for the URL)", () => {
    expect(PAGE_SOURCE).toMatch(/tenantPwaUrl/);
    // Imported from the canonical helper module of F-QR.1 (#167) — not
    // duplicated locally, not from a hypothetical backend path.
    expect(PAGE_SOURCE).toMatch(
      /from\s+["'](?:@\/lib\/tenant-url|.*tenant-url)["']/,
    );
  });

  it("AC4 — mounts `QrGeneratorView` from the F-QR.3 component module", () => {
    expect(PAGE_SOURCE).toMatch(/QrGeneratorView/);
    expect(PAGE_SOURCE).toMatch(
      /from\s+["'](?:@\/components\/qr\/QrGeneratorView|.*components\/qr\/QrGeneratorView)["']/,
    );
  });

  it("AC scope — never imports from `apps/web`, `apps/native`, or the backend functions root", () => {
    const code = stripNonCode(PAGE_SOURCE);
    // No cross-app imports. The page lives in apps/admin; touching apps/web
    // or apps/native would explode the scope (issue header hard rule).
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
    // Backend imports MUST go through the generated barrel (`api` from
    // `_generated/api`) or the dataModel — never the raw functions tree.
    expect(code).not.toMatch(/@packages\/backend\/convex\/lib\//);
  });

  it("AC delegation — wiring is delegated to `QrGeneratorView` (page stays thin)", () => {
    // The page assembles props and renders the view — no inline format
    // selector / PDF runtime / QR generator here. The actual QR + PDF logic
    // lives in `components/qr/`, pinned by its own tests (F-QR.1/2/3).
    const code = stripNonCode(PAGE_SOURCE);
    // No direct import of the QR data-url generator or the PDF runtime —
    // those are encapsulated inside `QrGeneratorView` / `QrPdfDocument`.
    expect(code).not.toMatch(/generateQrDataUrl/);
    expect(code).not.toMatch(/@react-pdf\/renderer/);
  });
});
