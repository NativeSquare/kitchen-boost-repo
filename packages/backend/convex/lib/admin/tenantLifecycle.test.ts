import { describe, expect, it } from "vitest";
import {
  TENANT_STATUS_TRANSITIONS,
  type TenantStatus,
  assertLegalTenantTransition,
  isLegalTenantTransition,
} from "./tenantLifecycle";

/**
 * B-TENANT-LIFECYCLE [2/4] — the PURE tenant lifecycle state machine (PRD 70
 * §3.6, Multi-Tenant CONTEXT), written BEFORE the implementation (TDD red).
 *
 * The state machine is the SINGLE source of truth for which tenant status
 * transitions are legal; the upcoming `tenant.updateSettings` (D5) and
 * `tenant.activate` (D6) mutations defer to it so an illegal move
 * (e.g. `disabled → active`) can never be persisted. Mirrors the contract
 * lifecycle pattern (lifecycle.ts) exactly.
 *
 * V1 matrix (strict — V2 will widen):
 *  - `pending → active`     : tenant activated by KB Admin
 *  - `active` / `suspended` / `disabled` : ALL terminal in V1
 */

const ALL_STATUSES: TenantStatus[] = [
  "pending",
  "active",
  "suspended",
  "disabled",
];

describe("B-TENANT-LIFECYCLE [2/4] tenant lifecycle state machine — legal transitions", () => {
  it("allows pending → active", () => {
    expect(isLegalTenantTransition("pending", "active")).toBe(true);
  });

  it("marks active as terminal (no outgoing edges in V1)", () => {
    expect(TENANT_STATUS_TRANSITIONS.active).toEqual([]);
  });

  it("marks suspended as terminal (no outgoing edges in V1)", () => {
    expect(TENANT_STATUS_TRANSITIONS.suspended).toEqual([]);
  });

  it("marks disabled as terminal (no outgoing edges in V1)", () => {
    expect(TENANT_STATUS_TRANSITIONS.disabled).toEqual([]);
  });

  it("rejects every illegal pair across the full matrix", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const isLegal = from === "pending" && to === "active";
        expect(isLegalTenantTransition(from, to)).toBe(isLegal);
      }
    }
  });

  it("rejects self-loops", () => {
    for (const s of ALL_STATUSES) {
      expect(isLegalTenantTransition(s, s)).toBe(false);
    }
  });

  it("rejects backward / re-activation moves", () => {
    expect(isLegalTenantTransition("active", "pending")).toBe(false);
    expect(isLegalTenantTransition("suspended", "active")).toBe(false);
    expect(isLegalTenantTransition("disabled", "active")).toBe(false);
  });

  it("assertLegalTenantTransition throws INVALID_STATE on an illegal edge with a clear message", () => {
    expect(() => assertLegalTenantTransition("disabled", "active")).toThrow(
      /disabled.*active/i,
    );
    expect(() => assertLegalTenantTransition("active", "pending")).toThrow(
      /active.*pending/i,
    );
  });

  it("assertLegalTenantTransition does NOT throw on the legal pending → active edge", () => {
    expect(() =>
      assertLegalTenantTransition("pending", "active"),
    ).not.toThrow();
  });

  it("throws a ConvexError carrying code INVALID_STATE (object payload)", () => {
    try {
      assertLegalTenantTransition("disabled", "active");
      expect.unreachable("should have thrown");
    } catch (err) {
      const data = (err as { data?: { code?: string; message?: string } }).data;
      expect(data?.code).toBe("INVALID_STATE");
      expect(typeof data?.message).toBe("string");
    }
  });
});
