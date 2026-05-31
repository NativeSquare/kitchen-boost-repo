/**
 * F-WIZARD [1/10] (#265) — `useWizardState` source-level wiring contract.
 *
 * The hook is a thin Convex-side adapter: it reads the prospect + the tenant
 * (via back-link) + the published menu snapshot + the manager invite, then
 * delegates the actual step heuristic to the pure `computeWizardState`
 * function (which is exhaustively pinned by `wizard.decision.test.ts`).
 *
 * Stub note (mirrors `pipeline/[prospectId]/page.tsx`): the underlying
 * `api.prospects.get` / `api.lib.tenants.get` / `api.lib.menu.publication.*`
 * / `api.lib.admin.managerInvites.*` queries are NOT all live yet. The hook
 * stubs the ones missing (this slice's scope, issue #265 « Aucune mutation
 * business n'est branchée ici »). Each follow-up wizard slice swaps its
 * own stub for the real `useQuery` call.
 *
 * What's pinned here at the source-file level:
 *   - exports `useWizardState`.
 *   - delegates to the pure `computeWizardState` (so future contributors
 *     keep the heuristic in the pure layer, not in the hook).
 *   - exposes `goToStep` as a callback in the returned shape.
 *   - never imports from `apps/web` or `apps/native`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const HOOK_SOURCE = readFileSync(
  path.resolve(__dirname, "./use-wizard-state.ts"),
  "utf8",
);

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("use-wizard-state.ts — F-WIZARD [1/10] (#265) wiring contract", () => {
  it("exports `useWizardState`", () => {
    expect(HOOK_SOURCE).toMatch(/export\s+function\s+useWizardState\b/);
  });

  it("delegates the step heuristic to the pure `computeWizardState`", () => {
    const code = stripNonCode(HOOK_SOURCE);
    expect(code).toMatch(/computeWizardState\b/);
  });

  it("exposes a `goToStep` callback in the returned shape (matches issue spec)", () => {
    const code = stripNonCode(HOOK_SOURCE);
    expect(code).toMatch(/goToStep\b/);
  });

  it("scope — never imports from `apps/web` or `apps/native`", () => {
    const code = stripNonCode(HOOK_SOURCE);
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });

  it('hook module is marked `"use client"` (uses React state + Convex hooks)', () => {
    expect(HOOK_SOURCE).toMatch(/^["']use client["']/m);
  });

  // F-WIZARD [9/10] (#273) — slice 9/10 wires the managerInvite query.
  it("F-WIZARD [9/10] — wires `getLatestManagerInviteForTenant` (no longer stubbed)", () => {
    const code = stripNonCode(HOOK_SOURCE);
    // The hook must reference the new kbAdminQuery exposed by
    // `lib/admin/managerInvites.ts` so step 7's completion gate flips when
    // a row exists.
    expect(code).toMatch(/getLatestManagerInviteForTenant/);
    // The previous STUB sentinel must be gone (we no longer hard-set
    // `managerInvite` to `undefined`).
    expect(code).not.toMatch(/managerInvite[^=]*=\s*undefined\s*;/);
  });
});
