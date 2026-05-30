/**
 * F-SHELL-05 (#183) — pure core shared by `useTenantQuery` and
 * `useTenantMutation`: how does one inject the `tenantId` from the
 * `TenantContext` into the args passed to a Convex `tenantQuery` /
 * `tenantMutation`?
 *
 * The hooks themselves are thin wrappers around `useQuery` / `useMutation`
 * (`convex/react`) — the only logic worth pinning by vitest in the lean node
 * env is this merge step:
 *
 *   - args `undefined`        → `{ tenantId }`
 *   - args `{ foo: 1 }`       → `{ tenantId, foo: 1 }`
 *   - args `"skip"`           → `"skip"` (passthrough; the Convex hook reads
 *                                this sentinel and skips the subscription)
 *
 * Hard rules (ADR 0014 §4):
 *   - The injected `tenantId` ALWAYS wins over a same-named field in `args`.
 *     A surface that hand-wrote `tenantId` got the rule wrong; we silently
 *     override to keep the invariant ("the tenant courant comes from the URL,
 *     period").
 *   - We never mutate the caller's `args` object.
 *   - The function is pure — given the same inputs, same output, no React.
 *     This is what lets `apps/admin/vitest.config.ts` stay `environment: "node"`.
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { mergeTenantArgs } from "./merge-tenant-args";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const TENANT_B = "tenants_bbb" as unknown as Id<"tenants">;

describe("mergeTenantArgs", () => {
  it("returns { tenantId } when args is undefined (zero-arg tenant query)", () => {
    expect(mergeTenantArgs(TENANT_A, undefined)).toEqual({
      tenantId: TENANT_A,
    });
  });

  it("merges tenantId into an existing args object (preserves all other keys)", () => {
    expect(mergeTenantArgs(TENANT_A, { foo: 1, bar: "x" })).toEqual({
      tenantId: TENANT_A,
      foo: 1,
      bar: "x",
    });
  });

  it('passes "skip" through unchanged (Convex sentinel — the underlying useQuery sees "skip" and does NOT subscribe)', () => {
    expect(mergeTenantArgs(TENANT_A, "skip")).toBe("skip");
  });

  it("overrides a tenantId field already present in args (URL is always the source of truth, ADR 0014 §4)", () => {
    // A surface that hand-wrote tenantId got the rule wrong — we silently
    // override rather than honour the caller's stale value.
    const merged = mergeTenantArgs(TENANT_A, { tenantId: TENANT_B, foo: 1 });
    expect(merged).toEqual({ tenantId: TENANT_A, foo: 1 });
  });

  it("does not mutate the caller's args object", () => {
    const args = { foo: 1 } as const;
    mergeTenantArgs(TENANT_A, args);
    expect(args).toEqual({ foo: 1 });
    expect(args).not.toHaveProperty("tenantId");
  });

  it("returns a fresh object on each call (no shared reference between merges)", () => {
    const a = mergeTenantArgs(TENANT_A, { foo: 1 });
    const b = mergeTenantArgs(TENANT_A, { foo: 1 });
    expect(a).not.toBe(b);
  });
});
