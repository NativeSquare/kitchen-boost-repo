/**
 * F-WIZARD [2/10] (#266) — `decideProvisionLauncher`, the pure logic of the
 * provisioning wizard launcher.
 *
 * Pinned at the source-file level (same split discipline as
 * `decideProspectFiche`, `decideWizardShell`). The React shell
 * (`ProvisionLauncherButton`) is a thin adapter that simply renders what this
 * decision returns — no business logic in the JSX.
 *
 * Decision matrix (issue #266 acceptance criteria):
 *
 *   - prospect's Closing event NOT complete                 → `hidden`
 *     (« Bouton visible seulement quand le prospect est en phase Closing »).
 *   - Closing-complete + tenant `status === "active"`       → `view-tenant`
 *     (« Ouvrir la vue resto » remplace le bouton wizard).
 *   - Closing-complete + tenantId back-link set             → `resume`
 *     (« Reprendre le wizard »).
 *   - Closing-complete + no tenantId back-link              → `launch`
 *     (« Lancer le wizard de provisioning »).
 *
 * Closing-completion is the canonical evaluation: contratSigne + kbisRecu +
 * pieceIdentiteRecue + ribRecu, PLUS the conditional `factureTablettePayee`
 * when `tabletteMode = achat_kb` (PRD 70 §3.3, kb-admin CONTEXT "Closing").
 * The set is computed in-line here (NOT imported from the backend) because
 * the scope of this story is `apps/admin/src/app/(app)/pipeline/[prospectId]/`
 * STRICT — no touch to `packages/backend/convex/`. The truth lives in
 * `convex/lib/onboarding/pipeline.ts` (`requiredClosingMilestones` /
 * `MANDATORY_CLOSING_MILESTONES`); the front-side copy below mirrors it
 * exactly. A future slice can lift the shared set into a cross-package
 * module (`packages/backend/convex/lib/onboarding/index.ts` re-export, or
 * `packages/shared/`), but doing it here would expand scope.
 *
 * Email warning: `launch` and `resume` carry an optional `warning` flag set
 * to `"missing-manager-email"` when the prospect has no email yet (the step 1
 * form of the wizard captures it — the warning is informational, NOT a
 * block). `view-tenant` deliberately does NOT carry the warning (we are past
 * provisioning; mid-operation email problems are surfaced by F-PIPELINE-CRM,
 * not the launcher).
 *
 * `/t/<id>` vs `/t/<id>/dashboard`: the issue spec mentioned
 * `/t/[tenantId]/dashboard`, but no `dashboard` sub-route exists in V1. We
 * follow the established convention (`buildTenantOperationalHref` /
 * `tenant-switcher.tsx`) and target the bare `/t/<id>` segment; the
 * `/t/[id]` root page redirects to the tenant's default sub-route
 * (currently `/menu`). When F-SHELL #139 lands a real dashboard, this single
 * line flips here and the launcher follows automatically.
 */
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

/**
 * The 4 ALWAYS-mandatory Closing milestone keys (PRD 70 §3.3 / kb-admin
 * CONTEXT "Closing"). Mirrors `MANDATORY_CLOSING_MILESTONES` from
 * `convex/lib/onboarding/pipeline.ts` verbatim — kept narrow so a drift
 * is caught at typecheck time (each key MUST be an actual binary milestone
 * field on the `milestones` object).
 */
type ClosingMilestoneKey =
  | "contratSigne"
  | "kbisRecu"
  | "pieceIdentiteRecue"
  | "ribRecu"
  | "factureTablettePayee";

const MANDATORY_CLOSING_MILESTONES: readonly ClosingMilestoneKey[] = [
  "contratSigne",
  "kbisRecu",
  "pieceIdentiteRecue",
  "ribRecu",
];

/** The CONDITIONAL Closing milestone — applies only when KB supplies the tablet. */
const CONDITIONAL_TABLETTE_MILESTONE: ClosingMilestoneKey =
  "factureTablettePayee";

function isClosingComplete(prospect: Doc<"prospects">): boolean {
  const milestones = prospect.milestones ?? {};
  for (const key of MANDATORY_CLOSING_MILESTONES) {
    if (milestones[key] === undefined) return false;
  }
  if (prospect.tabletteMode === "achat_kb") {
    if (milestones[CONDITIONAL_TABLETTE_MILESTONE] === undefined) return false;
  }
  return true;
}

/**
 * A prospect's manager email is "missing" when the field is absent, an empty
 * string, or whitespace-only. (The step 1 wizard form re-captures it, but
 * the operator gets a heads-up here.)
 */
function isManagerEmailMissing(prospect: Doc<"prospects">): boolean {
  const email = prospect.email;
  if (email === undefined || email === null) return true;
  return email.trim().length === 0;
}

export type ProvisionLauncherInput = {
  prospect: Doc<"prospects">;
  /**
   * The tenant doc when `prospect.tenantId` is set (Convex tri-state):
   *   - `undefined` → query in flight (or back-link absent and no fetch
   *     fired — same shape, same surface).
   *   - `null`      → no doc with this id (defensive — unusual).
   *   - `Doc`       → hydrated.
   * Passed by the parent (the prospect fiche). When the live query is not
   * yet available (today — `api.tenants.get` lives in F-PIPELINE-CRM
   * scope), the caller stubs this to `undefined` and the launcher stays on
   * `launch` / `resume` (never `view-tenant`); the `view-tenant` branch
   * fires once the tenant query is live AND reports `status === "active"`.
   */
  tenant: Doc<"tenants"> | null | undefined;
};

/**
 * The 4 mutually-exclusive launcher states. `launch` / `resume` carry a
 * `warning` slot for the email heads-up (null when nothing to flag);
 * `view-tenant` carries only the operational href.
 */
export type ProvisionLauncherDecision =
  | { kind: "hidden" }
  | {
      kind: "launch";
      href: string;
      warning: "missing-manager-email" | null;
    }
  | {
      kind: "resume";
      href: string;
      warning: "missing-manager-email" | null;
    }
  | { kind: "view-tenant"; href: string };

function buildWizardHref(prospectId: Id<"prospects">): string {
  return `/pipeline/${prospectId as unknown as string}/provision`;
}

function buildTenantOperationalHref(tenantId: Id<"tenants">): string {
  // Bare `/t/<id>` segment — mirrors `prospect-fiche.decision.ts`
  // `buildTenantOperationalHref` and `tenant-switcher.tsx`
  // `buildSwitchTarget`. The `/t/[id]` root page redirects to the default
  // sub-route (currently `/menu`).
  return `/t/${tenantId as unknown as string}`;
}

export function decideProvisionLauncher(
  input: ProvisionLauncherInput,
): ProvisionLauncherDecision {
  const { prospect, tenant } = input;

  // AC2 — visibility gate. Closing not yet complete = nothing to render.
  if (!isClosingComplete(prospect)) {
    return { kind: "hidden" };
  }

  const tenantId = prospect.tenantId;

  // AC5 — `view-tenant` ONLY when the tenant is hydrated AND active. A
  // pending / suspended tenant stays on `resume` (the wizard view is the
  // correct surface to either finish provisioning or investigate the
  // suspension). A tenant query in flight (`tenant === undefined`) does
  // NOT pre-promote to `view-tenant`: we don't yet know the status.
  if (tenantId !== undefined && tenant && tenant.status === "active") {
    return {
      kind: "view-tenant",
      href: buildTenantOperationalHref(tenantId),
    };
  }

  const warning: "missing-manager-email" | null = isManagerEmailMissing(
    prospect,
  )
    ? "missing-manager-email"
    : null;

  // AC3 — adaptive label. The back-link on the prospect (set during step 1
  // of the wizard) is enough to switch from `launch` to `resume`, even
  // before the tenant doc itself is hydrated.
  if (tenantId !== undefined) {
    return {
      kind: "resume",
      href: buildWizardHref(prospect._id),
      warning,
    };
  }

  return {
    kind: "launch",
    href: buildWizardHref(prospect._id),
    warning,
  };
}
