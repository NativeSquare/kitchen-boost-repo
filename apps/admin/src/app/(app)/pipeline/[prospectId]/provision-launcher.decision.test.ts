/**
 * F-WIZARD [2/10] (#266) — `decideProvisionLauncher` decision logic test
 * matrix.
 *
 * Pinned at the pure-function level (same split discipline as
 * `decideProspectFiche`, `decideWizardShell`) so vitest runs every branch in
 * the lean `node` env (no DOM, no router, no Convex client). The React shell
 * (`ProvisionLauncherButton`) is a thin adapter on top.
 *
 * Acceptance criteria pinned (issue #266):
 *
 *   - AC1 « Composant `ProvisionLauncherButton` exporté » — covered by the
 *     view-side test file. The decision pins WHAT to render, the view pins
 *     HOW it's rendered.
 *   - AC2 « Bouton visible seulement quand le prospect est en phase Closing
 *     (milestones Closing tous cochés) » — pinned here as `kind: "hidden"`
 *     when Closing is not complete. Closing-completion is the canonical
 *     `evaluateClosing` check (PRD 70 §3.3 / kb-admin CONTEXT "Closing"):
 *     contratSigne + kbisRecu + pieceIdentiteRecue + ribRecu, PLUS the
 *     conditional `factureTablettePayee` when `tabletteMode = achat_kb`.
 *   - AC3 « Label "Lancer le wizard de provisioning" si pas de back-link
 *     tenant, "Reprendre le wizard" sinon » — pinned as
 *     `kind: "launch" | "resume"`.
 *   - AC4 « Click → navigation vers la route wizard du slice [1/10] » —
 *     pinned as `href: "/pipeline/<id>/provision"`.
 *   - AC5 « Bouton "Ouvrir la vue resto" remplace le bouton wizard quand le
 *     tenant est `active` » — pinned as `kind: "view-tenant"` with the
 *     operational href.
 *   - AC6 « Warning visuel si email gérant manquant sur le prospect » —
 *     pinned as `warning: "missing-manager-email"` on the launch / resume
 *     branches. The warning is informational, NOT a block (the step 1 form
 *     of the wizard captures the email; this is just a heads-up).
 */
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { decideProvisionLauncher } from "./provision-launcher.decision";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;
const TENANT_ID = "tenants_aaa" as unknown as Id<"tenants">;

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

/**
 * The 4 ALWAYS-mandatory Closing milestones (kb-admin CONTEXT "Closing"
 * + PRD 70 §3.3). Helper that stamps them so a prospect becomes
 * Closing-complete (for the `tabletteMode = appareil_existant` / absent
 * default — the conditional `factureTablettePayee` is NOT required there).
 */
function closingComplete(): NonNullable<Doc<"prospects">["milestones"]> {
  const at = 1_700_000_000_000;
  return {
    contratSigne: at,
    kbisRecu: at,
    pieceIdentiteRecue: at,
    ribRecu: at,
  };
}

function makeTenant(overrides: Partial<Doc<"tenants">> = {}): Doc<"tenants"> {
  return {
    _id: TENANT_ID,
    _creationTime: 1_700_000_000_000,
    slug: "lartisan",
    name: "L'Artisan",
    siret: "12345678900012",
    status: "pending",
    ...overrides,
  };
}

describe("decideProvisionLauncher — AC2 (visibility gate on Closing-completion)", () => {
  it("prospect with NO milestones at all → `hidden` (Closing event not even started)", () => {
    expect(
      decideProvisionLauncher({
        prospect: makeProspect(),
        tenant: undefined,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("prospect with ONLY some Closing milestones → `hidden` (Closing event incomplete)", () => {
    expect(
      decideProvisionLauncher({
        prospect: makeProspect({
          milestones: {
            contratSigne: 1,
            kbisRecu: 1,
            // missing pieceIdentiteRecue + ribRecu
          },
        }),
        tenant: undefined,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("prospect with all 4 mandatory Closing milestones, tabletteMode=appareil_existant → NOT hidden", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        tabletteMode: "appareil_existant",
        milestones: closingComplete(),
      }),
      tenant: undefined,
    });
    expect(decision.kind).not.toBe("hidden");
  });

  it("prospect with 4 mandatory Closing milestones but tabletteMode=achat_kb WITHOUT factureTablettePayee → `hidden`", () => {
    // The conditional tablette-invoice milestone is REQUIRED for Closing
    // when KB supplies the tablet (PRD 70 §3.3, `requiredClosingMilestones`).
    expect(
      decideProvisionLauncher({
        prospect: makeProspect({
          tabletteMode: "achat_kb",
          milestones: closingComplete(),
          // factureTablettePayee missing → Closing not complete
        }),
        tenant: undefined,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("prospect with tabletteMode=achat_kb AND factureTablettePayee → NOT hidden", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        tabletteMode: "achat_kb",
        milestones: { ...closingComplete(), factureTablettePayee: 1 },
      }),
      tenant: undefined,
    });
    expect(decision.kind).not.toBe("hidden");
  });
});

describe("decideProvisionLauncher — AC3 (label adaptatif Lancer / Reprendre)", () => {
  it("Closing-complete + NO tenantId back-link → `launch` (« Lancer le wizard de provisioning »)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({ milestones: closingComplete() }),
      tenant: undefined,
    });
    expect(decision.kind).toBe("launch");
  });

  it("Closing-complete + tenantId back-link set (tenant still pending) → `resume` (« Reprendre le wizard »)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: makeTenant({ status: "pending" }),
    });
    expect(decision.kind).toBe("resume");
  });

  it("Closing-complete + tenantId back-link set + tenant query in-flight (undefined) → `resume` (we know the back-link exists)", () => {
    // The back-link on the prospect is enough to know provisioning was
    // started — the tenant doc itself may still be loading.
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: undefined,
    });
    expect(decision.kind).toBe("resume");
  });
});

describe("decideProvisionLauncher — AC4 (navigation cible)", () => {
  it("`launch` branch hrefs to `/pipeline/<prospectId>/provision`", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({ milestones: closingComplete() }),
      tenant: undefined,
    });
    if (decision.kind !== "launch") throw new Error("expected launch");
    expect(decision.href).toBe(
      `/pipeline/${PROSPECT_ID as unknown as string}/provision`,
    );
  });

  it("`resume` branch hrefs to the same `/pipeline/<prospectId>/provision` route (the wizard hook lands on the first incomplete step)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: makeTenant({ status: "pending" }),
    });
    if (decision.kind !== "resume") throw new Error("expected resume");
    expect(decision.href).toBe(
      `/pipeline/${PROSPECT_ID as unknown as string}/provision`,
    );
  });
});

describe("decideProvisionLauncher — AC5 (« Ouvrir la vue resto » remplace le bouton wizard quand le tenant est `active`)", () => {
  it("Closing-complete + tenantId set + tenant `active` → `view-tenant` (replaces the wizard button)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: makeTenant({ status: "active" }),
    });
    if (decision.kind !== "view-tenant") {
      throw new Error("expected view-tenant");
    }
    // Operational entry: same target as `buildTenantOperationalHref` — the
    // bare `/t/<id>` segment; the `/t/[id]` root page redirects to the
    // tenant's default sub-route (currently `/menu`). The issue mentioned
    // `/t/[tenantId]/dashboard` but no such route exists in V1; following
    // the established convention (cf. `prospect-fiche.decision.ts`
    // `buildTenantOperationalHref` + `tenant-switcher.tsx` `buildSwitchTarget`)
    // keeps the launcher consistent with the rest of the admin app.
    expect(decision.href).toBe(`/t/${TENANT_ID as unknown as string}`);
  });

  it("Closing-complete + tenant `suspended` → NOT `view-tenant` (suspended is not operational)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: makeTenant({ status: "suspended" }),
    });
    expect(decision.kind).not.toBe("view-tenant");
    // A suspended tenant has been provisioned (back-link set) but is not
    // operational — the wizard view (« Reprendre ») is the correct surface
    // to investigate. We don't fall back to a launcher-side flow that would
    // mask the suspension.
    expect(decision.kind).toBe("resume");
  });

  it("Closing-complete + tenantId set BUT tenant query in-flight (undefined) → `resume` (don't pre-promote to view-tenant; we don't yet know the status)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: undefined,
    });
    expect(decision.kind).toBe("resume");
  });
});

describe("decideProvisionLauncher — AC6 (warning email gérant manquant)", () => {
  it("`launch` + email missing → `warning: 'missing-manager-email'`", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        email: undefined,
        milestones: closingComplete(),
      }),
      tenant: undefined,
    });
    if (decision.kind !== "launch") throw new Error("expected launch");
    expect(decision.warning).toBe("missing-manager-email");
  });

  it("`launch` + email empty string → `warning: 'missing-manager-email'` (whitespace counts as missing)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        email: "  ",
        milestones: closingComplete(),
      }),
      tenant: undefined,
    });
    if (decision.kind !== "launch") throw new Error("expected launch");
    expect(decision.warning).toBe("missing-manager-email");
  });

  it("`launch` + email present → `warning: null`", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        email: "gerant@resto.fr",
        milestones: closingComplete(),
      }),
      tenant: undefined,
    });
    if (decision.kind !== "launch") throw new Error("expected launch");
    expect(decision.warning).toBeNull();
  });

  it("`resume` + email missing → `warning: 'missing-manager-email'` (the wizard step 1 covers it but operator still gets the heads-up)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        email: undefined,
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: makeTenant({ status: "pending" }),
    });
    if (decision.kind !== "resume") throw new Error("expected resume");
    expect(decision.warning).toBe("missing-manager-email");
  });

  it("`view-tenant` branch never carries the email warning (we are past provisioning)", () => {
    const decision = decideProvisionLauncher({
      prospect: makeProspect({
        email: undefined,
        milestones: closingComplete(),
        tenantId: TENANT_ID,
      }),
      tenant: makeTenant({ status: "active" }),
    });
    expect(decision.kind).toBe("view-tenant");
    // No `warning` on the view-tenant shape — the surface intentionally
    // does NOT carry it (a missing email mid-operation is a different
    // problem, surfaced by F-PIPELINE-CRM, not the launcher).
    expect("warning" in decision).toBe(false);
  });
});
