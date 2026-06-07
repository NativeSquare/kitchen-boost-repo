/**
 * F-SHELL-06 — `decideSidebarNav` decision logic, pinned as a pure function.
 *
 * The sidebar component itself (`app-sidebar.tsx`) is a `"use client"` React
 * tree that consumes `useSession()` + `usePathname()` and renders shadcn
 * `<Sidebar/>` primitives. The branching "which set of nav items should I
 * show, and where do their hrefs point?" is extracted into
 * `decideSidebarNav()` so every acceptance criterion of issue #196 can be
 * pinned by vitest in node env, no DOM, no Convex, no router — same split as
 * `decideSessionGate` (#164) and `decideTenantGate` (#175).
 *
 * The pure function answers ONE of three shapes:
 *   - `hidden`              → session not ready / user has neither admin nor
 *                              tenant attachments. The shell already hides the
 *                              chrome via SessionGuard, but the sidebar still
 *                              guards itself defensively.
 *   - `admin-supervision`   → KB Admin, NOT under `/t/[id]/...`. Renders
 *                              Pipeline, CRM, Monitoring, Tenants — all
 *                              absolute supervision URLs.
 *   - `manager-operational` → either KB Manager (any URL), or KB Admin under
 *                              `/t/[id]/...`. Renders Menu, Commandes, Mes
 *                              clients, Campagnes, Pricing, QR, Paramètres —
 *                              all scoped to the resolved currentTenantId.
 *
 * The "resolved currentTenantId" comes from (in order):
 *   1. The `tenantId` parsed out of pathname `/t/[id]/...` when present.
 *   2. Otherwise `session.tenants[0].tenantId` (fallback default tenant for
 *      a KB Manager who somehow renders the sidebar outside `/t/[id]`).
 *   3. If both are absent (KB Admin outside `/t/[id]` with no own tenants),
 *      the operational shape is NOT returned — supervision wins.
 *
 * Per issue #196 + ADR 0014 §1:
 *   - The legacy "Users" / "Team" items are NOT part of either jeu — they are
 *     removed entirely (the test below pins that they never appear).
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideSidebarNav, type SidebarNavInput } from "./app-sidebar";
import type { SessionState } from "@/lib/session";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const TENANT_B = "tenants_bbb" as unknown as Id<"tenants">;
const FIXTURE_USER_ID = "users_xxx" as unknown as Id<"users">;

// `decideSidebarNav` only inspects `isAdmin` + `tenants`; the `user` field
// landed when getSession absorbed the NavUser footer payload, but the routing
// decision doesn't read it. Kept here as a fixture so the SessionData shape
// stays compilable.
const FIXTURE_USER = {
  userId: FIXTURE_USER_ID,
  name: "Fixture",
  email: "fixture@kb.test",
};

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

describe("decideSidebarNav", () => {
  // --- defensive / not-ready -----------------------------------------------

  it("status=loading → `hidden` (the shell already renders a spinner, sidebar guards itself)", () => {
    const input: SidebarNavInput = {
      session: { status: "loading" },
      pathname: "/pipeline",
    };
    expect(decideSidebarNav(input)).toEqual({
      kind: "hidden",
      items: [],
      supportItem: null,
    });
  });

  it("ready but isAdmin=false + tenants=[] → `hidden` (NoTenantEmptyState owns this case)", () => {
    const input: SidebarNavInput = {
      session: {
        status: "ready",
        session: { isAdmin: false, tenants: [], user: FIXTURE_USER },
      },
      pathname: "/",
    };
    expect(decideSidebarNav(input)).toEqual({
      kind: "hidden",
      items: [],
      supportItem: null,
    });
  });

  // --- KB Admin in supervision space ---------------------------------------

  it("KB Admin on `/` → `admin-supervision` items (Pipeline, CRM, Monitoring, Tenants) with ABSOLUTE hrefs", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: "/",
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("admin-supervision");
    expect(result.items.map((i) => i.label)).toEqual([
      "Pipeline",
      "CRM",
      "Monitoring",
      "Tenants",
    ]);
    expect(result.items.map((i) => i.href)).toEqual([
      "/pipeline",
      "/crm",
      "/monitoring",
      "/tenants",
    ]);
  });

  it("KB Admin on `/pipeline` → still `admin-supervision` (supervision space)", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: "/pipeline",
    };
    expect(decideSidebarNav(input).kind).toBe("admin-supervision");
  });

  it("KB Admin on `/monitoring` → still `admin-supervision`", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: "/monitoring",
    };
    expect(decideSidebarNav(input).kind).toBe("admin-supervision");
  });

  // --- Operational space (manager OR admin under /t/[id]) ------------------

  it("KB Manager on `/t/<A>/menu` → `manager-operational` 10 items scoped to /t/<A>/... (Sessions retiré 2026-06-07 — kb_admin only RBAC, #396)", () => {
    const input: SidebarNavInput = {
      session: managerSession([
        { id: TENANT_A, slug: "lartisan", name: "L'Artisan" },
      ]),
      pathname: `/t/${TENANT_A}/menu`,
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    // 10 items pour kb_manager — Sessions absent (RBAC durci 2026-06-07).
    expect(result.items.map((i) => i.label)).toEqual([
      "Tableau de bord",
      "Menu",
      "Commandes",
      "Disponibilité",
      "Mes clients",
      "Statistiques",
      "Campagnes",
      "Pricing",
      "QR",
      "Paramètres",
    ]);
    expect(result.items.map((i) => i.href)).toEqual([
      `/t/${TENANT_A}`,
      `/t/${TENANT_A}/menu`,
      `/t/${TENANT_A}/commandes`,
      `/t/${TENANT_A}/disponibilite`,
      `/t/${TENANT_A}/mes-clients`,
      `/t/${TENANT_A}/stats`,
      `/t/${TENANT_A}/campagnes`,
      `/t/${TENANT_A}/pricing`,
      `/t/${TENANT_A}/qr`,
      `/t/${TENANT_A}/parametres`,
    ]);
    // Pins requested by the issues #389/#390 spec.
    expect(result.items[0].href).toBe(`/t/${TENANT_A}`);
    // #397 — Disponibilité sits right after Commandes (operational quotidien
    // — frontière ADR 0018 : actions « ici et maintenant »).
    expect(result.items[3].href).toBe(`/t/${TENANT_A}/disponibilite`);
    expect(result.items[5].href).toBe(`/t/${TENANT_A}/stats`);
    // #396 — Sessions ABSENT pour kb_manager (RBAC durci 2026-06-07).
    // Régression défensive : ré-introduire l'entrée pour un kb_manager fait
    // tomber ce test loud.
    expect(result.items.some((i) => i.label === "Sessions")).toBe(false);
    expect(result.items.some((i) => i.href === `/t/${TENANT_A}/sessions`)).toBe(
      false,
    );
  });

  it("KB Admin on `/t/<A>/menu` → `manager-operational` 11 items WITH Sessions entry between QR et Paramètres (root override RBAC #396)", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: `/t/${TENANT_A}/menu`,
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    // items[0] = Tableau de bord, scoped to the URL tenant base path.
    expect(result.items[0].href).toBe(`/t/${TENANT_A}`);
    // 11 items pour kb_admin (root override) — Sessions présent entre QR et
    // Paramètres (security-adjacent section, sits next to tenant config).
    expect(result.items.map((i) => i.label)).toEqual([
      "Tableau de bord",
      "Menu",
      "Commandes",
      "Disponibilité",
      "Mes clients",
      "Statistiques",
      "Campagnes",
      "Pricing",
      "QR",
      "Sessions",
      "Paramètres",
    ]);
    expect(result.items[9].href).toBe(`/t/${TENANT_A}/sessions`);
  });

  it("KB Admin on `/t/<B>/parametres` → operational scoped to /t/<B>/... (URL tenant wins, not the first session tenant)", () => {
    const input: SidebarNavInput = {
      session: adminSession([{ id: TENANT_A, slug: "a", name: "A" }]),
      pathname: `/t/${TENANT_B}/parametres`,
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    // Every href is either the base `/t/<B>` (Tableau de bord) or a `/t/<B>/...`
    // sub-route — none should leak the first session tenant.
    expect(
      result.items.every(
        (i) =>
          i.href === `/t/${TENANT_B}` || i.href.startsWith(`/t/${TENANT_B}/`),
      ),
    ).toBe(true);
  });

  it("KB Manager outside `/t/[id]` → operational items pointing to first tenant of session.tenants (fallback)", () => {
    const input: SidebarNavInput = {
      session: managerSession([
        { id: TENANT_A, slug: "a", name: "A" },
        { id: TENANT_B, slug: "b", name: "B" },
      ]),
      pathname: "/",
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    expect(
      result.items.every(
        (i) =>
          i.href === `/t/${TENANT_A}` || i.href.startsWith(`/t/${TENANT_A}/`),
      ),
    ).toBe(true);
  });

  // --- Legacy items removed ------------------------------------------------

  it("legacy Users / Team items are never present in either jeu (issue #196 acceptance)", () => {
    const adminResult = decideSidebarNav({
      session: adminSession(),
      pathname: "/",
    });
    const managerResult = decideSidebarNav({
      session: managerSession([{ id: TENANT_A, slug: "a", name: "A" }]),
      pathname: `/t/${TENANT_A}/menu`,
    });
    const allLabels = [
      ...adminResult.items.map((i) => i.label),
      ...managerResult.items.map((i) => i.label),
    ];
    expect(allLabels).not.toContain("Users");
    expect(allLabels).not.toContain("Team");
  });

  // --- URL parser edge cases ----------------------------------------------

  it("operational URL with trailing-only segment `/t/<A>` (no sub-route) → still detected as tenant URL", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: `/t/${TENANT_A}`,
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    // items[0] = Tableau de bord at the tenant base.
    expect(result.items[0].href).toBe(`/t/${TENANT_A}`);
  });

  it("URL `/team` does NOT trigger operational space (only `/t/[id]` does — guard against `/team`/`/teams` false positives)", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: "/team",
    };
    expect(decideSidebarNav(input).kind).toBe("admin-supervision");
  });

  // --- Support entry (E2E manuel SUP — Alex) -------------------------------
  //
  // La route `/support` (admin) et `/t/[id]/support` (manager) existait mais
  // n'était PAS linkée depuis la sidebar — l'utilisateur devait forger l'URL.
  // `decideSidebarNav` retourne maintenant un `supportItem` épinglé en bas de
  // la sidebar (au-dessus du SidebarFooter qui héberge le profil) avec une
  // URL contextuelle.

  describe("supportItem (E2E manuel SUP)", () => {
    it("KB Admin hors tenant → supportItem pointe sur `/support` (espace supervision)", () => {
      const result = decideSidebarNav({
        session: adminSession(),
        pathname: "/",
      });
      expect(result.supportItem).not.toBeNull();
      expect(result.supportItem).toEqual({
        label: "Support",
        href: "/support",
        iconName: "support",
      });
    });

    it("KB Manager → supportItem pointe sur `/t/<A>/support` (scope tenant)", () => {
      const result = decideSidebarNav({
        session: managerSession([{ id: TENANT_A, slug: "a", name: "A" }]),
        pathname: `/t/${TENANT_A}/menu`,
      });
      expect(result.supportItem).toEqual({
        label: "Support",
        href: `/t/${TENANT_A}/support`,
        iconName: "support",
      });
    });

    it("KB Admin sur tenant (impersonation) → supportItem pointe sur `/t/<A>/support`", () => {
      const result = decideSidebarNav({
        session: adminSession(),
        pathname: `/t/${TENANT_A}/menu`,
      });
      expect(result.supportItem).toEqual({
        label: "Support",
        href: `/t/${TENANT_A}/support`,
        iconName: "support",
      });
    });

    it("KB Manager hors `/t/[id]` (fallback first tenant) → supportItem scoped sur le tenant fallback", () => {
      const result = decideSidebarNav({
        session: managerSession([
          { id: TENANT_A, slug: "a", name: "A" },
          { id: TENANT_B, slug: "b", name: "B" },
        ]),
        pathname: "/",
      });
      expect(result.supportItem).toEqual({
        label: "Support",
        href: `/t/${TENANT_A}/support`,
        iconName: "support",
      });
    });

    it("session=loading → supportItem=null (rien à linker tant que la session n'est pas prête)", () => {
      const result = decideSidebarNav({
        session: { status: "loading" },
        pathname: "/",
      });
      expect(result.supportItem).toBeNull();
    });

    it("ready mais ni admin ni tenant → supportItem=null (NoTenantEmptyState owns the screen)", () => {
      const result = decideSidebarNav({
        session: {
          status: "ready",
          session: { isAdmin: false, tenants: [], user: FIXTURE_USER },
        },
        pathname: "/",
      });
      expect(result.supportItem).toBeNull();
    });

    it("supportItem n'apparaît PAS dans les nav items principaux (épinglée séparément)", () => {
      const adminResult = decideSidebarNav({
        session: adminSession(),
        pathname: "/",
      });
      const managerResult = decideSidebarNav({
        session: managerSession([{ id: TENANT_A, slug: "a", name: "A" }]),
        pathname: `/t/${TENANT_A}/menu`,
      });
      expect(adminResult.items.map((i) => i.label)).not.toContain("Support");
      expect(managerResult.items.map((i) => i.label)).not.toContain("Support");
    });
  });
});
