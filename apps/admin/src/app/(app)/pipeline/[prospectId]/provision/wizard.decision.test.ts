/**
 * F-WIZARD [1/10] (#265) — `decideWizardShell` + `computeWizardState` test
 * matrix.
 *
 * Pure-function test layer (same split discipline as `decideSessionGate`,
 * `decideTenantGate`, `decideProspectFiche`). The React shell (`wizard-view`
 * + `page.tsx` + `use-wizard-state`) is a thin adapter on top — every branch
 * of the wizard's WHAT-TO-DO logic is pinned here, in the lean `node` env,
 * with zero React / Convex / DOM.
 *
 * Two pure surfaces under test:
 *
 *   1. `decideWizardShell({ session, prospect })` — the outer access gate
 *      that mirrors `decideProspectFiche`. The wizard route is admin-only
 *      (RBAC, acceptance criterion #7) AND the prospect must exist + be in
 *      a phase that allows provisioning (route defensive, acceptance
 *      criterion #8).
 *
 *   2. `computeWizardState({ prospect, tenant, publishedMenu, managerInvite })`
 *      — the pure heuristic that maps the DB snapshot to the wizard's
 *      `{ tenantId, currentStep, isStepComplete(n) }` state. The hook
 *      `useWizardState` wraps this with the Convex `useQuery` calls.
 *
 * Heuristics under test (issue #265 spec, verbatim):
 *   - step 1 incomplete if no tenant back-link on the prospect
 *   - step 2 always navigable (skip = "complete", optional step)
 *   - step 3 always navigable once a tenant exists (V1 no tracking)
 *   - step 4 incomplete if no branding settings (primaryColor OR logo absent)
 *   - step 5 incomplete if no published menu snapshot
 *   - step 6 always navigable (front-only, no persistence)
 *   - step 7 incomplete if no manager invite sent
 *   - step 8 incomplete if tenant.status === "pending"
 *   - currentStep = first incomplete step (1..8) — falls back to 8 when all
 *     prior steps are complete (the activation step is always the "where to
 *     land" by default when the rest is done).
 */
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

import {
  computeWizardState,
  decideWizardShell,
  isStepNavigable,
} from "./wizard.decision";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;
const TENANT_ID = "tenants_aaa" as unknown as Id<"tenants">;
const PUBLISHED_MENU_ID =
  "publishedMenus_xxx" as unknown as Id<"publishedMenus">;
const MANAGER_INVITE_ID = "adminInvites_xxx" as unknown as Id<"adminInvites">;
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
    phase: "preparation",
    source: "cold_call",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeTenant(overrides: Partial<Doc<"tenants">> = {}): Doc<"tenants"> {
  return {
    _id: TENANT_ID,
    _creationTime: 1_700_000_000_000,
    slug: "khan",
    name: "Khan",
    siret: "12345678900010",
    status: "pending",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// decideWizardShell — outer access gate
// ---------------------------------------------------------------------------
describe("decideWizardShell — F-WIZARD [1/10] (#265) outer access gate", () => {
  it("session not ready → `wait` (parent SessionGuard owns the spinner)", () => {
    const out = decideWizardShell({
      session: { status: "loading" },
      prospect: undefined,
    });
    expect(out.kind).toBe("wait");
  });

  it("KB Manager → `forbidden` (RBAC, AC#7 — wizard is root-only)", () => {
    const out = decideWizardShell({
      session: managerSession(),
      prospect: makeProspect(),
    });
    expect(out.kind).toBe("forbidden");
  });

  it("KB Admin + prospect `undefined` (Convex in-flight) → `loading-prospect`", () => {
    const out = decideWizardShell({
      session: adminSession(),
      prospect: undefined,
    });
    expect(out.kind).toBe("loading-prospect");
  });

  it("KB Admin + prospect `null` → `not-found` (AC#8 — defensive route)", () => {
    const out = decideWizardShell({
      session: adminSession(),
      prospect: null,
    });
    expect(out.kind).toBe("not-found");
  });

  it("KB Admin + prospect hydrated in `preparation` phase → `show`", () => {
    const prospect = makeProspect({ phase: "preparation" });
    const out = decideWizardShell({ session: adminSession(), prospect });
    expect(out.kind).toBe("show");
    if (out.kind === "show") {
      expect(out.prospect).toBe(prospect);
    }
  });

  it("KB Admin + prospect in `installation` phase → `show` (Closing → provisioning)", () => {
    const prospect = makeProspect({ phase: "installation" });
    const out = decideWizardShell({ session: adminSession(), prospect });
    expect(out.kind).toBe("show");
  });

  it("KB Admin + prospect in `operationnel` phase → `show` (re-open wizard on already-provisioned)", () => {
    const prospect = makeProspect({
      phase: "operationnel",
      tenantId: TENANT_ID,
    });
    const out = decideWizardShell({ session: adminSession(), prospect });
    expect(out.kind).toBe("show");
  });

  it("KB Admin + prospect in `acquisition` phase → `wrong-phase` (defensive — Launcher gates appearance, route is also defensive per AC#8)", () => {
    const prospect = makeProspect({ phase: "acquisition" });
    const out = decideWizardShell({ session: adminSession(), prospect });
    expect(out.kind).toBe("wrong-phase");
  });
});

// ---------------------------------------------------------------------------
// computeWizardState — pure heuristic
// ---------------------------------------------------------------------------
describe("computeWizardState — F-WIZARD [1/10] (#265) step heuristic", () => {
  it("no tenant back-link → currentStep = 1, all steps from 2..8 not complete", () => {
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: undefined }),
      tenant: undefined,
      publishedMenu: undefined,
      managerInvite: undefined,
    });
    expect(state.tenantId).toBeNull();
    expect(state.currentStep).toBe(1);
    expect(state.isStepComplete(1)).toBe(false);
    expect(state.isStepComplete(2)).toBe(false);
  });

  it("tenant back-link present + tenant in flight (undefined) → tenantId surfaces, step heuristic is conservative (not advanced past 1)", () => {
    // Tenant id is on the prospect but the tenant query is still in flight.
    // We surface the tenantId (so the wizard can wire mutations) but we do
    // NOT advance the cursor past step 1 — the dependant queries (branding,
    // menu, invite) all need the tenant doc to evaluate.
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: TENANT_ID }),
      tenant: undefined,
      publishedMenu: undefined,
      managerInvite: undefined,
    });
    expect(state.tenantId).toBe(TENANT_ID);
    // Step 1 is COMPLETE the moment the back-link exists (the tenant has
    // been provisioned). The cursor still parks on step 2 (the next step)
    // while later dependencies are in flight.
    expect(state.isStepComplete(1)).toBe(true);
    expect(state.currentStep).toBe(2);
  });

  it("tenant exists, no branding settings → step 4 incomplete, currentStep = 4 (steps 2 and 3 skipped — always navigable)", () => {
    // Steps 2 (custom domain optional) and 3 (Stripe — no tracking V1) are
    // always navigable and the cursor SKIPS them when looking for the first
    // incomplete step. So with only step 1 done, the next "incomplete that
    // matters" is step 4 (branding).
    const tenant = makeTenant({ branding: undefined });
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: TENANT_ID }),
      tenant,
      publishedMenu: undefined,
      managerInvite: undefined,
    });
    expect(state.tenantId).toBe(TENANT_ID);
    expect(state.isStepComplete(1)).toBe(true);
    expect(state.isStepComplete(4)).toBe(false);
    expect(state.currentStep).toBe(4);
  });

  it("step 4 considered complete iff branding has BOTH primaryColor AND logoUrl", () => {
    const tenant = makeTenant({
      branding: { primaryColor: "#1B7A3D" /* no logo */ },
    });
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: TENANT_ID }),
      tenant,
      publishedMenu: undefined,
      managerInvite: undefined,
    });
    // Missing logo → step 4 still incomplete.
    expect(state.isStepComplete(4)).toBe(false);
  });

  it("step 4 complete + no published menu → currentStep = 5", () => {
    const tenant = makeTenant({
      branding: { primaryColor: "#1B7A3D", logoUrl: "https://x/logo.png" },
    });
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: TENANT_ID }),
      tenant,
      publishedMenu: null,
      managerInvite: undefined,
    });
    expect(state.isStepComplete(4)).toBe(true);
    expect(state.isStepComplete(5)).toBe(false);
    expect(state.currentStep).toBe(5);
  });

  it("step 5 complete (publishedMenu present) + no manager invite → currentStep = 7 (step 6 skipped, always navigable)", () => {
    const tenant = makeTenant({
      branding: { primaryColor: "#1B7A3D", logoUrl: "https://x/logo.png" },
    });
    const publishedMenu = {
      _id: PUBLISHED_MENU_ID,
      _creationTime: 1,
      tenantId: TENANT_ID,
    } as unknown as Doc<"publishedMenus">;
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: TENANT_ID }),
      tenant,
      publishedMenu,
      managerInvite: null,
    });
    expect(state.isStepComplete(5)).toBe(true);
    expect(state.isStepComplete(6)).toBe(true);
    expect(state.isStepComplete(7)).toBe(false);
    expect(state.currentStep).toBe(7);
  });

  it("manager invite sent + tenant still pending → currentStep = 8 (activation)", () => {
    const tenant = makeTenant({
      status: "pending",
      branding: { primaryColor: "#1B7A3D", logoUrl: "https://x/logo.png" },
    });
    const publishedMenu = {
      _id: PUBLISHED_MENU_ID,
      _creationTime: 1,
      tenantId: TENANT_ID,
    } as unknown as Doc<"publishedMenus">;
    const managerInvite = {
      _id: MANAGER_INVITE_ID,
      _creationTime: 1,
      tenantId: TENANT_ID,
    } as unknown as Doc<"adminInvites">;
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: TENANT_ID }),
      tenant,
      publishedMenu,
      managerInvite,
    });
    expect(state.isStepComplete(7)).toBe(true);
    expect(state.isStepComplete(8)).toBe(false);
    expect(state.currentStep).toBe(8);
  });

  it("tenant.status === 'active' → step 8 complete, currentStep stays at 8 (last step, no further to advance)", () => {
    const tenant = makeTenant({
      status: "active",
      branding: { primaryColor: "#1B7A3D", logoUrl: "https://x/logo.png" },
    });
    const publishedMenu = {
      _id: PUBLISHED_MENU_ID,
      _creationTime: 1,
      tenantId: TENANT_ID,
    } as unknown as Doc<"publishedMenus">;
    const managerInvite = {
      _id: MANAGER_INVITE_ID,
      _creationTime: 1,
      tenantId: TENANT_ID,
    } as unknown as Doc<"adminInvites">;
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: TENANT_ID }),
      tenant,
      publishedMenu,
      managerInvite,
    });
    expect(state.isStepComplete(8)).toBe(true);
    expect(state.currentStep).toBe(8);
  });

  it("isStepComplete(n) returns false for n outside 1..8 (defensive)", () => {
    const state = computeWizardState({
      prospect: makeProspect({ tenantId: undefined }),
      tenant: undefined,
      publishedMenu: undefined,
      managerInvite: undefined,
    });
    expect(state.isStepComplete(0)).toBe(false);
    expect(state.isStepComplete(9)).toBe(false);
    expect(state.isStepComplete(-1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isStepNavigable — stepper click policy
// ---------------------------------------------------------------------------
describe("isStepNavigable — F-WIZARD [1/10] (#265) stepper click policy", () => {
  it("any step ≤ currentStep is navigable (free backwards nav, AC stepper spec)", () => {
    expect(isStepNavigable({ targetStep: 1, currentStep: 5 })).toBe(true);
    expect(isStepNavigable({ targetStep: 4, currentStep: 5 })).toBe(true);
    expect(isStepNavigable({ targetStep: 5, currentStep: 5 })).toBe(true);
  });

  it("any step > currentStep is NOT navigable (click on a future un-unlocked step = no-op, per AC#3)", () => {
    expect(isStepNavigable({ targetStep: 6, currentStep: 5 })).toBe(false);
    expect(isStepNavigable({ targetStep: 8, currentStep: 1 })).toBe(false);
  });

  it("out-of-range targets are not navigable (defensive)", () => {
    expect(isStepNavigable({ targetStep: 0, currentStep: 1 })).toBe(false);
    expect(isStepNavigable({ targetStep: 9, currentStep: 8 })).toBe(false);
  });
});
