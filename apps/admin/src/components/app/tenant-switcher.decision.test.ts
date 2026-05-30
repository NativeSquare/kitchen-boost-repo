/**
 * F-SHELL-07 — `decideTenantSwitcher` + `buildSwitchTarget`, pinned as pure
 * functions (issue #208, ADR 0014 §7).
 *
 * The React component (`tenant-switcher.tsx`) is a "use client" tree that
 * mounts inside `site-header.tsx` and consumes `useSession()` +
 * `usePathname()` + an admin-only `useAllTenants()`. The branching "what
 * shape am I, what is my current value, what are my options, and where do I
 * navigate on selection?" is extracted into pure functions so every
 * acceptance criterion of issue #208 can be pinned by vitest in the lean
 * `node` env — same split discipline as `decideSidebarNav` (#196),
 * `decideSessionGate` (#164) and `decideTenantGate` (#175).
 *
 * The decision function answers ONE of four shapes:
 *   - `hidden`         → session not ready / no access. Header still renders
 *                        but the switcher does not.
 *   - `display-only`   → KB Manager with exactly ONE tenant. We render the
 *                        tenant name as a NON-actionable badge (no menu,
 *                        no dropdown) — per issue body.
 *   - `manager-multi`  → KB Manager with ≥ 2 tenants. Dropdown of
 *                        `session.tenants` (no re-fetch).
 *   - `admin`          → KB Admin (any number of own tenants). Pinned
 *                        "Supervision" entry + searchable list of ALL
 *                        tenants (fetched lazily by the React layer; the
 *                        decision is told whether the lookup is in-flight
 *                        or resolved).
 *
 * The "current value" surfaced by the switcher is:
 *   - the URL tenant if pathname is under `/t/[id]/...`
 *   - else "Supervision" for KB Admin on supervision routes (`/`, `/pipeline`,
 *     `/crm`, `/monitoring`, `/tenants`, anything not under `/t/[id]/...`)
 *   - else the (single) tenant for a KB Manager mono-tenant
 *   - else the first own tenant for a KB Manager multi-tenant outside `/t/[id]`
 *     — matching the sidebar's fallback (decideSidebarNav #196).
 *
 * `buildSwitchTarget(pathname, targetTenantId)` decides where to navigate
 * when the user picks a tenant: preserves the sub-path under `/t/[id]/...`
 * when present (e.g. `/t/<A>/menu` + pick B → `/t/<B>/menu`), otherwise
 * defaults to `/t/<target>` (root of the operational space) — per issue
 * body: "en conservant le sous-chemin si pertinent (sinon /t/${selected})".
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  decideTenantSwitcher,
  buildSwitchTarget,
  type TenantSwitcherInput,
  type AllTenantsLookup,
} from "./tenant-switcher";
import type { SessionState } from "@/lib/session";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const TENANT_B = "tenants_bbb" as unknown as Id<"tenants">;
const TENANT_C = "tenants_ccc" as unknown as Id<"tenants">;
const FIXTURE_USER = {
  userId: "users_xxx" as unknown as Id<"users">,
  email: "fixture@kb.test",
};

function adminSession(
  ownTenants: Array<{ id: Id<"tenants">; slug: string; name: string }> = [],
): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: true,
      tenants: ownTenants.map((t) => ({
        tenantId: t.id,
        slug: t.slug,
        name: t.name,
        role: "kb_manager",
      })),
      user: FIXTURE_USER,
    },
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

const ADMIN_LOOKUP_IDLE: AllTenantsLookup = undefined;

describe("decideTenantSwitcher — F-SHELL-07 (#208)", () => {
  // --- defensive / not-ready -----------------------------------------------

  it("status=loading → `hidden` (no chrome leak before session resolves)", () => {
    const input: TenantSwitcherInput = {
      session: { status: "loading" },
      pathname: "/pipeline",
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    expect(decideTenantSwitcher(input).kind).toBe("hidden");
  });

  it("ready but isAdmin=false + tenants=[] → `hidden` (NoTenantEmptyState owns this case)", () => {
    const input: TenantSwitcherInput = {
      session: {
        status: "ready",
        session: { isAdmin: false, tenants: [], user: FIXTURE_USER },
      },
      pathname: "/",
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    expect(decideTenantSwitcher(input).kind).toBe("hidden");
  });

  // --- KB Manager mono-tenant → display-only ------------------------------

  it("KB Manager with exactly 1 tenant → `display-only` (NO actionable dropdown)", () => {
    const input: TenantSwitcherInput = {
      session: managerSession([
        { id: TENANT_A, slug: "lartisan", name: "L'Artisan" },
      ]),
      pathname: `/t/${TENANT_A}/menu`,
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("display-only");
    if (result.kind === "display-only") {
      expect(result.current.name).toBe("L'Artisan");
      expect(result.current.tenantId).toBe(TENANT_A);
    }
  });

  it("KB Manager with 1 tenant, sitting on supervision URL by mistake → still display-only (no menu)", () => {
    const input: TenantSwitcherInput = {
      session: managerSession([{ id: TENANT_A, slug: "a", name: "Resto A" }]),
      pathname: "/",
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    expect(decideTenantSwitcher(input).kind).toBe("display-only");
  });

  // --- KB Manager multi-tenants → dropdown -------------------------------

  it("KB Manager with 3 tenants on /t/<A>/menu → `manager-multi`, 3 options, current = A", () => {
    const input: TenantSwitcherInput = {
      session: managerSession([
        { id: TENANT_A, slug: "a", name: "Resto A" },
        { id: TENANT_B, slug: "b", name: "Resto B" },
        { id: TENANT_C, slug: "c", name: "Resto C" },
      ]),
      pathname: `/t/${TENANT_A}/menu`,
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("manager-multi");
    if (result.kind === "manager-multi") {
      expect(result.options.map((o) => o.tenantId)).toEqual([
        TENANT_A,
        TENANT_B,
        TENANT_C,
      ]);
      expect(result.current.kind).toBe("tenant");
      if (result.current.kind === "tenant") {
        expect(result.current.tenantId).toBe(TENANT_A);
      }
    }
  });

  it("KB Manager with 2 tenants, sitting on `/` → `manager-multi`, current = first own tenant (sidebar fallback)", () => {
    const input: TenantSwitcherInput = {
      session: managerSession([
        { id: TENANT_A, slug: "a", name: "A" },
        { id: TENANT_B, slug: "b", name: "B" },
      ]),
      pathname: "/",
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("manager-multi");
    if (result.kind === "manager-multi") {
      expect(result.current.kind).toBe("tenant");
      if (result.current.kind === "tenant") {
        expect(result.current.tenantId).toBe(TENANT_A);
      }
    }
  });

  // --- KB Admin → searchable + supervision entry -------------------------

  it("KB Admin on `/pipeline` → `admin`, current = Supervision, pinned Supervision entry present", () => {
    const input: TenantSwitcherInput = {
      session: adminSession(),
      pathname: "/pipeline",
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("admin");
    if (result.kind === "admin") {
      expect(result.current.kind).toBe("supervision");
      // Pinned supervision entry is ALWAYS exposed for KB Admin.
      expect(result.supervisionPinned).toEqual({
        kind: "supervision",
        label: "Supervision",
        href: "/pipeline",
      });
    }
  });

  it("KB Admin on `/` → `admin`, current = Supervision (any non-/t URL is supervision)", () => {
    const input: TenantSwitcherInput = {
      session: adminSession(),
      pathname: "/",
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("admin");
    if (result.kind === "admin") {
      expect(result.current.kind).toBe("supervision");
    }
  });

  it("KB Admin on `/t/<A>` (drilled into a tenant) → `admin`, current = A (URL wins, even if A is not in session.tenants)", () => {
    const input: TenantSwitcherInput = {
      session: adminSession(),
      pathname: `/t/${TENANT_A}/menu`,
      allTenants: [
        { tenantId: TENANT_A, slug: "a", name: "Resto A" },
        { tenantId: TENANT_B, slug: "b", name: "Resto B" },
      ],
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("admin");
    if (result.kind === "admin") {
      expect(result.current.kind).toBe("tenant");
      if (result.current.kind === "tenant") {
        expect(result.current.tenantId).toBe(TENANT_A);
        // When the lookup has resolved, the name is taken from there.
        expect(result.current.name).toBe("Resto A");
      }
    }
  });

  it("KB Admin: when allTenants lookup is in-flight, current = tenantId-as-name placeholder (we don't block the chrome)", () => {
    const input: TenantSwitcherInput = {
      session: adminSession(),
      pathname: `/t/${TENANT_A}/menu`,
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("admin");
    if (result.kind === "admin" && result.current.kind === "tenant") {
      expect(result.current.tenantId).toBe(TENANT_A);
      // Name falls back to the id; the React layer can render a Skeleton.
      expect(result.current.name).toBe(TENANT_A as unknown as string);
    }
  });

  it("KB Admin: when allTenants resolves, `options` lists every tenant returned by the lookup", () => {
    const input: TenantSwitcherInput = {
      session: adminSession(),
      pathname: "/pipeline",
      allTenants: [
        { tenantId: TENANT_A, slug: "a", name: "A" },
        { tenantId: TENANT_B, slug: "b", name: "B" },
        { tenantId: TENANT_C, slug: "c", name: "C" },
      ],
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("admin");
    if (result.kind === "admin") {
      expect(result.options.map((o) => o.tenantId)).toEqual([
        TENANT_A,
        TENANT_B,
        TENANT_C,
      ]);
    }
  });

  it("KB Admin: when allTenants lookup is in-flight, `options` is empty (React layer shows a loading hint)", () => {
    const input: TenantSwitcherInput = {
      session: adminSession(),
      pathname: "/pipeline",
      allTenants: ADMIN_LOOKUP_IDLE,
    };
    const result = decideTenantSwitcher(input);
    expect(result.kind).toBe("admin");
    if (result.kind === "admin") {
      expect(result.options).toEqual([]);
      expect(result.optionsLoading).toBe(true);
    }
  });
});

describe("buildSwitchTarget — F-SHELL-07 (#208)", () => {
  it("from `/t/<A>/menu`, picking B → `/t/<B>/menu` (preserves sub-path)", () => {
    expect(buildSwitchTarget(`/t/${TENANT_A}/menu`, TENANT_B)).toBe(
      `/t/${TENANT_B}/menu`,
    );
  });

  it("from `/t/<A>/parametres/edit`, picking C → `/t/<C>/parametres/edit` (preserves DEEP sub-path)", () => {
    expect(buildSwitchTarget(`/t/${TENANT_A}/parametres/edit`, TENANT_C)).toBe(
      `/t/${TENANT_C}/parametres/edit`,
    );
  });

  it("from `/t/<A>` (no sub-path), picking B → `/t/<B>` (no synthetic sub-path)", () => {
    expect(buildSwitchTarget(`/t/${TENANT_A}`, TENANT_B)).toBe(
      `/t/${TENANT_B}`,
    );
  });

  it("from `/pipeline` (supervision URL), picking A → `/t/<A>` (drop into operational root)", () => {
    expect(buildSwitchTarget("/pipeline", TENANT_A)).toBe(`/t/${TENANT_A}`);
  });

  it("from `/` (root), picking A → `/t/<A>`", () => {
    expect(buildSwitchTarget("/", TENANT_A)).toBe(`/t/${TENANT_A}`);
  });

  it("from `/team` (false positive guard — NOT /t/[id]), picking A → `/t/<A>`", () => {
    expect(buildSwitchTarget("/team", TENANT_A)).toBe(`/t/${TENANT_A}`);
  });

  it("from null pathname, picking A → `/t/<A>` (defensive)", () => {
    expect(buildSwitchTarget(null, TENANT_A)).toBe(`/t/${TENANT_A}`);
  });
});
