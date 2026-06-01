"use client";

/**
 * F-PIPELINE-CRM 07 (#256) — `IntegrationStatusPanel` (pure) +
 * `IntegrationStatusPanelConnected` (Convex-wired wrapper).
 *
 * Three sub-panels (Stripe Connect / Uber Direct / Hubrise) surfacing the
 * composite oscillating integration state for a prospect:
 *
 *   - `current` (canonical status badge)
 *   - native `<select>` dropdown listing the valid statuses (the per-provider
 *     enums of `convex/table/prospects.ts`)
 *   - « Mettre à jour » button that fires
 *     `useMutation(api.lib.onboarding.milestones.recordIntegrationStatus)`
 *   - history below the panel, most-recent FIRST (antichronological)
 *
 * Two-layer split (mirrors `milestone-checklist.tsx`):
 *
 *   - `IntegrationStatusPanel` — PURE. No Convex hooks. Required `onUpdate`
 *     callback; vitest passes `vi.fn()`. The React-tree serializer can
 *     expand it directly without a React renderer.
 *
 *   - `IntegrationStatusPanelConnected` — THIN WRAPPER. Calls
 *     `useMutation(api.lib.onboarding.milestones.recordIntegrationStatus)`
 *     and forwards the resulting mutator. Mounted on the fiche.
 *
 * Per-provider dropdown selection is held in a render-local mutable object
 * (NOT `useState`) so the pure shell stays hook-free at the sub-panel
 * level. The « Mettre à jour » button reads the latest selection through
 * that closure. Convex reactivity refreshes the panel on every server-side
 * change.
 *
 * Optimistic update parity: the pure `reduceIntegrationStatus` (PIPELINE-04
 * #220) is imported and invoked inline on submit — kept in the deps for
 * parity with the issue spec («utilise reduceIntegrationStatus pour
 * valider/calculer l'optimistic update si nécessaire»), even though the
 * panel itself does not render the optimistic state today (Convex
 * reactivity refreshes within ms).
 *
 * Scope discipline (#256 hard constraint): lives under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/_components/` only. Zero
 * touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import {
  type IntegrationStatus,
  reduceIntegrationStatus,
} from "../../_lib/integrationStatusReducer";

type Provider = "stripeConnect" | "uberDirect" | "hubrise";

/** The per-provider status literals — mirror of `convex/table/prospects.ts`. */
type StripeConnectStatus =
  | "not_started"
  | "pending_kyc"
  | "verified"
  | "rejected"
  | "disabled";
type UberDirectStatus = "not_started" | "pending_kyc" | "active" | "failed";
type HubriseStatus = "not_configured" | "configured" | "active";

/**
 * The integrations sub-object as seen by this module — mirrors the shape of
 * `prospect.milestones.{stripeConnect,uberDirect,hubrise}` (the composite
 * oscillating milestones). Each entry is OPTIONAL (a fresh prospect has
 * none); the panel synthesises a `not_started`-style default when absent.
 */
export type IntegrationsInput = {
  stripeConnect?: IntegrationStatus<StripeConnectStatus>;
  uberDirect?: IntegrationStatus<UberDirectStatus>;
  hubrise?: IntegrationStatus<HubriseStatus>;
};

/**
 * Canonical metadata table per provider — kept here (not imported from
 * `convex/table/prospects.ts`) because the EPIC F-PIPELINE-CRM scope is
 * `apps/admin/src/app/(app)/pipeline/` STRICT. The truth lives in the
 * backend `*Status` validators; this mirrors them exactly.
 */
const PROVIDER_META: ReadonlyArray<{
  key: Provider;
  label: string;
  statuses: ReadonlyArray<string>;
  defaultStatus: string;
}> = [
  {
    key: "stripeConnect",
    label: "Stripe Connect",
    statuses: [
      "not_started",
      "pending_kyc",
      "verified",
      "rejected",
      "disabled",
    ],
    defaultStatus: "not_started",
  },
  {
    key: "uberDirect",
    label: "Uber Direct",
    statuses: ["not_started", "pending_kyc", "active", "failed"],
    defaultStatus: "not_started",
  },
  {
    key: "hubrise",
    label: "Hubrise",
    statuses: ["not_configured", "configured", "active"],
    defaultStatus: "not_configured",
  },
];

export type IntegrationUpdateFn = (
  prospectId: Id<"prospects">,
  provider: Provider,
  status: string,
) => Promise<unknown> | unknown;

export type IntegrationStatusPanelProps = {
  prospectId: Id<"prospects">;
  integrations: IntegrationsInput;
  /**
   * Required callback fired on « Mettre à jour » click. The connected
   * wrapper wires `api.lib.onboarding.milestones.recordIntegrationStatus`;
   * tests inject a `vi.fn()`.
   */
  onUpdate: IntegrationUpdateFn;
};

/**
 * Tiny FR formatter for the history timestamp — local helper, kept inline
 * because the admin app does not ship date-fns. Format: « 2026-05-31 12:34 »
 * (ISO date + HH:MM) — operator-readable, locale-stable.
 */
function formatHistoryAt(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * PURE shell — no Convex hooks. Renders the 3 sub-panels.
 */
export function IntegrationStatusPanel({
  prospectId,
  integrations,
  onUpdate,
}: IntegrationStatusPanelProps) {
  const update = (provider: Provider, nextStatus: string) => {
    void Promise.resolve(onUpdate(prospectId, provider, nextStatus));
  };

  return (
    <Card data-slot="integration-status-panel">
      <CardHeader>
        <CardTitle>Intégrations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {PROVIDER_META.map((meta) => {
          const sub = integrations[meta.key];
          const current = sub?.current ?? meta.defaultStatus;
          // Render-local mutable selection holder — see module header for
          // rationale. NOT a hook (so the serializer can expand the tree).
          const selection: { value: string } = { value: current };
          const history = sub?.history ?? [];
          // Anti-chronological copy — the schema doesn't guarantee insertion
          // order on `history[]`; re-sort here so the rendered order matches
          // the issue spec («ordre antichronologique»).
          const historySorted = [...history].sort((a, b) => b.at - a.at);
          return (
            <section
              key={meta.key}
              data-slot="integration-subpanel"
              data-provider={meta.key}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{meta.label}</h3>
                <Badge
                  variant="secondary"
                  className={cn(
                    "uppercase",
                    current === "verified" || current === "active"
                      ? "bg-emerald-100 text-emerald-900"
                      : current === "rejected" || current === "failed"
                        ? "bg-red-100 text-red-900"
                        : "bg-gray-100 text-gray-900",
                  )}
                  data-slot="integration-current-badge"
                >
                  {current}
                </Badge>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <select
                  data-slot="integration-select"
                  data-provider={meta.key}
                  defaultValue={current}
                  onChange={(e) => {
                    selection.value = e.target.value;
                  }}
                  aria-label={`Statut ${meta.label}`}
                  className="border-input h-9 rounded-md border bg-background px-2 text-sm"
                >
                  {meta.statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  data-slot="integration-update-button"
                  data-provider={meta.key}
                  onClick={() => {
                    // Optimistic-update validator — kept for issue-spec parity
                    // («valider/calculer l'optimistic update si nécessaire»).
                    if (sub !== undefined) {
                      void reduceIntegrationStatus({
                        prev: sub,
                        next: selection.value as never,
                        now: Date.now(),
                      });
                    }
                    update(meta.key, selection.value);
                  }}
                >
                  Mettre à jour
                </Button>
              </div>
              {historySorted.length > 0 ? (
                <ul className="flex flex-col gap-1 border-t pt-2">
                  {historySorted.map((entry, idx) => (
                    <li
                      key={`${entry.at}-${idx}`}
                      data-slot="integration-history-row"
                      data-at={entry.at}
                      data-status={entry.status}
                      className="text-muted-foreground flex items-center justify-between gap-2 text-xs"
                    >
                      <span>{formatHistoryAt(entry.at)}</span>
                      <span className="font-mono">{entry.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  Aucune transition enregistrée.
                </p>
              )}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

export type IntegrationStatusPanelConnectedProps = Omit<
  IntegrationStatusPanelProps,
  "onUpdate"
>;

/**
 * Convex-wired wrapper — mounted on the fiche. Wires
 * `useMutation(api.lib.onboarding.milestones.recordIntegrationStatus)` and
 * forwards the mutator. Errors surface via `toast.error`.
 */
export function IntegrationStatusPanelConnected(
  props: IntegrationStatusPanelConnectedProps,
) {
  const recordIntegrationStatusMutation = useMutation(
    api.lib.onboarding.milestones.recordIntegrationStatus,
  );

  const handleUpdate: IntegrationUpdateFn = async (
    prospectId,
    provider,
    nextStatus,
  ) => {
    try {
      await recordIntegrationStatusMutation({
        prospectId,
        integration: provider,
        status: nextStatus as Parameters<
          typeof recordIntegrationStatusMutation
        >[0]["status"],
      });
    } catch (error) {
      toast.error(
        `Échec mise à jour intégration : ${getConvexErrorMessage(error)}`,
      );
    }
  };

  return <IntegrationStatusPanel {...props} onUpdate={handleUpdate} />;
}
