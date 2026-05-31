/**
 * F-COMMANDES-PAGE-SHELL (#222) — sidebar entry contract.
 *
 * The "Commandes" entry was added to the shell sidebar by F-SHELL-06 (#196,
 * `app-sidebar.tsx` + `app-sidebar.decision.test.ts`). This test PINS the
 * contract from the commandes perspective: if a future refactor of
 * `decideSidebarNav` accidentally drops the entry, or points it elsewhere,
 * the failure surfaces inside the F-COMMANDES suite (so the regression is
 * attributed to the right slice and the orchestrator can re-triage).
 *
 * Issue #222 AC: « L'entrée de navigation "Commandes" est visible dans la
 * sidebar (au moins pour le rôle `kb_manager`) » + « Entrée sidebar
 * "Commandes" pointant vers `/t/[tenantId]/commandes` (si pas déjà posée par
 * F-SHELL) ». F-SHELL-06 already added the entry — we mirror the slice-4
 * mes-clients pin so the contract is enforced from this slice too.
 *
 * We exercise the pure `decideSidebarNav` decision function (the React shell
 * uses it; testing the function pins the contract without spinning up a
 * router or jsdom — same approach as `app-sidebar.decision.test.ts` and
 * `mes-clients/sidebar-entry.test.ts`).
 */
import { describe, expect, it } from "vitest";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideSidebarNav } from "@/components/app-sidebar";
import type { SessionState } from "@/lib/session";

const TENANT_X = "tenants_xyz" as unknown as Id<"tenants">;
const FIXTURE_USER = {
  userId: "users_xxx" as unknown as Id<"users">,
  email: "fixture@kb.test",
};

function managerSession(tenantId: Id<"tenants">): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: false,
      tenants: [
        {
          tenantId,
          slug: "demo",
          name: "Demo",
          role: "kb_manager",
        },
      ],
      user: FIXTURE_USER,
    },
  };
}

describe("F-COMMANDES-PAGE-SHELL (#222) — sidebar entry « Commandes »", () => {
  it("KB Manager under /t/<id>/menu → sidebar contains a « Commandes » entry pointing to /t/<id>/commandes", () => {
    const decision = decideSidebarNav({
      session: managerSession(TENANT_X),
      pathname: `/t/${TENANT_X}/menu`,
    });
    expect(decision.kind).toBe("manager-operational");
    const entry = decision.items.find((i) => i.label === "Commandes");
    expect(
      entry,
      "« Commandes » nav entry must be present in operational sidebar",
    ).toBeDefined();
    expect(entry?.href).toBe(`/t/${TENANT_X}/commandes`);
  });

  it("KB Admin under /t/<id>/menu → same operational sidebar, same « Commandes » entry", () => {
    // Root override: KB Admin under /t/<id> sees the manager operational
    // sidebar. The « Commandes » entry must remain reachable.
    const adminSession: SessionState = {
      status: "ready",
      session: { isAdmin: true, tenants: [], user: FIXTURE_USER },
    };
    const decision = decideSidebarNav({
      session: adminSession,
      pathname: `/t/${TENANT_X}/menu`,
    });
    expect(decision.kind).toBe("manager-operational");
    const entry = decision.items.find((i) => i.label === "Commandes");
    expect(entry).toBeDefined();
    expect(entry?.href).toBe(`/t/${TENANT_X}/commandes`);
  });

  it("href is tenant-scoped — never an absolute /commandes (would break the multi-tenant routing contract)", () => {
    const decision = decideSidebarNav({
      session: managerSession(TENANT_X),
      pathname: `/t/${TENANT_X}/menu`,
    });
    const entry = decision.items.find((i) => i.label === "Commandes");
    expect(entry?.href.startsWith(`/t/${TENANT_X}/`)).toBe(true);
    expect(entry?.href).not.toBe("/commandes");
  });
});
