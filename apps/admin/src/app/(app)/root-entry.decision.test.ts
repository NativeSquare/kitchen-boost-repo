/**
 * F-SHELL-09 — `decideRootEntry` decision logic, pinned as a pure function.
 *
 * The React shell (`apps/admin/src/app/(app)/page.tsx`) is a thin
 * `"use client"` adapter (reads the session via `useSession`, reads the
 * cookie via `document.cookie`, then calls `router.replace(href)`); all of
 * the branching it could possibly do lives here so vitest pins every
 * acceptance criterion of issue #223 without DOM / router / Convex. Same
 * split as `decideTenantGate` (#175) and `decideSessionGate` (#164).
 *
 * Acceptance criteria pinned (issue #223):
 *
 *   - KB Admin entre sur `/` → arrive sur `/monitoring`.
 *     (ADR 0014 §5 canonical = `/pipeline`; live alias = `/monitoring`
 *     while the pipeline epic ships — see KB_ADMIN_LANDING docblock in
 *     `root-entry.decision.ts`.)
 *   - KB Manager mono-tenant → `/t/<X>/menu`.
 *   - KB Manager multi-tenant + cookie `kb_current_tenant=Y` (Y owned) →
 *     `/t/<Y>/menu`.
 *   - KB Manager multi-tenant sans cookie → `/t/<tenants[0]>/menu`.
 *   - KB Manager multi-tenant + cookie invalide (Y pas dans la liste) →
 *     fallback `/t/<tenants[0]>/menu`.
 *
 * Bonus coverage (defensive — keeps the function honest if upstream guard
 * is ever bypassed):
 *   - session loading / unauthenticated → `wait` (no redirect).
 *   - KB Admin avec tenants attachés → toujours `/monitoring` (les restos
 *     se rejoignent via le switcher, pas via auto-redirect — ADR 0014 §1).
 *   - non-admin sans tenants → `wait` (le `SessionGuard` est censé rendre
 *     `NoTenantEmptyState` upstream, on ne crash pas si jamais on y arrive).
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { buildTenantLanding, decideRootEntry } from "./root-entry.decision";
import type { SessionState } from "@/lib/session";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const TENANT_B = "tenants_bbb" as unknown as Id<"tenants">;
const TENANT_C = "tenants_ccc" as unknown as Id<"tenants">;
const TENANT_GHOST = "tenants_ghost" as unknown as Id<"tenants">;
const FIXTURE_USER = {
  userId: "users_xxx" as unknown as Id<"users">,
  email: "fixture@kb.test",
};

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
      user: FIXTURE_USER,
    },
  };
}

function adminSession(
  tenants: Array<{ id: Id<"tenants">; slug: string; name: string }> = [],
): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: true,
      tenants: tenants.map((t) => ({
        tenantId: t.id,
        slug: t.slug,
        name: t.name,
        role: "kb_manager",
      })),
      user: FIXTURE_USER,
    },
  };
}

describe("decideRootEntry — session not ready", () => {
  it("status=loading → `wait` (parent loader owns the spinner)", () => {
    expect(
      decideRootEntry({
        session: { status: "loading" },
        cookieTenantId: undefined,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("status=unauthenticated → `wait` (parent SessionGuard owns the /login redirect)", () => {
    expect(
      decideRootEntry({
        session: { status: "unauthenticated" },
        cookieTenantId: undefined,
      }),
    ).toEqual({ kind: "wait" });
  });
});

describe("decideRootEntry — KB Admin", () => {
  it("KB Admin (no attached tenants) → `/monitoring` (live alias of /pipeline supervision target)", () => {
    expect(
      decideRootEntry({
        session: adminSession(),
        cookieTenantId: undefined,
      }),
    ).toEqual({ kind: "redirect", href: "/monitoring" });
  });

  it("KB Admin WITH attached tenants → still `/monitoring` (resto views reachable via switcher, never auto-redirect — ADR 0014 §1)", () => {
    expect(
      decideRootEntry({
        session: adminSession([
          { id: TENANT_A, slug: "lartisan", name: "L'Artisan" },
        ]),
        cookieTenantId: undefined,
      }),
    ).toEqual({ kind: "redirect", href: "/monitoring" });
  });

  it("KB Admin + cookie hint → still `/monitoring` (cookie ignored for admin; supervision is the home)", () => {
    expect(
      decideRootEntry({
        session: adminSession([
          { id: TENANT_A, slug: "a", name: "A" },
          { id: TENANT_B, slug: "b", name: "B" },
        ]),
        cookieTenantId: TENANT_B,
      }),
    ).toEqual({ kind: "redirect", href: "/monitoring" });
  });
});

describe("decideRootEntry — KB Manager mono-tenant", () => {
  it("KB Manager with exactly one tenant → `/t/<X>/menu`", () => {
    expect(
      decideRootEntry({
        session: managerSession([
          { id: TENANT_A, slug: "lartisan", name: "L'Artisan" },
        ]),
        cookieTenantId: undefined,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/t/tenants_aaa/menu",
    });
  });

  it("mono-tenant ignores the cookie (no ambiguity to disambiguate)", () => {
    // Even a stale cookie pointing elsewhere doesn't matter — the manager
    // has exactly one resto and goes there.
    expect(
      decideRootEntry({
        session: managerSession([{ id: TENANT_A, slug: "a", name: "A" }]),
        cookieTenantId: TENANT_GHOST,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/t/tenants_aaa/menu",
    });
  });
});

describe("decideRootEntry — KB Manager multi-tenant", () => {
  it("no cookie → fallback to first tenant in the list", () => {
    expect(
      decideRootEntry({
        session: managerSession([
          { id: TENANT_A, slug: "a", name: "A" },
          { id: TENANT_B, slug: "b", name: "B" },
        ]),
        cookieTenantId: undefined,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/t/tenants_aaa/menu",
    });
  });

  it("cookie hint valid (points at an owned tenant) → cookie wins (last opened resto, ADR 0014 §4)", () => {
    expect(
      decideRootEntry({
        session: managerSession([
          { id: TENANT_A, slug: "a", name: "A" },
          { id: TENANT_B, slug: "b", name: "B" },
          { id: TENANT_C, slug: "c", name: "C" },
        ]),
        cookieTenantId: TENANT_B,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/t/tenants_bbb/menu",
    });
  });

  it("cookie hint stale (points at a tenant the manager no longer owns) → fallback to first tenant", () => {
    expect(
      decideRootEntry({
        session: managerSession([
          { id: TENANT_A, slug: "a", name: "A" },
          { id: TENANT_B, slug: "b", name: "B" },
        ]),
        cookieTenantId: TENANT_GHOST,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/t/tenants_aaa/menu",
    });
  });

  it("cookie hint valid + 3 tenants → cookie wins even when it's the LAST one (no off-by-one on position)", () => {
    expect(
      decideRootEntry({
        session: managerSession([
          { id: TENANT_A, slug: "a", name: "A" },
          { id: TENANT_B, slug: "b", name: "B" },
          { id: TENANT_C, slug: "c", name: "C" },
        ]),
        cookieTenantId: TENANT_C,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/t/tenants_ccc/menu",
    });
  });
});

describe("decideRootEntry — defensive", () => {
  it("non-admin + 0 tenants → `wait` (SessionGuard is supposed to intercept upstream; we hold rather than crash)", () => {
    expect(
      decideRootEntry({
        session: {
          status: "ready",
          session: {
            isAdmin: false,
            tenants: [],
            user: FIXTURE_USER,
          },
        },
        cookieTenantId: undefined,
      }),
    ).toEqual({ kind: "wait" });
  });
});

describe("buildTenantLanding", () => {
  it("returns the canonical operational landing for a tenant (`/t/<id>/menu`)", () => {
    expect(buildTenantLanding(TENANT_A)).toBe("/t/tenants_aaa/menu");
  });

  it("matches the `/t/[id]` root page redirect target — chrome and URL agree", () => {
    // The `/t/[id]/page.tsx` redirects to `/t/[id]/menu`. Whether the user
    // lands here via the root redirect or via the tenant switcher, the
    // sidebar active item and the URL stay in sync.
    expect(buildTenantLanding(TENANT_B)).toBe("/t/tenants_bbb/menu");
  });
});
