/**
 * F-WIZARD [1/10] (#265) — `decideWizardShell` + `computeWizardState` +
 * `isStepNavigable`, the pure logic underneath the provisioning wizard.
 *
 * Pinned at the source-file level (same split discipline as `decideSessionGate`,
 * `decideTenantGate`, `decideProspectFiche`). The React shell (`wizard-view`
 * + `page.tsx` + `use-wizard-state`) is a thin adapter on top — every branch
 * of the wizard's WHAT-TO-DO logic lives here, in node-pure functions, with
 * zero React / Convex / DOM.
 *
 * Three pure surfaces exposed:
 *
 *   1. `decideWizardShell({ session, prospect })` — outer access gate. Mirrors
 *      `decideProspectFiche` but adds a `wrong-phase` branch: the wizard only
 *      makes sense on a prospect in `preparation` / `installation` /
 *      `operationnel` (the Launcher button on the prospect fiche enforces
 *      appearance, but the route itself is also defensive per issue #265
 *      acceptance criterion #8).
 *
 *   2. `computeWizardState({ prospect, tenant, publishedMenu, managerInvite })`
 *      — pure heuristic that maps the DB snapshot to the wizard's
 *      `{ tenantId, currentStep, isStepComplete(n) }` state. The hook
 *      `useWizardState` wraps this with the Convex `useQuery` calls.
 *
 *   3. `isStepNavigable({ targetStep, currentStep })` — stepper click policy
 *      consumed by `WizardStepper`. Backwards / current = navigable; future
 *      = no-op (issue spec verbatim « click sur un step futur non-débloqué
 *      = no-op »).
 *
 * Why not let `useQuery` throw on a non-admin caller?
 * --------------------------------------------------
 * `kbAdminQuery` throws `FORBIDDEN: kb_admin role required` for any non-root
 * caller. If the page fired the query unconditionally, a manager landing on
 * `/pipeline/<id>/provision` (via URL share, etc.) would surface a raw Convex
 * error boundary INSTEAD of the canonical UnauthorizedCard. Same pattern as
 * `/pipeline/<id>` itself (`decideProspectFiche`): the decision short-circuits
 * to `forbidden` BEFORE the network round-trip even fires, and the view
 * renders the shared refusal card.
 */
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

// ---------------------------------------------------------------------------
// 1. decideWizardShell — outer access gate
// ---------------------------------------------------------------------------

export type WizardShellInput = {
  session: SessionState;
  /**
   * The prospect from `useQuery(api.prospects.get, ...)`, following Convex's
   * tri-state contract: `undefined` (in-flight) | `null` (no such doc) |
   * `Doc<"prospects">` (hydrated). Stubbed at the wizard hook to `undefined`
   * until `api.prospects.get` lands in F-PIPELINE-CRM (same pattern as
   * `/pipeline/<id>/page.tsx`).
   */
  prospect: Doc<"prospects"> | null | undefined;
};

export type WizardShellDecision =
  | { kind: "wait" }
  | { kind: "forbidden" }
  | { kind: "loading-prospect" }
  | { kind: "not-found" }
  | { kind: "wrong-phase"; prospect: Doc<"prospects"> }
  | { kind: "show"; prospect: Doc<"prospects"> };

/**
 * Phases on which the wizard makes sense. `acquisition` is excluded — a
 * still-prospect-in-cold-call has nothing to provision yet (the Closing
 * milestones aren't even reached). The Launcher button on the prospect fiche
 * already gates appearance based on Closing-completed; this is the defensive
 * back-stop for a direct URL hit.
 */
const PROVISIONABLE_PHASES: ReadonlyArray<Doc<"prospects">["phase"]> = [
  "preparation",
  "installation",
  "operationnel",
];

export function decideWizardShell(
  input: WizardShellInput,
): WizardShellDecision {
  const { session, prospect } = input;

  if (session.status !== "ready") {
    return { kind: "wait" };
  }
  if (!session.session.isAdmin) {
    return { kind: "forbidden" };
  }

  if (prospect === undefined) {
    return { kind: "loading-prospect" };
  }
  if (prospect === null) {
    return { kind: "not-found" };
  }

  if (!PROVISIONABLE_PHASES.includes(prospect.phase)) {
    return { kind: "wrong-phase", prospect };
  }

  return { kind: "show", prospect };
}

// ---------------------------------------------------------------------------
// 2. computeWizardState — step heuristic
// ---------------------------------------------------------------------------

export type WizardStateInput = {
  prospect: Doc<"prospects">;
  /**
   * The tenant doc (when `prospect.tenantId` is set). `undefined` = query in
   * flight; `null` = no such tenant (the back-link points at a deleted doc —
   * unusual but defensible). Pass `undefined` when `prospect.tenantId` is
   * itself absent (no fetch fired).
   */
  tenant: Doc<"tenants"> | null | undefined;
  /**
   * The published menu snapshot for the tenant (one row per tenant). Convex
   * tri-state: `undefined` (in flight) | `null` (no row yet) | `Doc`.
   */
  publishedMenu: Doc<"publishedMenus"> | null | undefined;
  /**
   * The manager invite for this tenant (latest). Convex tri-state.
   * Currently lives in the shared `adminInvites` table (legacy + manager
   * invites cohabit per `convex/table/adminInvites.ts`).
   */
  managerInvite: Doc<"adminInvites"> | null | undefined;
  /**
   * F-WIZARD [4/10] (#268) — local-only « step 2 explicitly skipped » flag.
   * Issue spec verbatim: « le hook useWizardState traite step 2 comme
   * complete si customDomain est posé OU si l'user a explicitement skip
   * (skip = mark complete localement, suffit pour la nav) ».
   *
   * NEVER round-tripped to the backend — the wizard front owns it as
   * React state inside `useWizardState`. Default `false` (operator hasn't
   * seen the form yet → step 2 stays unticked).
   */
  step2Skipped?: boolean;
  /**
   * Local-only « step 3 (Stripe KYC) visited » flag (W4 E2E fix —
   * docs/tests/E2E-checklist.md groupe W). Step 3 has NO persisted
   * completion signal in V1 (« step 3 toujours navigable, V1 pas de
   * tracking ») — but treating it as complete the moment a tenant exists
   * is UX-misleading (the stepper ticks step 3 ✅ before the operator
   * ever clicked « Générer le lien Stripe Connect »). Mirror of
   * `step2Skipped`: the wizard front owns this flag as React state inside
   * `useWizardState`; `Step3Form` flips it true the first time it mounts.
   * Default `false` (operator hasn't seen the form yet → step 3 stays
   * unticked). Never round-tripped to the backend.
   */
  step3Visited?: boolean;
  /**
   * Local-only « step 6 (QR sticker) visited » flag (W4 E2E fix —
   * docs/tests/E2E-checklist.md groupe W). Step 6 is « front-only, no
   * persistence » (the operator downloads the SVG/PDF) — same UX
   * pitfall as step 3: treating it as complete the moment a tenant
   * exists ticks step 6 ✅ before the operator ever opened it. Mirror
   * of `step2Skipped`: the wizard front owns this flag as React state
   * inside `useWizardState`; `Step6Form` flips it true the first time
   * it mounts. Default `false`. Never round-tripped to the backend.
   */
  step6Visited?: boolean;
};

export type WizardState = {
  /**
   * The provisioned tenant id (when the prospect has been through step 1).
   * `null` before that — used by downstream slices to know whether to wire
   * mutations against a real tenant or block on step 1.
   */
  tenantId: Id<"tenants"> | null;
  /**
   * The step the wizard should land on by default (first incomplete step,
   * 1..8). Backwards navigation is always allowed via the stepper —
   * `currentStep` is only the « where to start » signal.
   */
  currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /**
   * Per-step completion check, consumed by the stepper to render the
   * `complete` / `current` / `pending` state. `n` outside 1..8 → `false`
   * (defensive).
   */
  isStepComplete: (n: number) => boolean;
};

/**
 * Step 4 (branding) is considered complete only when BOTH the primary color
 * AND the logo are present — the PWA cliente needs both to render correctly.
 * Either one alone is treated as in-progress.
 */
function isBrandingComplete(tenant: Doc<"tenants">): boolean {
  const b = tenant.branding;
  if (b === undefined) return false;
  return (
    typeof b.primaryColor === "string" &&
    b.primaryColor.length > 0 &&
    typeof b.logoUrl === "string" &&
    b.logoUrl.length > 0
  );
}

export function computeWizardState(input: WizardStateInput): WizardState {
  const {
    prospect,
    tenant,
    publishedMenu,
    managerInvite,
    step2Skipped = false,
    step3Visited = false,
    step6Visited = false,
  } = input;

  const tenantId: Id<"tenants"> | null = prospect.tenantId ?? null;

  // Step 1 = provisioning. Complete iff the back-link is set on the prospect.
  const step1Complete = tenantId !== null;

  // Step 2 (domaine personnalisé) — F-WIZARD [4/10] (#268).
  //
  // Complete iff EITHER `tenant.customDomain` is set on the persisted row OR
  // the operator has explicitly clicked « Skip » in the form (local-only
  // `step2Skipped` flag, owned by `useWizardState`). The step is OPTIONAL
  // (modèle Owner.com) and STILL « always navigable, never pulls the
  // cursor » per the original spec: the cursor heuristic below does NOT
  // include step 2 in `STEPS_THAT_PULL_CURSOR`, so an unticked step 2 never
  // blocks progression.
  const step2Complete =
    step1Complete &&
    (step2Skipped ||
      (tenant !== undefined &&
        tenant !== null &&
        typeof tenant.customDomain === "string" &&
        tenant.customDomain.length > 0));

  // Step 3 (Stripe KYC) — V1 has no persisted KYC tracking signal (issue spec
  // « step 3 toujours navigable, V1 pas de tracking »), so the cursor still
  // skips this step (see STEPS_THAT_PULL_CURSOR below). BUT we no longer
  // pre-tick it ✅ the moment a tenant exists (W4 E2E fix — the stepper
  // would show step 3 complete even when the operator NEVER opened it).
  // The completion gate is now `step3Visited`, a local flag that flips
  // true the first time `Step3Form` mounts (mirror of `step2Skipped`).
  // Step 3 remains optional / non-blocking: the cursor never parks here,
  // so an unvisited step 3 doesn't stop the operator from progressing.
  const step3Complete = step1Complete && step3Visited;

  // Step 4 = branding. Needs the tenant doc + branding fields populated.
  const step4Complete =
    step1Complete && tenant !== undefined && tenant !== null
      ? isBrandingComplete(tenant)
      : false;

  // Step 5 = menu publication. Complete iff a publishedMenus row exists.
  const step5Complete =
    step1Complete && publishedMenu !== undefined && publishedMenu !== null;

  // Step 6 = QR sticker rendering (front-only, no backend persistence — the
  // operator downloads the SVG/PDF). Same UX pitfall as step 3 fixed here
  // (W4 E2E fix): pre-ticking step 6 ✅ the moment a tenant exists ticked
  // a step the operator never opened. The completion gate is now
  // `step6Visited`, a local flag flipped true the first time `Step6Form`
  // mounts (mirror of `step2Skipped` / `step3Visited`). Step 6 stays
  // optional and never pulls the cursor.
  const step6Complete = step1Complete && step6Visited;

  // Step 7 = manager invite sent.
  const step7Complete =
    step1Complete && managerInvite !== undefined && managerInvite !== null;

  // Step 8 = activation. Complete iff tenant.status !== "pending".
  const step8Complete =
    step1Complete &&
    tenant !== undefined &&
    tenant !== null &&
    tenant.status !== "pending";

  const completion = [
    false, // index 0 unused — steps are 1-indexed
    step1Complete,
    step2Complete,
    step3Complete,
    step4Complete,
    step5Complete,
    step6Complete,
    step7Complete,
    step8Complete,
  ] as const;

  /**
   * The cursor finds the first incomplete step. Steps 2, 3 and 6 are
   * "always-navigable / skip-allowed" per the issue spec — they do NOT pull
   * the cursor (a still-undone Stripe link should not stop us from doing
   * branding / menu first). Step 8 is the natural fallback when everything
   * else is done (the activation page).
   *
   * Edge case: when step 1 is the back-link only (tenant doc not yet
   * hydrated by the parent's `useQuery`), we park the cursor on step 2
   * rather than guessing about steps 4-7. This avoids a flicker where the
   * cursor jumps from "step 4" to "step 5" as each query resolves; the
   * operator lands on the first non-blocking step and walks forward.
   */
  const STEPS_THAT_PULL_CURSOR = [1, 4, 5, 7, 8] as const;
  const tenantHydrated = tenant !== undefined && tenant !== null;
  let currentStep: WizardState["currentStep"] = 8;
  if (!step1Complete) {
    currentStep = 1;
  } else if (!tenantHydrated) {
    // Tenant query in flight — park on the first navigable step (2) until
    // we have enough data to compute the real cursor.
    currentStep = 2;
  } else {
    currentStep = 8;
    for (const n of STEPS_THAT_PULL_CURSOR) {
      if (!completion[n]) {
        currentStep = n;
        break;
      }
    }
  }

  const isStepComplete = (n: number): boolean => {
    if (n < 1 || n > 8) return false;
    return completion[n];
  };

  return { tenantId, currentStep, isStepComplete };
}

// ---------------------------------------------------------------------------
// 3. isStepNavigable — stepper click policy
// ---------------------------------------------------------------------------

export type StepNavigableInput = {
  targetStep: number;
  currentStep: number;
};

/**
 * Click policy:
 *   - any step ≤ currentStep is navigable (backwards / current = free).
 *   - any step > currentStep is a no-op (« click sur un step futur
 *     non-déverrouillé = no-op », issue spec).
 *   - out-of-range targets (< 1 or > 8) are not navigable.
 */
export function isStepNavigable(input: StepNavigableInput): boolean {
  const { targetStep, currentStep } = input;
  if (targetStep < 1 || targetStep > 8) return false;
  return targetStep <= currentStep;
}
