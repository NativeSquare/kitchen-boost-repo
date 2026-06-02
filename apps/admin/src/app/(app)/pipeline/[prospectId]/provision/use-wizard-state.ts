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

import type { SessionState } from "@/lib/session";

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
   * F-WIZARD [4/10] (#268) — flip the local-only « step 2 skipped » flag.
   * Threaded down to `Step2Form`'s Skip button. NEVER round-tripped to the
   * backend (the spec: « skip = mark complete localement, suffit pour la
   * nav »). Once set, `computeWizardState` treats step 2 as complete even
   * without a persisted `tenant.customDomain`.
   */
  markStep2Skipped: () => void;
  /**
   * W4 E2E fix — flip the local-only « step 3 visited » flag. Threaded down
   * to `Step3Form`, which calls it once on mount. Step 3 (Stripe KYC) has
   * no persisted completion signal in V1; visiting the step is the only
   * available « complete » signal so the stepper doesn't pre-tick it ✅
   * before the operator ever opened it. Never round-tripped to the backend.
   */
  markStep3Visited: () => void;
  /**
   * W4 E2E fix — flip the local-only « step 6 visited » flag. Threaded down
   * to `Step6Form`, which calls it once on mount. Step 6 (QR sticker) is
   * front-only (no backend persistence — the operator downloads the SVG/PDF);
   * visiting the step is the only available « complete » signal so the
   * stepper doesn't pre-tick it ✅ before the operator ever opened it.
   * Never round-tripped to the backend.
   */
  markStep6Visited: () => void;
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
  session: SessionState,
): UseWizardStateResult {
  // Issue #392 — RBAC skip guard.
  //
  // EVERY Convex query below is exposed via `kbAdminQuery` (ADR 0010), so
  // calling them from a non-root actor throws `FORBIDDEN: kb_admin role
  // required`. If we fired the queries unconditionally, a KB Manager landing
  // on `/pipeline/<id>/provision` (via URL share, etc.) would surface a raw
  // Convex error boundary INSTEAD of the canonical `UnauthorizedCard` —
  // exactly what `/monitoring/page.tsx` and `/pipeline/<id>/page.tsx` guard
  // against with the same skip-sentinel pattern. Gate every query on a
  // resolved-and-admin session; `WizardView`'s `forbidden` branch then
  // renders the shared refusal card without any network round-trip.
  const isAdminReady = session.status === "ready" && session.session.isAdmin;

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
    isAdminReady && prospectId !== undefined ? { prospectId } : "skip",
  );
  const tenantBackLink = prospect?.tenantId;
  const tenant = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    isAdminReady && tenantBackLink !== undefined
      ? { tenantId: tenantBackLink }
      : "skip",
  );
  const publicationStatus = useQuery(
    api.lib.menu.publication.hasUnpublishedChanges,
    isAdminReady && tenantBackLink !== undefined
      ? { tenantId: tenantBackLink }
      : "skip",
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
    isAdminReady && tenantBackLink !== undefined
      ? { tenantId: tenantBackLink }
      : "skip",
  );

  // Cursor state.
  //
  // The cursor is an EXPLICIT operator-owned position — once seeded from the
  // live state on the first render where it's available, it ONLY changes via
  // `goToStep` (Prev/Next clicks + stepper clicks). We deliberately do NOT
  // track `liveState.currentStep` reactively after the seed: otherwise, when
  // an in-step mutation flips a completion flag (e.g. step 5's `publishMenu`
  // sets `step5Complete = true`), `liveState.currentStep` would jump forward
  // to the next incomplete step and the wizard would auto-advance under the
  // operator's feet WITHOUT them clicking « Continuer » (W7 bug — they never
  // saw the « Publié — [date] » badge nor had the choice to keep editing the
  // current step's surface).
  //
  // Seed-once-in-render pattern (React-supported, cf. « Storing information
  // from previous renders » in React docs): we calling `setCursor(...)` from
  // render is OK because it ALWAYS stabilises after the first valid seed
  // (`liveState !== null` is monotonic once the prospect query resolves) —
  // React detects no further state change and skips the extra render.
  // Using `useEffect(() => setCursor(...))` would force a cascading render
  // AND be flagged by the React Compiler — same rationale that pushed
  // `step2Skipped` / `step3Visited` / `step6Visited` to direct setters
  // (no effect-based mirroring).
  const [cursor, setCursor] = useState<WizardStepNumber | null>(null);

  // F-WIZARD [4/10] (#268) — local-only « step 2 skipped » flag.
  //
  // Owned here (single source) so a re-render of Step2Form doesn't lose
  // it. Never round-tripped to the backend — `Step2Form`'s « Skip » CTA
  // flips it true via `markStep2Skipped`; `computeWizardState` then
  // reports step 2 as complete even without a persisted
  // `tenant.customDomain`. The flag is page-scoped (a fresh page nav
  // resets it to false — desired UX: a reload « forgets » the skip and
  // re-shows step 2 as unticked, which is fine since the skip is
  // cosmetic, not load-bearing).
  const [step2Skipped, setStep2Skipped] = useState<boolean>(false);

  // W4 E2E fix — local-only « visited » flags for the two optional /
  // non-blocking steps (3 Stripe KYC + 6 QR sticker). Same discipline as
  // `step2Skipped`: page-scoped React state, never persisted. Each
  // `Step{3,6}Form` calls the corresponding marker once on mount. Default
  // `false` so the stepper renders steps 3 and 6 as `pending` until the
  // operator actually opens them — fixes the anomaly where the stepper
  // pre-ticked them ✅ the moment a tenant existed.
  const [step3Visited, setStep3Visited] = useState<boolean>(false);
  const [step6Visited, setStep6Visited] = useState<boolean>(false);

  const goToStep = useCallback((n: WizardStepNumber) => {
    if (n < 1 || n > 8) return;
    setCursor(n);
  }, []);

  const markStep2Skipped = useCallback(() => {
    setStep2Skipped(true);
  }, []);

  const markStep3Visited = useCallback(() => {
    setStep3Visited(true);
  }, []);

  const markStep6Visited = useCallback(() => {
    setStep6Visited(true);
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
        step2Skipped,
        step3Visited,
        step6Visited,
      })
    : null;

  // Seed-once: when `liveState` first becomes available AND the cursor has
  // never been set yet, take the live-derived step as the starting point.
  // This is what lets an operator resume on the right step when they reopen
  // the wizard mid-provisioning. After this first seed, the cursor only
  // moves via `goToStep` — see the comment on `cursor` above for why we
  // deliberately do NOT keep tracking `liveState.currentStep`.
  if (cursor === null && liveState !== null) {
    setCursor(liveState.currentStep);
  }

  const currentStep: WizardStepNumber = cursor ?? liveState?.currentStep ?? 1;

  return {
    tenantId: liveState?.tenantId ?? null,
    currentStep,
    isStepComplete: liveState?.isStepComplete ?? (() => false),
    goToStep,
    markStep2Skipped,
    markStep3Visited,
    markStep6Visited,
    prospect,
    tenant,
    publishedMenu,
    managerInvite,
  };
}
