/**
 * F-MES-CLIENTS [1/4] (#181) — `shouldFireAudit`, the pure core of the
 * audit-on-open logic.
 *
 * The "Mes clients" route MUST call `api.lib.customer.kpi.logKpiConsultation`
 * exactly ONCE on every entry into the view (PRD 70 §4.4 + PRD 90 §4 —
 * detection scraping + RGPD trace; one row per visite, never per re-render).
 *
 * The trickiness comes from React 19 + Next App Router's StrictMode dev double-
 * mount: the naïve `useEffect(() => mutate(), [])` fires twice in dev. The
 * remedy is a `useRef` holding the LAST tenantId we already audited; a fresh
 * call only happens when the current `tenantId` differs from the ref.
 *
 * To pin this contract under the project's `environment: "node"` vitest config
 * (no jsdom, see `vitest.config.ts` — same pattern as `decideSessionGate`,
 * `decideTenantGate`, `readTenantIdOrThrow`), we extract the rule into a pure
 * function and assert every acceptance criterion of #181 here. The React hook
 * is a thin shell that executes the decision.
 *
 * Acceptance criteria covered (#181):
 *   - AC2 « Au mount, logKpiConsultation est appelée exactement 1x » →
 *     `shouldFireAudit(undefined, T)` returns `{ fire: true, nextRef: T }`.
 *   - AC3 « Au remount avec tenantId différent, logKpiConsultation est appelée
 *     à nouveau » → `shouldFireAudit(T, U)` returns `{ fire: true, nextRef: U }`.
 *   - AC4 « Au re-render sans changement de tenantId, logKpiConsultation n'est
 *     PAS rappelée » → `shouldFireAudit(T, T)` returns `{ fire: false, nextRef: T }`.
 *   - AC5 « Le double-mount React Strict Mode ne produit pas de double appel »
 *     → after firing once (ref set to T), the next call with the same T is
 *     suppressed. Exercised here by sequencing two consecutive calls.
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { shouldFireAudit } from "./audit-on-open";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const TENANT_B = "tenants_bbb" as unknown as Id<"tenants">;

describe("shouldFireAudit (core of useAuditOnOpen)", () => {
  it("AC2 — fresh mount (no previous ref) fires the audit once", () => {
    expect(shouldFireAudit(undefined, TENANT_A)).toEqual({
      fire: true,
      nextRef: TENANT_A,
    });
  });

  it("AC4 — re-render with the SAME tenantId does NOT fire again", () => {
    // After a successful first call the ref was set to TENANT_A; a subsequent
    // pass with the same tenant must be a no-op (the visite has already been
    // audited — PRD 90 §4 demands 1 row per visite, not 1 per re-render).
    expect(shouldFireAudit(TENANT_A, TENANT_A)).toEqual({
      fire: false,
      nextRef: TENANT_A,
    });
  });

  it("AC3 — remount with a DIFFERENT tenantId fires the audit again", () => {
    // Mounting the view at a new /t/[id] (tenant switch) is a brand-new
    // consultation — must produce a second audit row.
    expect(shouldFireAudit(TENANT_A, TENANT_B)).toEqual({
      fire: true,
      nextRef: TENANT_B,
    });
  });

  it("AC5 — React Strict Mode double-mount sequence: only the first call fires", () => {
    // Strict Mode renders the component, runs the effect, immediately tears it
    // down and re-runs it. With `useRef` carrying state across both passes,
    // the second pass observes `prev === current` and must NOT fire.
    const first = shouldFireAudit(undefined, TENANT_A);
    expect(first.fire).toBe(true);
    const second = shouldFireAudit(first.nextRef, TENANT_A);
    expect(second.fire).toBe(false);
  });

  it("does not fire when current tenantId is undefined (defensive: never audit a non-existent tenant)", () => {
    // The page route only mounts under a valid `/t/[tenantId]` segment so
    // `tenantId` is always defined at runtime, but the helper is total: an
    // undefined input is a no-op (no fire, ref unchanged) rather than a crash.
    expect(shouldFireAudit(undefined, undefined)).toEqual({
      fire: false,
      nextRef: undefined,
    });
    expect(shouldFireAudit(TENANT_A, undefined)).toEqual({
      fire: false,
      nextRef: TENANT_A,
    });
  });

  it("full sequence A → A (strict-mode) → switch to B → B (strict-mode) → back to A: 3 fires total", () => {
    // End-to-end: validates that the ref propagation correctly suppresses
    // duplicates while re-firing on every real switch — including switching
    // BACK to a previously-audited tenant (new visite, new row).
    let ref: Id<"tenants"> | undefined;
    const calls: Id<"tenants">[] = [];
    const step = (current: Id<"tenants">) => {
      const r = shouldFireAudit(ref, current);
      ref = r.nextRef;
      if (r.fire && current !== undefined) calls.push(current);
    };
    step(TENANT_A); // mount A → fire
    step(TENANT_A); // strict-mode re-run → no-op
    step(TENANT_B); // switch to B → fire
    step(TENANT_B); // strict-mode re-run → no-op
    step(TENANT_A); // come back to A → fire (new visite)
    expect(calls).toEqual([TENANT_A, TENANT_B, TENANT_A]);
  });
});
