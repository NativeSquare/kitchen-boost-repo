/**
 * F-SHELL-04 — `useCurrentTenantId()` semantics, exercised through its pure
 * core (`readTenantIdOrThrow`) so vitest can pin the throw-on-misuse contract
 * without jsdom / react-testing-library (same pattern as `decideSessionGate`).
 *
 * The hook itself is a one-liner:
 *
 *   export function useCurrentTenantId(): Id<"tenants"> {
 *     return readTenantIdOrThrow(useContext(TenantContext));
 *   }
 *
 * So pinning the read function = pinning the hook's two acceptance criteria
 * from issue #175:
 *   - returns the branded `Id<"tenants">` when called under a layout `/t/[id]`,
 *   - throws an explicit error when called outside such a layout.
 */
import { describe, expect, it, expectTypeOf } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { readTenantIdOrThrow } from "./tenant-context";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;

describe("readTenantIdOrThrow (core of useCurrentTenantId)", () => {
  it('returns the branded Id<"tenants"> when provider value is present', () => {
    expect(readTenantIdOrThrow(TENANT_A)).toBe(TENANT_A);
  });

  it("throws with an explicit message when context is null (called outside a `/t/[id]` layout)", () => {
    expect(() => readTenantIdOrThrow(null)).toThrowError(
      /useCurrentTenantId.*outside.*\/t\/\[/i,
    );
  });

  it('the return type is Id<"tenants"> (branded) — not a raw string', () => {
    // The whole point of plumbing the brand through is that downstream
    // useTenantQuery / URL builders can't accidentally accept a non-tenant id.
    const id = readTenantIdOrThrow(TENANT_A);
    expectTypeOf(id).toEqualTypeOf<Id<"tenants">>();
  });
});
