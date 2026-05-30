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
    expect(decideSidebarNav(input)).toEqual({ kind: "hidden", items: [] });
  });

  it("ready but isAdmin=false + tenants=[] → `hidden` (NoTenantEmptyState owns this case)", () => {
    const input: SidebarNavInput = {
      session: {
        status: "ready",
        session: { isAdmin: false, tenants: [] },
      },
      pathname: "/",
    };
    expect(decideSidebarNav(input)).toEqual({ kind: "hidden", items: [] });
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

  it("KB Manager on `/t/<A>/menu` → `manager-operational` items scoped to /t/<A>/...", () => {
    const input: SidebarNavInput = {
      session: managerSession([
        { id: TENANT_A, slug: "lartisan", name: "L'Artisan" },
      ]),
      pathname: `/t/${TENANT_A}/menu`,
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    expect(result.items.map((i) => i.label)).toEqual([
      "Menu",
      "Commandes",
      "Mes clients",
      "Campagnes",
      "Pricing",
      "QR",
      "Paramètres",
    ]);
    expect(result.items.map((i) => i.href)).toEqual([
      `/t/${TENANT_A}/menu`,
      `/t/${TENANT_A}/commandes`,
      `/t/${TENANT_A}/mes-clients`,
      `/t/${TENANT_A}/campagnes`,
      `/t/${TENANT_A}/pricing`,
      `/t/${TENANT_A}/qr`,
      `/t/${TENANT_A}/parametres`,
    ]);
  });

  it("KB Admin on `/t/<A>/menu` → `manager-operational` scoped to /t/<A>/... (root override in operational view)", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: `/t/${TENANT_A}/menu`,
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    expect(result.items[0].href).toBe(`/t/${TENANT_A}/menu`);
  });

  it("KB Admin on `/t/<B>/parametres` → operational scoped to /t/<B>/... (URL tenant wins, not the first session tenant)", () => {
    const input: SidebarNavInput = {
      session: adminSession([{ id: TENANT_A, slug: "a", name: "A" }]),
      pathname: `/t/${TENANT_B}/parametres`,
    };
    const result = decideSidebarNav(input);
    expect(result.kind).toBe("manager-operational");
    expect(
      result.items.every((i) => i.href.startsWith(`/t/${TENANT_B}/`)),
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
      result.items.every((i) => i.href.startsWith(`/t/${TENANT_A}/`)),
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
    expect(result.items[0].href).toBe(`/t/${TENANT_A}/menu`);
  });

  it("URL `/team` does NOT trigger operational space (only `/t/[id]` does — guard against `/team`/`/teams` false positives)", () => {
    const input: SidebarNavInput = {
      session: adminSession(),
      pathname: "/team",
    };
    expect(decideSidebarNav(input).kind).toBe("admin-supervision");
  });
});
