/**
 * F-PRICING-1 (#241) — `page.tsx` wiring contract (source-string assertions,
 * same pattern as `menu/page.test.ts` and `mes-clients/page.test.ts`).
 *
 * The page is a thin wiring layer: it MUST bind `api.lib.pricing.rules.list`
 * through `useTenantQuery` (ADR 0014 §4 / #183), never a raw `useQuery`
 * (which would bypass tenantId auto-injection — ADR 0010).
 *
 * The rendering branches (loading / empty / populated) are pinned by
 * `pricing-view.test.tsx`; here we pin the assembly itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE_SOURCE = readFileSync(path.resolve(__dirname, "./page.tsx"), "utf8");

describe("page.tsx — F-PRICING-1 (#241) wiring contract", () => {
  it("AC — binds `api.lib.pricing.rules.list` via `useTenantQuery` (not raw useQuery)", () => {
    expect(PAGE_SOURCE).toMatch(/useTenantQuery/);
    // Collapse whitespace so a Prettier line-wrap inside the call still matches.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantQuery\([^)]*api\.lib\.pricing\.rules\.list[^)]*\)/,
    );
  });

  it("AC — does NOT use a raw `useQuery` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // Strip comments + template strings before the check so a docstring
    // referring to `useQuery` doesn't false-positive.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("AC — delegates rendering to `PricingView` (keeps the page thin + the view testable)", () => {
    expect(PAGE_SOURCE).toMatch(/PricingView/);
  });

  it("AC F-PRICING-2 (#245) — binds `api.lib.pricing.rules.create` via `useTenantMutation`", () => {
    // The page must wire the create mutation through `useTenantMutation` (NOT
    // raw `useMutation`) so the `tenantId` is auto-injected (ADR 0014 §4 /
    // #183). Collapsing whitespace lets a Prettier line-wrap inside the call
    // still match.
    expect(PAGE_SOURCE).toMatch(/useTenantMutation/);
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.pricing\.rules\.create[^)]*\)/,
    );
  });

  it("AC F-PRICING-2 (#245) — does NOT use a raw `useMutation` (bypasses tenantId injection — ADR 0014 §4)", () => {
    // Strip comments + template strings before the check so a docstring
    // referring to `useMutation` doesn't false-positive.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    expect(code).not.toMatch(/\buseMutation\b/);
  });

  it("AC F-PRICING-2 (#245) — mounts the `RuleBuilderModal` (closed-list builder, slice 2)", () => {
    expect(PAGE_SOURCE).toMatch(/RuleBuilderModal/);
  });

  it("AC F-PRICING-2 (#245) — surfaces backend `ConvexError.data.message` for `CONTRADICTORY_CONDITIONS` via the modal's inline `submitError` prop (NOT a toast)", () => {
    // Issue body: « Pas de toast technique. » The page MUST catch the
    // ConvexError, branch on `data.code === "CONTRADICTORY_CONDITIONS"`,
    // and surface the server-rédigé message inline via `submitError` on
    // the modal. We pin BOTH grep substrings (`submitError`,
    // `CONTRADICTORY_CONDITIONS`) so a future refactor can't drop either
    // without an explicit test update.
    expect(PAGE_SOURCE).toMatch(/submitError/);
    expect(PAGE_SOURCE).toMatch(/CONTRADICTORY_CONDITIONS/);
    // The branch on ConvexError must exist (so we don't show « Unknown
    // error occurred » for a typed error the backend already worded).
    expect(PAGE_SOURCE).toMatch(/ConvexError/);
  });

  it("GUARDRAIL — does NOT import `api.lib.pricing.evaluate` (engine is backend-only, ADR 0013)", () => {
    // Issue body: « Pas d'import vers `api.lib.pricing.evaluate.evaluate` dans
    // tout le module pricing (assertion statique grep). »
    expect(PAGE_SOURCE).not.toMatch(/api\.lib\.pricing\.evaluate/);
  });

  it("GUARDRAIL — does NOT import dnd-kit / react-beautiful-dnd (no manual order)", () => {
    expect(PAGE_SOURCE).not.toMatch(/@dnd-kit/);
    expect(PAGE_SOURCE).not.toMatch(/react-beautiful-dnd/);
  });
});
