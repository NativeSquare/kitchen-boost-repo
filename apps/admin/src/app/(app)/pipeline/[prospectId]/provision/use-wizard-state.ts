"use client";

/**
 * F-WIZARD [1/10] (#265) — `useWizardState(prospectId)`.
 *
 * Thin Convex-side adapter on top of the pure `computeWizardState`. Reads the
 * prospect (back-link to tenant), the tenant itself (when provisioned), the
 * published menu snapshot, and the manager invite, then delegates the actual
 * step heuristic to the pure function (exhaustively pinned by
 * `wizard.decision.test.ts`).
 *
 * Stub note (mirrors `pipeline/[prospectId]/page.tsx`): NONE of the queries
 * needed by the wizard hook are live yet in V1.
 *
 *   - `api.prospects.get` — lands in F-PIPELINE-CRM.
 *   - `api.lib.tenants.get` / equivalent admin-side tenant lookup — already
 *     exists for the chrome-less layout (`loadTenantForStripe`), but it's a
 *     Stripe-flavoured name; we leave it OUT of this slice scope and STUB
 *     the tenant read to `undefined`. The next wizard slice that needs the
 *     tenant doc (step 4 / branding, slice 4/10) wires the real query.
 *   - `api.lib.menu.publication.*` — exists, but we don't read it here in
 *     this skeleton slice (slice 5/10 owns the menu step).
 *   - `api.lib.admin.managerInvites.*` — exists, but slice 7/10 owns it.
 *
 * Each follow-up wizard slice swaps its own stub for the real `useQuery`
 * call — the hook's public surface (`{ tenantId, currentStep, isStepComplete,
 * goToStep }`) stays stable.
 *
 * Cursor state: the hook owns the « cursor » (current step) as a React
 * state seeded from `computeWizardState({ ... }).currentStep` once the
 * prospect resolves. The caller (`page.tsx`) reads it + uses `goToStep` to
 * mutate it on Prev/Next clicks. This keeps the wizard navigation a pure
 * front concern, no URL change per step (the URL stays
 * `/pipeline/[id]/provision`).
 */
import { useCallback, useState } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { computeWizardState } from "./wizard.decision";
import type { WizardStepNumber } from "./wizard-stepper";

/**
 * Manager invite for a tenant — currently lives in the shared `adminInvites`
 * table (legacy + manager invites cohabit per `convex/table/adminInvites.ts`
 * comments). The hook surfaces it as a tri-state Convex result so a follow-up
 * slice can swap the STUB for the live `useQuery` call against the new
 * `api.lib.admin.managerInvites.*` once it's exposed at the read seam.
 */
type ManagerInviteDoc = Doc<"adminInvites">;

export type UseWizardStateResult = {
  /**
   * The provisioned tenant id (when the prospect has been through step 1).
   * `null` before that.
   */
  tenantId: Id<"tenants"> | null;
  /**
   * The current step the wizard is parked on (1..8).
   */
  currentStep: WizardStepNumber;
  /**
   * Per-step completion check (from `computeWizardState`). The stepper uses
   * this to render the `complete` / `current` / `pending` state.
   */
  isStepComplete: (n: number) => boolean;
  /**
   * Move the wizard to a different step. Out-of-range targets (< 1 or > 8)
   * are clamped silently — the stepper itself already gates clicks on
   * un-unlocked steps via `isStepNavigable`.
   */
  goToStep: (n: WizardStepNumber) => void;
  /**
   * The hydrated dependencies, surfaced for the wizard view's debug header
   * AND for the (future) Step{N}Form components that need them (e.g. step 4
   * pre-fills branding fields from `tenant.branding`).
   */
  prospect: Doc<"prospects"> | null | undefined;
  tenant: Doc<"tenants"> | null | undefined;
  publishedMenu: Doc<"publishedMenus"> | null | undefined;
  managerInvite: ManagerInviteDoc | null | undefined;
};

export function useWizardState(
  prospectId: Id<"prospects"> | undefined,
): UseWizardStateResult {
  // Stubs — every dependency the wizard needs but doesn't yet have a live
  // Convex query for. Marked explicitly so a grep on `STUB` lights them all
  // up when a follow-up slice swaps in the real `useQuery`.
  //
  // The prospectId is read defensively so a future refactor that lives-wires
  // the query has the call site already wired:
  //   const prospect = useQuery(
  //     api.prospects.get,
  //     prospectId ? { prospectId } : "skip",
  //   );
  void prospectId;
  const prospect: Doc<"prospects"> | null | undefined = undefined; // STUB
  const tenant: Doc<"tenants"> | null | undefined = undefined; // STUB
  const publishedMenu: Doc<"publishedMenus"> | null | undefined = undefined; // STUB
  const managerInvite: ManagerInviteDoc | null | undefined = undefined; // STUB

  // Cursor state.
  //
  // The operator's manual Prev/Next clicks must not be clobbered by a
  // re-render after a query resolves, so we keep the cursor in React state.
  // BUT we don't want to seed it via `useEffect(() => setState(...))` either
  // — the React Compiler / `react-hooks/incompatible-library` flags that
  // pattern (cascading renders). Instead we derive the « natural » step from
  // `computeWizardState` purely during render and store ONLY the OVERRIDE
  // the operator dialled in via `goToStep`. If they never click, the cursor
  // tracks the derived step automatically.
  const [override, setOverride] = useState<WizardStepNumber | null>(null);

  const goToStep = useCallback((n: WizardStepNumber) => {
    if (n < 1 || n > 8) return;
    setOverride(n);
  }, []);

  // The completion check + tenantId always reflect the LIVE snapshot (so
  // the stepper's per-step state updates as queries resolve). When the
  // prospect hasn't resolved yet we surface a conservative shape (no
  // tenantId, no completion, cursor parks on step 1) — the wizard view's
  // wait branch hides the cursor visually anyway.
  const liveState = prospect
    ? computeWizardState({
        prospect,
        tenant,
        publishedMenu,
        managerInvite,
      })
    : null;

  const currentStep: WizardStepNumber = override ?? liveState?.currentStep ?? 1;

  return {
    tenantId: liveState?.tenantId ?? null,
    currentStep,
    isStepComplete: liveState?.isStepComplete ?? (() => false),
    goToStep,
    prospect,
    tenant,
    publishedMenu,
    managerInvite,
  };
}
