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

  it("AC F-PRICING-3 (#248) — binds `api.lib.pricing.rules.update` via `useTenantMutation` (NOT raw useMutation)", () => {
    // Slice 3 (#248) layers EDIT on top: a second `useTenantMutation` against
    // `api.lib.pricing.rules.update`. The contract (auto-injected tenantId via
    // ADR 0014 §4 / #183, ADR 0010) is the same as create. Collapse whitespace
    // so a Prettier line-wrap inside the call still matches.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.pricing\.rules\.update[^)]*\)/,
    );
  });

  it("AC F-PRICING-3 (#248) — wires the list-row « Éditer » handler via the `onEditRule` prop of `PricingView`", () => {
    // The page-to-view contract: the row Éditer button is enabled by passing
    // `onEditRule={…}`. Pinning the prop name guarantees the page wires it
    // (and PricingView consumes the same name).
    expect(PAGE_SOURCE).toMatch(/onEditRule/);
  });

  it("AC F-PRICING-3 (#248) — passes the rule under edit to `RuleBuilderModal` via the `existingRule` prop", () => {
    // The modal's pre-fill contract: `existingRule={…}` switches the modal to
    // edit mode. The page owns the state.
    expect(PAGE_SOURCE).toMatch(/existingRule/);
  });

  it("AC F-PRICING-3 (#248) — branches submit on edit-vs-create (must reference `ruleId` in the update path)", () => {
    // The update mutation requires `ruleId` (from `existingRule._id`). The
    // create mutation does not. Pinning `ruleId` in the page source guarantees
    // we DO take the update branch — otherwise we'd silently insert a new rule
    // every save.
    expect(PAGE_SOURCE).toMatch(/ruleId/);
  });

  it("AC F-PRICING-4 (#249) — binds `api.lib.pricing.rules.setActive` via `useTenantMutation` (NOT raw useMutation)", () => {
    // Slice 4 (#249) wires the per-row Active/Inactive toggle. Same auto-
    // tenantId discipline as create/update (ADR 0014 §4 / #183, ADR 0010);
    // takes `{ ruleId, active }`. Collapse whitespace so a Prettier line-wrap
    // inside the call still matches.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.pricing\.rules\.setActive[^)]*\)/,
    );
  });

  it("AC F-PRICING-4 (#249) — wires the per-row toggle handler via the `onToggleActive` prop of `PricingView`", () => {
    // The page-to-view contract: the row toggle is enabled by passing
    // `onToggleActive={…}`. Pinning the prop name guarantees the page wires
    // it (and PricingView consumes the same name).
    expect(PAGE_SOURCE).toMatch(/onToggleActive/);
  });

  it("GUARDRAIL F-PRICING-4 (#249) — toggle handler does NOT call `removeRule(` (un toggle n'est PAS un delete déguisé)", () => {
    // The toggle's only sanctioned mutation is `setActive`. Slice 5 (#251)
    // now legitimately binds `api.lib.pricing.rules.remove` (the row delete
    // 2-click confirmation), so the file-level ban on the `remove` chain
    // can no longer hold. We narrow the ban: the `removeRule(` call site
    // (the bound mutation handle) must appear EXACTLY ONCE — inside the
    // delete handler. A future contributor wiring the toggle to `remove`
    // (instead of `setActive`) would add a second call site and trip this
    // assertion.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    const callMatches = code.match(/\bremoveRule\s*\(/g) ?? [];
    expect(callMatches.length).toBe(1);
  });

  it("GUARDRAIL F-PRICING-4 (#249) — `update` mutation is wired (slice 3 — Éditer modal) but is NOT referenced from any toggle handler (it stays the modal's exclusive consumer)", () => {
    // Defensive: `update` IS legitimately bound at the top of the file (slice
    // 3). The slice-4 ban is « the toggle handler must not call update » —
    // we pin it by asserting the page only references `update(` exactly once
    // in non-comment code, the one call inside the modal-submit branch. A
    // future contributor wiring the toggle to update (e.g. to flip
    // `active` by patching the row instead of calling `setActive`) would
    // double the count and this test fails.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    // Match call sites: `updateRule(` (the bound mutation handle) or any
    // direct `.update(` chain. We allow the binding line itself
    // (`useTenantMutation(api.lib.pricing.rules.update)`) — only count CALL
    // sites.
    const callMatches = code.match(/\bupdateRule\s*\(/g) ?? [];
    expect(callMatches.length).toBe(1);
  });

  it("AC F-PRICING-5 (#251) — binds `api.lib.pricing.rules.remove` via `useTenantMutation` (NOT raw useMutation)", () => {
    // Slice 5 (#251) wires the per-row 2-click delete. Same auto-tenantId
    // discipline as create/update/setActive (ADR 0014 §4 / #183, ADR 0010);
    // takes `{ ruleId }`. Collapse whitespace so a Prettier line-wrap inside
    // the call still matches.
    const collapsed = PAGE_SOURCE.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /useTenantMutation\([^)]*api\.lib\.pricing\.rules\.remove[^)]*\)/,
    );
  });

  it("AC F-PRICING-5 (#251) — wires the per-row delete handler via the `onDeleteRule` prop of `PricingView`", () => {
    // The page-to-view contract: the row delete button is enabled by passing
    // `onDeleteRule={…}`. Pinning the prop name guarantees the page wires it
    // (and PricingView consumes the same name).
    expect(PAGE_SOURCE).toMatch(/onDeleteRule/);
  });

  it("AC F-PRICING-5 (#251) — does NOT touch `update` from the delete handler (delete is `remove` ONLY, not a patch)", () => {
    // Defensive: slice 5 must call `api.lib.pricing.rules.remove`, NEVER
    // `update` to "soft-delete" a row by clearing its conditions. The slice-4
    // « toggle is not a delete déguisé » guardrail above already pins that
    // `updateRule(` is called exactly ONCE (the modal-submit branch). Slice 5
    // re-pins it: a delete handler MUST NOT add a second call site to
    // `updateRule(`. We re-evaluate the count here.
    const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "");
    const callMatches = code.match(/\bupdateRule\s*\(/g) ?? [];
    expect(callMatches.length).toBe(1);
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
