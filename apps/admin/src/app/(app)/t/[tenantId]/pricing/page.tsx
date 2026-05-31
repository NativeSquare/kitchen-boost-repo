"use client";

/**
 * F-PRICING-1 (#241) + F-PRICING-2 (#245) + F-PRICING-3 (#248) — Route
 * `/t/[tenantId]/pricing`.
 *
 * Slice 1 (#241) wired the read-only list via `useTenantQuery`. Slice 2 (#245)
 * layered CREATE on top: a « + Nouvelle règle » CTA on the list opens the
 * `RuleBuilderModal`; on submit the page calls
 * `useTenantMutation(api.lib.pricing.rules.create)` (which auto-injects
 * `tenantId` from `<TenantProvider/>`, ADR 0014 §4 / #183).
 *
 * Slice 3 (#248) — F-PRICING-3 — adds EDIT by REUSING the same modal:
 *   - The list-row « Éditer » button is now wired via `onEditRule(rule)` on
 *     `PricingView`, which stores the rule in local state (`editingRule`).
 *   - When `editingRule` is set, the modal is mounted in EDIT mode by passing
 *     `existingRule={editingRule}`. The modal's `useState` initialiser
 *     hydrates conditions + action from the persisted row (no duplicated
 *     component, no separate form — issue body « Pas de duplication »).
 *   - The submit handler branches: if `editingRule` is set, calls
 *     `update({ ruleId: editingRule._id, conditions, action })`; otherwise
 *     `create({ conditions, action })`. Same `CONTRADICTORY_CONDITIONS` /
 *     `ConvexError` error UX in both modes — the inline `submitError` prop
 *     surfaces the server-rédigé FR message; no toast.
 *   - The modal is keyed on `editingRule?._id ?? "create"` so switching from
 *     create to edit (or from one rule to another) RE-MOUNTS the form and
 *     re-runs the `useState` initialiser with the new prefill. Without the
 *     key, React would keep the previous form's state and the prefill would
 *     silently no-op.
 *
 * Error discipline (issue body « Pas de toast technique. »):
 *   - The mutation throws a typed `ConvexError` whose `data.code` is
 *     `CONTRADICTORY_CONDITIONS` when the rule's bounds are unsatisfiable.
 *     We catch, branch on the code, and surface `data.message` INLINE inside
 *     the modal via its `submitError` prop. The modal stays open so the
 *     gérant can correct without re-typing. Identical for create AND update.
 *   - Any OTHER error (network, NOT_FOUND, schema mismatch) also flows
 *     through `submitError` — the modal is the single error surface.
 *   - On success: clear `submitError` AND close the modal. The list refresh
 *     happens via Convex reactivity (no manual refetch).
 *
 * No `evaluate` import either: the engine is backend-only (ADR 0013) and the
 * list page never needs to compute a price. All three bans (no raw
 * `useQuery` / `useMutation`, no `evaluate` import, no dnd-kit) are pinned
 * by `page.test.ts` + `guardrails.test.ts`.
 *
 * Scope discipline (#241/#245/#248 hard constraint): this file (and its
 * siblings under `apps/admin/src/app/(app)/t/[tenantId]/pricing/`) is the
 * ONLY surface touched by this story. Zero touch to `apps/web`, `apps/native`,
 * or `packages/backend/convex/`.
 */

import { useState } from "react";
import { ConvexError } from "convex/values";

import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

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
  // F-PRICING-3 (#248) — update binding. Same auto-tenantId discipline;
  // takes a `ruleId` from the rule being edited.
  const updateRule = useTenantMutation(api.lib.pricing.rules.update);
  // F-PRICING-4 (#249) — setActive binding. The toggle on each row flips
  // `active` WITHOUT touching `conditions` / `action` (the rule's definition
  // stays intact across activate / deactivate cycles — « pas un delete
  // déguisé », issue body). Auto-injected `tenantId` (ADR 0014 §4 / #183,
  // ADR 0010); the wrapper gate on `tenantMutation` enforces `kb_manager`
  // (or `kb_admin` via the root override).
  const setRuleActive = useTenantMutation(api.lib.pricing.rules.setActive);

  // Modal lifecycle + inline error state (NOT a toast — issue body).
  const [modalOpen, setModalOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // F-PRICING-3 (#248) — when non-null, the modal opens in EDIT mode with
  // this rule pre-filled. Null = CREATE mode.
  const [editingRule, setEditingRule] = useState<Doc<"pricingRules"> | null>(
    null,
  );

  const handleOpenBuilder = () => {
    setSubmitError(null);
    setEditingRule(null);
    setModalOpen(true);
  };

  // F-PRICING-3 (#248) — row « Éditer » handler. We clear any stale error
  // from a previous attempt, stash the rule, then open the modal. The modal
  // is keyed on `editingRule?._id ?? "create"` so React re-mounts it with the
  // new initial state.
  const handleEditRule = (rule: Doc<"pricingRules">) => {
    setSubmitError(null);
    setEditingRule(rule);
    setModalOpen(true);
  };

  // F-PRICING-4 (#249) — row toggle handler. Bridges
  // `PricingView`'s `onToggleActive(ruleId, active)` to the backend
  // `setActive` mutation. Fire-and-forget at the page level: Convex
  // reactivity drives the list re-render, so flipping the toggle is the only
  // user-visible action. No optimistic update at V1 (issue body : « L'état UI
  // suit la réactivité Convex (pas d'optimistic update obligatoire V1) »).
  // Errors are swallowed silently for V1 — there's no inline error surface
  // here (vs the modal's `submitError`), and a toast is forbidden by the
  // module's discipline (« Pas de toast technique. »). A future slice can
  // surface failures via the row itself if the gérant complains; the
  // backend tenancy seam already guards against foreign / missing ruleIds
  // (`requireTenantPricingRule` → NOT_FOUND), so the worst case is a no-op,
  // not a cross-tenant leak.
  const handleToggleActive = (ruleId: Id<"pricingRules">, active: boolean) => {
    void setRuleActive({ ruleId, active });
  };

  const handleCloseBuilder = (open: boolean) => {
    setModalOpen(open);
    if (!open) {
      // Reset the error on close so a fresh open doesn't carry over the
      // previous attempt's message (it would be lying — the new form may
      // not be contradictory at all). Also drop the editingRule so the
      // NEXT « + Nouvelle règle » click opens in CREATE mode.
      setSubmitError(null);
      setEditingRule(null);
    }
  };

  const handleSubmitBuilder = async (payload: RuleBuilderSubmitPayload) => {
    try {
      if (editingRule !== null) {
        // EDIT path — same payload shape, with the persisted `ruleId`.
        await updateRule({
          ruleId: editingRule._id,
          conditions: payload.conditions,
          action: payload.action,
        });
      } else {
        // CREATE path — no ruleId, the backend allocates it.
        await createRule({
          conditions: payload.conditions,
          action: payload.action,
        });
      }
      // Success: clear the error AND close the modal. The list will
      // re-render via Convex reactivity.
      setSubmitError(null);
      setModalOpen(false);
      setEditingRule(null);
    } catch (error) {
      // The backend rule contract throws `ConvexError({ code, message })`.
      // For `CONTRADICTORY_CONDITIONS` (and any other coded error) we use
      // the server-rédigé FR message verbatim — that's the « zone d'erreur
      // inline » contract. Identical for create AND update.
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
      <PricingView
        rules={rules}
        onNewRule={handleOpenBuilder}
        onEditRule={handleEditRule}
        onToggleActive={handleToggleActive}
      />
      <RuleBuilderModal
        // KEY discipline — re-mount when the target rule changes (or when
        // flipping create ↔ edit) so the form's `useState` initialiser
        // re-runs with the new prefill. Without this key, React would keep
        // the previous form state across opens and the edit prefill would
        // be silently lost.
        key={editingRule?._id ?? "create"}
        open={modalOpen}
        onOpenChange={handleCloseBuilder}
        onSubmit={handleSubmitBuilder}
        submitError={submitError}
        existingRule={editingRule ?? undefined}
      />
    </>
  );
}
