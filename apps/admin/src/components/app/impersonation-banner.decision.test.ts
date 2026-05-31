/**
 * F-SHELL-08 (#214) — `decideImpersonationBanner` pinned as a pure function.
 *
 * The React component itself (`impersonation-banner.tsx`) is a `"use client"`
 * tree that reads `useSession()`, `useCurrentTenantId()` and `useAllTenants()`
 * to decide whether to render the « Mode admin — tu consultes <resto> »
 * banner. The branching is extracted into `decideImpersonationBanner()` so
 * vitest can pin every acceptance criterion of issue #214 in the lean `node`
 * env — same split discipline as `decideSessionGate` (#164), `decideTenantGate`
 * (#175), `decideSidebarNav` (#196), and `decideTenantSwitcher` (#208).
 *
 * The pure function answers ONE of two shapes:
 *   - `hidden`  → no banner. Either the session isn't ready, the actor is
 *                  a KB Manager (the banner is admin-only in V1 per ADR 0014
 *                  §8 — gérant-side banner + audit log = V2), or no tenant
 *                  courant (banner is mounted inside `/t/[tenantId]` layout
 *                  per the layout-coupling design, but the decision still
 *                  guards defensively).
 *   - `visible` → orange banner with the resto name + « Quitter » CTA. The
 *                  decision carries the resolved name (or a graceful
 *                  fallback when the name lookup is still in-flight, so the
 *                  banner doesn't flash on/off mid-load).
 *
 * Name resolution rules (ADR 0014 §8 — the KB Admin doesn't own the tenant
 * via `session.tenants`, so we need an external lookup):
 *   - lookup === undefined → in-flight. We still show the banner (KB Admin
 *     is impersonating NOW, the user needs to see that fact even before the
 *     name resolves), with a placeholder fallback (the tenantId itself).
 *   - lookup === array → resolve from the list. If absent, fall back to the
 *     tenantId rather than hiding the banner (defensive: the impersonation
 *     state is more important to surface than the precise name).
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  decideImpersonationBanner,
  type ImpersonationBannerInput,
  type TenantNameLookup,
} from "./impersonation-banner";
import type { SessionState } from "@/lib/session";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const TENANT_B = "tenants_bbb" as unknown as Id<"tenants">;
const FIXTURE_USER = {
  userId: "users_xxx" as unknown as Id<"users">,
  email: "fixture@kb.test",
};

function adminSession(): SessionState {
  return {
    status: "ready",
    session: { isAdmin: true, tenants: [], user: FIXTURE_USER },
  };
}

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

const LOOKUP_EMPTY: TenantNameLookup = [];

describe("decideImpersonationBanner — F-SHELL-08 (#214)", () => {
  // --- defensive / not-ready -------------------------------------------------

  it("session=loading → `hidden` (no banner before we know if it's an admin)", () => {
    const input: ImpersonationBannerInput = {
      session: { status: "loading" },
      currentTenantId: TENANT_A,
      tenantNameLookup: undefined,
    };
    expect(decideImpersonationBanner(input)).toEqual({ kind: "hidden" });
  });

  it("session=unauthenticated → `hidden` (SessionGuard takes care of /login)", () => {
    const input: ImpersonationBannerInput = {
      session: { status: "unauthenticated" },
      currentTenantId: TENANT_A,
      tenantNameLookup: undefined,
    };
    expect(decideImpersonationBanner(input)).toEqual({ kind: "hidden" });
  });

  it("no currentTenantId (banner mounted outside `/t/[id]`) → `hidden`", () => {
    const input: ImpersonationBannerInput = {
      session: adminSession(),
      currentTenantId: null,
      tenantNameLookup: undefined,
    };
    expect(decideImpersonationBanner(input)).toEqual({ kind: "hidden" });
  });

  // --- KB Manager branch (banner NEVER shown) --------------------------------

  it("KB Manager on /t/<own> → `hidden` (V1: banner is admin-only, ADR 0014 §8)", () => {
    const input: ImpersonationBannerInput = {
      session: managerSession([
        { id: TENANT_A, slug: "lartisan", name: "L'Artisan" },
      ]),
      currentTenantId: TENANT_A,
      tenantNameLookup: undefined,
    };
    expect(decideImpersonationBanner(input)).toEqual({ kind: "hidden" });
  });

  it("KB Manager on /t/<not-own> → `hidden` (decideTenantGate handles that — banner stays out of it)", () => {
    const input: ImpersonationBannerInput = {
      session: managerSession([{ id: TENANT_A, slug: "a", name: "A" }]),
      currentTenantId: TENANT_B,
      tenantNameLookup: undefined,
    };
    expect(decideImpersonationBanner(input)).toEqual({ kind: "hidden" });
  });

  // --- KB Admin branch (banner shown) ----------------------------------------

  it("KB Admin on /t/<X>, name lookup resolved → `visible` with the resolved name", () => {
    const input: ImpersonationBannerInput = {
      session: adminSession(),
      currentTenantId: TENANT_A,
      tenantNameLookup: [
        { tenantId: TENANT_A, slug: "lartisan", name: "L'Artisan" },
        { tenantId: TENANT_B, slug: "b", name: "B" },
      ],
    };
    expect(decideImpersonationBanner(input)).toEqual({
      kind: "visible",
      tenantId: TENANT_A,
      tenantName: "L'Artisan",
    });
  });

  it("KB Admin on /t/<X>, lookup still in flight → `visible` with the tenantId as fallback (banner shown immediately so the impersonation state isn't hidden during the round-trip)", () => {
    const input: ImpersonationBannerInput = {
      session: adminSession(),
      currentTenantId: TENANT_A,
      tenantNameLookup: undefined,
    };
    expect(decideImpersonationBanner(input)).toEqual({
      kind: "visible",
      tenantId: TENANT_A,
      tenantName: TENANT_A as unknown as string,
    });
  });

  it("KB Admin on /t/<X>, lookup resolved but tenant absent from the list → `visible` with tenantId fallback (defensive — surface impersonation even if name resolution lags)", () => {
    const input: ImpersonationBannerInput = {
      session: adminSession(),
      currentTenantId: TENANT_A,
      tenantNameLookup: LOOKUP_EMPTY,
    };
    expect(decideImpersonationBanner(input)).toEqual({
      kind: "visible",
      tenantId: TENANT_A,
      tenantName: TENANT_A as unknown as string,
    });
  });

  it("KB Admin with isAdmin=true AND tenants attached (mixed actor) on /t/<own> → STILL `visible` (root override is what gives access, not the userTenants row — ADR 0014 §3)", () => {
    const session: SessionState = {
      status: "ready",
      session: {
        isAdmin: true,
        tenants: [
          {
            tenantId: TENANT_A,
            slug: "lartisan",
            name: "L'Artisan",
            role: "kb_manager",
          },
        ],
        user: FIXTURE_USER,
      },
    };
    const input: ImpersonationBannerInput = {
      session,
      currentTenantId: TENANT_A,
      tenantNameLookup: [
        { tenantId: TENANT_A, slug: "lartisan", name: "L'Artisan" },
      ],
    };
    expect(decideImpersonationBanner(input)).toEqual({
      kind: "visible",
      tenantId: TENANT_A,
      tenantName: "L'Artisan",
    });
  });
});
