/**
 * F-MES-CLIENTS [4/4] (#202) — sidebar entry contract.
 *
 * The "Mes clients" entry was added to the shell sidebar by F-SHELL-06 (#196,
 * `app-sidebar.tsx` + `app-sidebar.decision.test.ts`). This test PINS the
 * contract from the mes-clients perspective: if a future refactor of
 * `decideSidebarNav` accidentally drops the entry, or points it elsewhere,
 * the failure surfaces inside the F-MES-CLIENTS suite (so the regression is
 * attributed to the right slice and the orchestrator can re-triage).
 *
 * Issue #202 AC1: « Entrée "Mes clients" visible dans la sidebar tenant-scoped,
 * route correcte vers /t/[tenantId]/mes-clients/ ».
 *
 * We exercise the pure `decideSidebarNav` decision function (the React shell
 * uses it; testing the function pins the contract without spinning up a
 * router or jsdom — same approach as `app-sidebar.decision.test.ts`).
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

describe("F-MES-CLIENTS [4/4] (#202) — sidebar entry « Mes clients »", () => {
  it("KB Manager under /t/<id>/menu → sidebar contains a « Mes clients » entry pointing to /t/<id>/mes-clients", () => {
    const decision = decideSidebarNav({
      session: managerSession(TENANT_X),
      pathname: `/t/${TENANT_X}/menu`,
    });
    expect(decision.kind).toBe("manager-operational");
    const entry = decision.items.find((i) => i.label === "Mes clients");
    expect(
      entry,
      "« Mes clients » nav entry must be present in operational sidebar",
    ).toBeDefined();
    expect(entry?.href).toBe(`/t/${TENANT_X}/mes-clients`);
  });

  it("KB Admin under /t/<id>/menu → same operational sidebar, same « Mes clients » entry", () => {
    // Root override: KB Admin under /t/<id> sees the manager operational
    // sidebar. The « Mes clients » entry must remain reachable.
    const adminSession: SessionState = {
      status: "ready",
      session: { isAdmin: true, tenants: [], user: FIXTURE_USER },
    };
    const decision = decideSidebarNav({
      session: adminSession,
      pathname: `/t/${TENANT_X}/menu`,
    });
    expect(decision.kind).toBe("manager-operational");
    const entry = decision.items.find((i) => i.label === "Mes clients");
    expect(entry).toBeDefined();
    expect(entry?.href).toBe(`/t/${TENANT_X}/mes-clients`);
  });

  it("href is tenant-scoped — never an absolute /mes-clients (would break the multi-tenant routing contract)", () => {
    const decision = decideSidebarNav({
      session: managerSession(TENANT_X),
      pathname: `/t/${TENANT_X}/menu`,
    });
    const entry = decision.items.find((i) => i.label === "Mes clients");
    expect(entry?.href.startsWith(`/t/${TENANT_X}/`)).toBe(true);
    expect(entry?.href).not.toBe("/mes-clients");
  });
});
