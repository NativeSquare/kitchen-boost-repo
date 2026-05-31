"use client";

/**
 * F-PRICING-1 (#241) + F-PRICING-2 (#245) — Route `/t/[tenantId]/pricing`.
 *
 * Slice 1 (#241) wired the read-only list via `useTenantQuery`. Slice 2 (#245)
 * layers CREATE on top: a « + Nouvelle règle » CTA on the list opens the
 * `RuleBuilderModal`; on submit the page calls
 * `useTenantMutation(api.lib.pricing.rules.create)` (which auto-injects
 * `tenantId` from `<TenantProvider/>`, ADR 0014 §4 / #183).
 *
 * Error discipline (issue body « Pas de toast technique. »):
 *   - The mutation throws a typed `ConvexError` whose `data.code` is
 *     `CONTRADICTORY_CONDITIONS` when the rule's bounds are unsatisfiable.
 *     We catch, branch on the code, and surface `data.message` INLINE inside
 *     the modal via its `submitError` prop. The modal stays open so the
 *     gérant can correct without re-typing.
 *   - Any OTHER error (network, NOT_FOUND, schema mismatch) also flows
 *     through `submitError` — the modal is the single error surface for the
 *     create path. We deliberately do NOT use `toast.error` here (departure
 *     from F-MENU-05's discipline, explicit issue requirement).
 *   - On success: clear `submitError` AND close the modal. The list refresh
 *     happens via Convex reactivity (no manual refetch).
 *
 * No `evaluate` import either: the engine is backend-only (ADR 0013) and the
 * list page never needs to compute a price. All three bans (no raw
 * `useQuery` / `useMutation`, no `evaluate` import, no dnd-kit) are pinned
 * by `page.test.ts` + `guardrails.test.ts`.
 *
 * Scope discipline (#241/#245 hard constraint): this file (and its siblings
 * under `apps/admin/src/app/(app)/t/[tenantId]/pricing/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { useState } from "react";
import { ConvexError } from "convex/values";

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantMutation, useTenantQuery } from "@/hooks";

import { PricingView } from "./pricing-view";
import {
  RuleBuilderModal,
  type RuleBuilderSubmitPayload,
} from "./rule-builder-modal";

export default function PricingPage() {
  const rules = useTenantQuery(api.lib.pricing.rules.list);
  // F-PRICING-2 (#245) — create binding. `useTenantMutation` injects
  // `tenantId` automatically (ADR 0014 §4 / #183, ADR 0010); the wrapper
  // gate on `tenantMutation` enforces a `kb_manager` (or `kb_admin` via
  // root override).
  const createRule = useTenantMutation(api.lib.pricing.rules.create);

  // Modal lifecycle + inline error state (NOT a toast — issue body).
  const [modalOpen, setModalOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleOpenBuilder = () => {
    setSubmitError(null);
    setModalOpen(true);
  };

  const handleCloseBuilder = (open: boolean) => {
    setModalOpen(open);
    if (!open) {
      // Reset the error on close so a fresh open doesn't carry over the
      // previous attempt's message (it would be lying — the new form may
      // not be contradictory at all).
      setSubmitError(null);
    }
  };

  const handleSubmitBuilder = async (payload: RuleBuilderSubmitPayload) => {
    try {
      await createRule({
        conditions: payload.conditions,
        action: payload.action,
      });
      // Success: clear the error AND close the modal. The list will
      // re-render via Convex reactivity.
      setSubmitError(null);
      setModalOpen(false);
    } catch (error) {
      // The backend rule contract throws `ConvexError({ code, message })`.
      // For `CONTRADICTORY_CONDITIONS` (and any other coded error) we use
      // the server-rédigé FR message verbatim — that's the « zone d'erreur
      // inline » contract.
      if (error instanceof ConvexError) {
        const data = error.data as { code?: string; message?: string };
        // Defensive default — the backend ALWAYS includes a message, but if
        // a future error skipped it we still surface SOMETHING actionable.
        const message =
          typeof data.message === "string" && data.message.length > 0
            ? data.message
            : data.code === "CONTRADICTORY_CONDITIONS"
              ? "Cette règle contient des conditions contradictoires."
              : "Impossible d'enregistrer la règle.";
        setSubmitError(message);
        return;
      }
      // Non-ConvexError (network, unknown) — surface a generic FR message
      // inline so the gérant knows the save didn't go through. Still no
      // toast.
      setSubmitError("Impossible d'enregistrer la règle. Réessayez.");
    }
  };

  return (
    <>
      <PricingView rules={rules} onNewRule={handleOpenBuilder} />
      <RuleBuilderModal
        open={modalOpen}
        onOpenChange={handleCloseBuilder}
        onSubmit={handleSubmitBuilder}
        submitError={submitError}
      />
    </>
  );
}
