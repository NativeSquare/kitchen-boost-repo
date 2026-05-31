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
 *   - `api.lib.admin.managerInvites.*` — exists; slice 9/10 (#273) wires
 *     `getLatestManagerInviteForTenant` to drive step 7's completion gate.
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
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { computeWizardState } from "./wizard.decision";
import type { WizardStepNumber } from "./wizard-stepper";

/**
 * Manager invite for a tenant — lives in the shared `adminInvites` table
 * (legacy + manager invites cohabit per `convex/table/adminInvites.ts`
 * comments). The hook surfaces it as a tri-state Convex result fed by
 * `api.lib.admin.managerInvites.getLatestManagerInviteForTenant` (shipped by
 * slice 9/10 #273). `null` = no invite has been emitted yet for this tenant;
 * any non-null row (regardless of `acceptedAt`) counts as « step 7 complete »
 * per the issue spec.
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
  // Prospect is now LIVE (F-WIZARD [3/10] #267): the wizard cannot do
  // anything without the prospect doc — step 1's pre-fill, the back-link
  // detection (`prospect.tenantId`), and the cursor heuristic all need it.
  // The live query was deliberately stubbed in slice [1/10] (#265) so the
  // wizard shell could land independently of `api.lib.onboarding.crm
  // .getProspect`; #267 swaps it in.
  //
  // Tenant is now LIVE (F-WIZARD [6/10] #270): step 4's completion gate
  // (`isBrandingComplete` in `wizard.decision.ts`) needs the tenant doc to
  // detect when both `branding.logoUrl` AND `branding.primaryColor` are
  // posed. The wizard runs as KB Admin (chrome-less layout under
  // /pipeline/...), so we use the root `loadTenantForStripe` query — same
  // primitive already reused by `qr/page.tsx` and `parametres/page.tsx`
  // (cf. ADR : « éviter de dupliquer une query tenant root »). Skip the
  // network round-trip when there is no tenantId back-link yet (step 1
  // hasn't run); `useQuery(skip)` returns `undefined`, which
  // `computeWizardState` interprets as « tenant in flight » and parks the
  // cursor on step 2 (the safe non-blocking step).
  //
  // publishedMenu is now LIVE (F-WIZARD [7/10] #271): step 5's completion
  // gate (`step5Complete` in `wizard.decision.ts`) needs to know whether the
  // tenant has EVER published a snapshot. The canonical source is the
  // `publishedMenus` row, but the only surfaces exposed at the read seam
  // today are `hasUnpublishedChanges` (returns `lastPublishedAt: number |
  // null`) and `previewMenu` (returns the projected payload, not the doc).
  // The cheapest reuse is to call `hasUnpublishedChanges` and synthesize a
  // minimal `Doc<"publishedMenus">` shape when `lastPublishedAt !== null`
  // — `computeWizardState` only checks `publishedMenu !== undefined &&
  // publishedMenu !== null` (presence), so a minimally-shaped object
  // satisfies the contract without piggy-backing on the actual snapshot
  // payload (which we don't need at the wizard level).
  //
  // managerInvite is now LIVE (F-WIZARD [9/10] #273): step 7's completion
  // gate (`step7Complete` in `wizard.decision.ts`) needs to know whether a
  // manager invite has ever been emitted for this tenant. The canonical
  // signal is the existence of a `managerInvites` row, regardless of
  // `acceptedAt` — the invite can be accepted before OR after step 8's
  // activation. The hook reads via the new kbAdminQuery
  // `api.lib.admin.managerInvites.getLatestManagerInviteForTenant` (B-AUTH
  // adjacency, slice 9/10 ships the query + this wiring).
  // Skip the network round-trip when there is no tenantId back-link yet
  // (step 1 hasn't run); `useQuery(skip)` returns `undefined`, which
  // `computeWizardState` interprets as « invite in flight » and behaves
  // conservatively (step 7 stays incomplete until the query resolves).
  const prospect = useQuery(
    api.lib.onboarding.crm.getProspect,
    prospectId !== undefined ? { prospectId } : "skip",
  );
  const tenantBackLink = prospect?.tenantId;
  const tenant = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    tenantBackLink !== undefined ? { tenantId: tenantBackLink } : "skip",
  );
  const publicationStatus = useQuery(
    api.lib.menu.publication.hasUnpublishedChanges,
    tenantBackLink !== undefined ? { tenantId: tenantBackLink } : "skip",
  );
  // Tri-state mapping:
  //   - `undefined` (query in flight)              → undefined.
  //   - `lastPublishedAt === null` (never published) → null.
  //   - `lastPublishedAt: number` (snapshot exists)  → synthesized sentinel.
  // The sentinel carries `publishedAt` so future consumers can read the
  // timestamp from the same object; `computeWizardState` itself only checks
  // presence (`publishedMenu !== undefined && publishedMenu !== null`).
  const publishedMenu: Doc<"publishedMenus"> | null | undefined =
    publicationStatus === undefined
      ? undefined
      : publicationStatus.lastPublishedAt === null
        ? null
        : ({
            _id: "synthetic-published-menu" as unknown as Doc<"publishedMenus">["_id"],
            _creationTime: publicationStatus.lastPublishedAt,
            tenantId: tenantBackLink as Id<"tenants">,
            publishedAt: publicationStatus.lastPublishedAt,
            payload: { categories: [] },
          } as unknown as Doc<"publishedMenus">);
  const managerInvite: ManagerInviteDoc | null | undefined = useQuery(
    api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
    tenantBackLink !== undefined ? { tenantId: tenantBackLink } : "skip",
  );

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
