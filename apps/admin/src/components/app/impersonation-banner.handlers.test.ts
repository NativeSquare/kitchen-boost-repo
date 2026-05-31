/**
 * F-SHELL-08 (#214) — pure handlers for `ImpersonationBanner`.
 *
 * The component's only side effect on user interaction is the « Quitter »
 * click → leave impersonation → go back to supervision. That branching is
 * isolated in `makeImpersonationHandlers()` so vitest can pin it in node env
 * without a router / DOM (same pattern as `no-tenant-empty-state.handlers`).
 *
 * The target URL is the canonical supervision route exposed by
 * `@/lib/supervision-route` — the SAME constant the `TenantSwitcher`
 * « Supervision » entry uses (ADR 0014 §7 + §8). Issue #214 acceptance reads
 * `router.push("/pipeline")`, but the live supervision route today is
 * `/monitoring` (the `/pipeline` page doesn't exist yet, and pointing at it
 * would surface as a dead button — the same A2 symptom the tenant-switcher
 * already documented). Both the switcher's « Supervision » entry and this
 * « Quitter » button read from the SAME `SUPERVISION_ROUTE` constant, so
 * when `/pipeline` lands, ONE edit updates both surfaces and the contract
 * holds. The test asserts on the shared constant rather than the literal
 * string to keep the two in lock-step.
 *
 * Also clears the `kb_current_tenant` cookie on exit — mirrors the
 * TenantSwitcher's `clearTenantCookie()` discipline (selecting Supervision
 * means "no tenant courant"). Without this, the next fresh load would
 * re-impersonate the same tenant via the cookie hint.
 */
import { describe, expect, it } from "vitest";
import {
  makeImpersonationHandlers,
  SUPERVISION_ROUTE,
} from "./impersonation-banner";

describe("makeImpersonationHandlers — F-SHELL-08 (#214)", () => {
  it("handleQuit navigates to SUPERVISION_ROUTE (shared constant — kept in sync with TenantSwitcher's Supervision entry)", () => {
    const navigations: string[] = [];
    const { handleQuit } = makeImpersonationHandlers({
      navigate: (path) => navigations.push(path),
      clearTenantHint: () => {},
    });
    handleQuit();
    expect(navigations).toEqual([SUPERVISION_ROUTE]);
  });

  it("handleQuit clears the kb_current_tenant cookie hint BEFORE navigating (next load resumes in supervision, not the just-quit tenant)", () => {
    const events: string[] = [];
    const { handleQuit } = makeImpersonationHandlers({
      navigate: () => events.push("navigate"),
      clearTenantHint: () => events.push("clear"),
    });
    handleQuit();
    expect(events).toEqual(["clear", "navigate"]);
  });

  it("SUPERVISION_ROUTE is a non-empty absolute path (defensive — never an empty string or relative)", () => {
    expect(SUPERVISION_ROUTE.length).toBeGreaterThan(0);
    expect(SUPERVISION_ROUTE.startsWith("/")).toBe(true);
  });
});
