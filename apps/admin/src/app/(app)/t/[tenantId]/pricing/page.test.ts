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
