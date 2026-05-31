"use client";

/**
 * F-WIZARD [1/10] (#265) — `/pipeline/[prospectId]/provision/page.tsx`.
 *
 * Thin wiring layer for the provisioning wizard. Mounts the:
 *   - `useSession()` access read (F-SHELL-01)
 *   - `useParams<{ prospectId }>` URL segment read
 *   - `useWizardState(prospectId)` step heuristic + cursor
 *   - `WizardView` view (every render branch is pinned by
 *     `wizard-view.test.tsx` under the lean `node` vitest env).
 *
 * Stub note (mirrors `pipeline/[prospectId]/page.tsx`): NONE of the queries
 * needed by the wizard are live yet in V1. `useWizardState` short-circuits
 * each one to `undefined`. The route itself is wired, the access gate +
 * decide branches still pin correctly (a manager sees the UnauthorizedCard;
 * an admin sees the « Chargement du prospect… » loading shell). When the
 * follow-up wizard slices land the live queries, only the hook's STUB
 * lines change — the rest of the wiring (params, session, view, route,
 * stepper, step forms) does not move.
 *
 * Scope discipline (#265 hard constraint): this file (and its siblings
 * under `apps/admin/src/app/(app)/pipeline/[prospectId]/provision/`) is
 * the SOLE surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useParams } from "next/navigation";

import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useSession } from "@/lib/session";

import { useWizardState } from "./use-wizard-state";
import { WizardView } from "./wizard-view";

export default function ProvisionWizardPage() {
  const session = useSession();
  const params = useParams<{ prospectId: string }>();
  const prospectId = params?.prospectId as unknown as
    | Id<"prospects">
    | undefined;

  const wizard = useWizardState(prospectId);

  return (
    <WizardView
      session={session}
      prospect={wizard.prospect}
      tenant={wizard.tenant}
      publishedMenu={wizard.publishedMenu}
      managerInvite={wizard.managerInvite}
      currentStep={wizard.currentStep}
      onStepChange={wizard.goToStep}
      isStepComplete={wizard.isStepComplete}
      markStep2Skipped={wizard.markStep2Skipped}
    />
  );
}
