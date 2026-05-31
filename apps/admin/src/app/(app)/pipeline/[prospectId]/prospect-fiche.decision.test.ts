/**
 * F-SHELL-10 (#233) — `decideProspectFiche` decision logic test matrix.
 *
 * Pinned at the pure-function level (same split as `decideSessionGate` /
 * `decideTenantGate` / `decideRootEntry`) so vitest can run every branch in
 * the lean `node` env (no DOM, no router, no Convex client). The React shell
 * (`page.tsx`) is a thin adapter on top.
 *
 * Acceptance criteria pinned (issue #233):
 *
 *   - KB Admin on `/pipeline/<id>` with a hydrated prospect → `show`.
 *   - KB Admin on `/pipeline/<id>` with prospect `null` (no such row) →
 *     `not-found` (clean 404-ish state, not a raw error).
 *   - KB Admin on `/pipeline/<id>` with prospect `undefined` (in-flight) →
 *     `loading-prospect`.
 *   - KB Manager on `/pipeline/<id>` → `forbidden` (UX layer refusal; the
 *     real barrier is backend `kbAdminQuery`).
 *   - session not ready → `wait` (parent SessionGuard owns the spinner).
 *
 * Plus the URL builder:
 *   - `buildTenantOperationalHref(undefined)` → `null` (no button rendered).
 *   - `buildTenantOperationalHref(tenantId)` → `"/t/<tenantId>"` (NOT a
 *     sub-route — the `/t/[id]` root page redirects to `/menu`).
 */
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import {
  buildTenantOperationalHref,
  decideProspectFiche,
} from "./prospect-fiche.decision";
import type { SessionState } from "@/lib/session";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;
const TENANT_ID = "tenants_aaa" as unknown as Id<"tenants">;
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

function managerSession(): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: false,
      tenants: [
        {
          tenantId: TENANT_ID,
          slug: "khan",
          name: "Khan",
          role: "kb_manager",
        },
      ],
      user: FIXTURE_USER,
    },
  };
}

function makeProspect(
  overrides: Partial<Doc<"prospects">> = {},
): Doc<"prospects"> {
  return {
    _id: PROSPECT_ID,
    _creationTime: 1_700_000_000_000,
    name: "L'Artisan",
    phone: "0612345678",
    phase: "acquisition",
    source: "cold_call",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("decideProspectFiche — session not ready", () => {
  it("status=loading → `wait` (parent SessionLoader/SessionGuard owns the spinner)", () => {
    expect(
      decideProspectFiche({
        session: { status: "loading" },
        prospect: undefined,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("status=unauthenticated → `wait` (parent SessionGuard owns the /login redirect)", () => {
    expect(
      decideProspectFiche({
        session: { status: "unauthenticated" },
        prospect: undefined,
      }),
    ).toEqual({ kind: "wait" });
  });
});

describe("decideProspectFiche — KB Manager (non-admin) is refused", () => {
  it("manager landing on /pipeline/<id> → `forbidden`, REGARDLESS of prospect value", () => {
    // The session check short-circuits BEFORE we look at `prospect`, so a
    // stale `undefined` (when the page stubs / skips the query) cannot pin
    // a manager into a loading spinner.
    expect(
      decideProspectFiche({
        session: managerSession(),
        prospect: undefined,
      }),
    ).toEqual({ kind: "forbidden" });
    expect(
      decideProspectFiche({
        session: managerSession(),
        prospect: null,
      }),
    ).toEqual({ kind: "forbidden" });
    expect(
      decideProspectFiche({
        session: managerSession(),
        prospect: makeProspect(),
      }),
    ).toEqual({ kind: "forbidden" });
  });
});

describe("decideProspectFiche — KB Admin", () => {
  it("admin + prospect undefined (Convex in-flight) → `loading-prospect`", () => {
    expect(
      decideProspectFiche({
        session: adminSession(),
        prospect: undefined,
      }),
    ).toEqual({ kind: "loading-prospect" });
  });

  it("admin + prospect null (no doc with this id) → `not-found`", () => {
    expect(
      decideProspectFiche({
        session: adminSession(),
        prospect: null,
      }),
    ).toEqual({ kind: "not-found" });
  });

  it("admin + hydrated prospect → `{ kind: 'show', prospect }`", () => {
    const prospect = makeProspect({ name: "Mon Resto" });
    expect(
      decideProspectFiche({
        session: adminSession(),
        prospect,
      }),
    ).toEqual({ kind: "show", prospect });
  });

  it("admin + prospect with tenantId back-link → `show` (the back-link is just a field — visibility decision is on the view)", () => {
    const prospect = makeProspect({ tenantId: TENANT_ID });
    const decision = decideProspectFiche({
      session: adminSession(),
      prospect,
    });
    expect(decision.kind).toBe("show");
    if (decision.kind === "show") {
      expect(decision.prospect.tenantId).toBe(TENANT_ID);
    }
  });
});

describe("buildTenantOperationalHref", () => {
  it("returns null when tenantId is undefined (prospect not yet provisioned — no button)", () => {
    expect(buildTenantOperationalHref(undefined)).toBeNull();
  });

  it("returns `/t/<tenantId>` for a provisioned prospect (the bare segment — `/t/[id]` root page redirects to /menu)", () => {
    expect(buildTenantOperationalHref(TENANT_ID)).toBe(
      `/t/${TENANT_ID as unknown as string}`,
    );
  });
});
