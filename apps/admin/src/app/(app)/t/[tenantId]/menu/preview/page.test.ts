/**
 * F-MENU-10 (#254) — `/t/[tenantId]/menu/preview/page.tsx` wiring contract.
 *
 * Pinned at the source-file level (same pattern as the sibling `menu/page.test.ts`).
 * This page is the admin-side draft renderer the « Aperçu » header button
 * opens in a new tab. It MUST read the DRAFT (via
 * `api.lib.menu.publication.previewMenu`), NOT the published snapshot (which
 * `getPublicMenu` serves) — that is the load-bearing observable behaviour of
 * the issue body:
 *
 *   « j'édite un prix sans publier, Aperçu montre le NOUVEAU prix,
 *     getPublicMenu (PWA réelle) montre l'ANCIEN »
 *
 * Why a dedicated admin-side preview page (instead of an `?preview=true`
 * query on the eater PWA): the eater PWA (`apps/web`) does not yet ship its
 * menu route — the issue body explicitly leaves the detail free
 * (« implementation V1 simple »). The hard constraint is that the rendering
 * is sourced on the DRAFT (the page reads `previewMenu`, NOT `getPublicMenu`),
 * and the scope is `apps/admin/src/app/(app)/t/[tenantId]/menu/` ONLY.
 *
 * What's NOT covered here (and on purpose): the rendering of items / prices /
 * modifiers — `previewMenu` returns the same `PublicMenu` wire contract as
 * `getPublicMenu` so any rendering regression on the read path is caught by
 * the backend test suite; this page is a thin wiring layer mounting a pure
 * presentational view of the live draft.
 *
 * Scope discipline (#254 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/preview/` and is the ONLY new
 * surface touched by this story. Zero touch to `apps/web`, `apps/native`,
 * or `packages/backend/convex/`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("menu/preview/page.tsx — F-MENU-10 (#254) wiring contract", () => {
  it("reads the DRAFT via `api.lib.menu.publication.previewMenu` (the load-bearing surface, NOT getPublicMenu)", () => {
    // The whole point of the « Aperçu » feature: the gérant edits a price
    // without publishing, the preview must show the NEW price. The backend
    // exposes the draft-sourced renderer at `publication.previewMenu` (B-MENU-PUBLICATION
    // slice 4, #166). If the page accidentally read `catalog.getPublicMenu`
    // instead, it would show the published snapshot (= the OLD price) and
    // the AC would silently fail.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.menu\.publication\.previewMenu[^)]*\)/,
    );
  });

  it("does NOT read `catalog.getPublicMenu` (would surface the published snapshot, NOT the draft)", () => {
    // Defensive: pin the negative so a future copy/paste from the
    // (forthcoming) PWA route doesn't silently flip the source.
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/getPublicMenu/);
  });

  it("uses `useTenantQuery` (auto-injects tenantId — ADR 0014 §4) — never raw `useQuery`", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("scope — never imports from `apps/web`, `apps/native`, or the backend functions root", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
    expect(code).not.toMatch(/@packages\/backend\/convex\/lib\//);
  });
});
