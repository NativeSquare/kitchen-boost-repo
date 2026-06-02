/**
 * F-WIZARD [1/10] (#265) — `page.tsx` wiring contract.
 *
 * Same source-file-level pattern as `pipeline/[prospectId]/page.test.ts`. The
 * page is a thin "use client" adapter on top of:
 *   - `useSession()` (F-SHELL-01)
 *   - `useParams<{ prospectId }>()` (Next.js App Router)
 *   - `useWizardState(prospectId)` — the wizard hook bundled in this slice
 *   - the pure `decideWizardShell` + `WizardView` view.
 *
 * Stub note (mirrors `pipeline/[prospectId]/page.tsx`): `api.prospects.get`
 * does NOT yet exist (lands in F-PIPELINE-CRM). The wizard hook short-circuits
 * its prospect read to `undefined` for now — the route itself is wired, the
 * SessionGuard + decideWizardShell still pin the 403 for KB Managers, and
 * `loading-prospect` covers the « still resolving » UX. When F-PIPELINE-CRM
 * ships `api.prospects.get`, swap the stub for the live `useQuery` call — the
 * rest of the wiring (params, session, view, route) does not move.
 *
 * What's pinned here (acceptance criteria #265):
 *   - exports a default function (Next.js App Router page contract).
 *   - delegates rendering to `WizardView` (keeps the page thin so the view's
 *     branches stay pinned by `wizard-view.test.tsx` under the lean `node`
 *     vitest env).
 *   - uses `useSession` so the access gate fires BEFORE the (stubbed) query.
 *   - uses `useParams` to read the `prospectId` URL segment.
 *   - uses `useWizardState` (the bundled hook) for the step heuristic.
 *   - scope — never imports from `apps/web` or `apps/native`.
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

describe("page.tsx — F-WIZARD [1/10] (#265) wiring contract", () => {
  it("exports a default function (the Next.js App Router page contract)", () => {
    expect(PAGE_SOURCE).toMatch(/export\s+default\s+(?:function|\w)/);
  });

  it("delegates rendering to `WizardView` (keeps the page thin + the view testable in node env)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/WizardView/);
  });

  it("reads the session via `useSession` so the access gate fires before any data hydration", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useSession\b/);
  });

  it("reads the URL segment via `useParams<{ prospectId }>`", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useParams\b/);
    expect(code).toMatch(/prospectId/);
  });

  it("wires the wizard heuristic via `useWizardState` (the bundled hook)", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useWizardState\b/);
  });

  it("scope — never imports from `apps/web` or `apps/native`", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });

  it('page is marked `"use client"` (uses client hooks — useSession, useParams)', () => {
    expect(PAGE_SOURCE).toMatch(/^["']use client["']/m);
  });

  // Issue #392 — RBAC skip guard threading.
  //
  // The hook's queries are kbAdminQuery-gated; if the page doesn't pass the
  // session through, a KB Manager hitting the URL would surface a raw
  // Convex FORBIDDEN error instead of the canonical `UnauthorizedCard`.
  // Pin the exact thread (page → hook → skip-sentinel) at the source level
  // so a future refactor that drops the second arg breaks here BEFORE the
  // bug ships.
  it("issue #392 — threads `session` to `useWizardState` so the hook can skip-sentinel its kbAdminQuery reads on a non-admin actor", () => {
    const code = stripNonCode(PAGE_SOURCE);
    expect(code).toMatch(/useWizardState\s*\(\s*prospectId\s*,\s*session\s*\)/);
  });
});
