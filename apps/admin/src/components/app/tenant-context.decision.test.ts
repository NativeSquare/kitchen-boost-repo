/**
 * F-SHELL-04 — `decideTenantGate` decision logic, pinned as a pure function.
 *
 * The layout itself (`apps/admin/src/app/(app)/t/[tenantId]/layout.tsx`) is a
 * `"use client"` component (uses `useParams`, `useRouter`, `useSession`, plus a
 * `useQuery` against the kb_admin existence probe). The branching for
 * "what should the layout DO given (session, urlTenantId, cookieTenantId,
 * adminTenantLookup)?" is extracted into `decideTenantGate()` so every
 * acceptance criterion of issue #175 can be pinned by vitest in node env, no
 * DOM, no Convex client — same split as `decideSessionGate` (#164).
 *
 * The pure function answers ONE of four actions:
 *   - `wait`     → session still loading, or admin tenant lookup in flight.
 *   - `redirect` → KB Manager landed on a tenant they don't own → push them
 *                  to a default tenant they DO own (cookie hint > first in
 *                  `session.tenants`).
 *   - `not-found`→ KB Admin landed on a tenantId that does not exist in DB
 *                  → render Next.js `notFound()`.
 *   - `allow`    → tenant is valid for this actor; render children + provide
 *                  `tenantId` via context + write cookie.
 *
 * The cookie `kb_current_tenant` is NEVER the source of truth (ADR 0014 §4):
 *   - On `allow` it is REWRITTEN to the current `tenantId` (so the next
 *     session resumes here).
 *   - On `redirect` it is used as a HINT to pick the default tenant when
 *     valid; ignored when stale (pointing at a tenant the manager no longer
 *     owns).
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideTenantGate, type TenantGateInput } from "./tenant-context";
import type { SessionState } from "@/lib/session";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const TENANT_B = "tenants_bbb" as unknown as Id<"tenants">;
const TENANT_C = "tenants_ccc" as unknown as Id<"tenants">;
const TENANT_GHOST = "tenants_ghost" as unknown as Id<"tenants">;

function managerSession(
  tenants: Array<{ id: Id<"tenants">; slug: string; name: string }>,
): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: false,
      tenants: tenants.map((t) => ({
        tenantId: t.id,
        slug: t.slug,
        name: t.name,
        role: "kb_manager",
      })),
    },
  };
}

function adminSession(): SessionState {
  return {
    status: "ready",
    session: { isAdmin: true, tenants: [] },
  };
}

describe("decideTenantGate", () => {
  it("status=loading → `wait` (no decision yet, do not render children, do not redirect)", () => {
    const input: TenantGateInput = {
      session: { status: "loading" },
      urlTenantId: TENANT_A,
      cookieTenantId: undefined,
      adminTenantLookup: undefined,
    };
    expect(decideTenantGate(input)).toEqual({ kind: "wait" });
  });

  it("status=unauthenticated → `wait` (the parent SessionGuard owns the /login redirect, this layer just defers)", () => {
    const input: TenantGateInput = {
      session: { status: "unauthenticated" },
      urlTenantId: TENANT_A,
      cookieTenantId: undefined,
      adminTenantLookup: undefined,
    };
    expect(decideTenantGate(input)).toEqual({ kind: "wait" });
  });

  // --- KB Manager branch ------------------------------------------------------

  it("KB Manager on a tenant in their list → `allow` (carries the validated tenantId for context + cookie write)", () => {
    const input: TenantGateInput = {
      session: managerSession([
        { id: TENANT_A, slug: "lartisan", name: "L'Artisan" },
      ]),
      urlTenantId: TENANT_A,
      cookieTenantId: undefined,
      adminTenantLookup: undefined,
    };
    expect(decideTenantGate(input)).toEqual({
      kind: "allow",
      tenantId: TENANT_A,
    });
  });

  it("KB Manager on a tenant NOT in their list, cookie valid → `redirect` to cookie tenant (last-opened resto)", () => {
    const input: TenantGateInput = {
      session: managerSession([
        { id: TENANT_A, slug: "a", name: "A" },
        { id: TENANT_B, slug: "b", name: "B" },
      ]),
      urlTenantId: TENANT_GHOST,
      cookieTenantId: TENANT_B,
      adminTenantLookup: undefined,
    };
    expect(decideTenantGate(input)).toEqual({
      kind: "redirect",
      tenantId: TENANT_B,
    });
  });

  it("KB Manager on a tenant NOT in their list, cookie ALSO stale → `redirect` to first tenant in session.tenants", () => {
    const input: TenantGateInput = {
      session: managerSession([
        { id: TENANT_A, slug: "a", name: "A" },
        { id: TENANT_B, slug: "b", name: "B" },
      ]),
      urlTenantId: TENANT_GHOST,
      cookieTenantId: TENANT_C, // a tenant the manager no longer owns
      adminTenantLookup: undefined,
    };
    expect(decideTenantGate(input)).toEqual({
      kind: "redirect",
      tenantId: TENANT_A,
    });
  });

  it("KB Manager on a tenant NOT in their list, no cookie → `redirect` to first tenant", () => {
    const input: TenantGateInput = {
      session: managerSession([
        { id: TENANT_A, slug: "a", name: "A" },
        { id: TENANT_B, slug: "b", name: "B" },
      ]),
      urlTenantId: TENANT_GHOST,
      cookieTenantId: undefined,
      adminTenantLookup: undefined,
    };
    expect(decideTenantGate(input)).toEqual({
      kind: "redirect",
      tenantId: TENANT_A,
    });
  });

  // --- KB Admin branch --------------------------------------------------------

  it("KB Admin, adminTenantLookup still in flight → `wait` (cannot decide existence yet)", () => {
    const input: TenantGateInput = {
      session: adminSession(),
      urlTenantId: TENANT_A,
      cookieTenantId: undefined,
      adminTenantLookup: undefined,
    };
    expect(decideTenantGate(input)).toEqual({ kind: "wait" });
  });

  it("KB Admin on an existing tenant → `allow` (root override; tenant existence confirmed by lookup)", () => {
    const input: TenantGateInput = {
      session: adminSession(),
      urlTenantId: TENANT_A,
      cookieTenantId: undefined,
      adminTenantLookup: { exists: true },
    };
    expect(decideTenantGate(input)).toEqual({
      kind: "allow",
      tenantId: TENANT_A,
    });
  });

  it("KB Admin on a non-existent tenantId → `not-found` (the clean 404 from acceptance #175)", () => {
    const input: TenantGateInput = {
      session: adminSession(),
      urlTenantId: TENANT_GHOST,
      cookieTenantId: undefined,
      adminTenantLookup: { exists: false },
    };
    expect(decideTenantGate(input)).toEqual({ kind: "not-found" });
  });
});
