"use client";

/**
 * F-PIPELINE-CRM 07 (#256) — `MilestoneChecklist` (pure) +
 * `MilestoneChecklistConnected` (Convex-wired wrapper).
 *
 * Two-layer split (mirrors `generate-contract-modal.tsx` /
 * `generate-contract-launcher.tsx`):
 *
 *   - `MilestoneChecklist` — PURE. No Convex hooks. Receives the milestones
 *     + an `onToggle(prospectId, key, achieved)` callback as props. The
 *     React-tree serializer used by the vitest `node` env can expand it
 *     directly without a React renderer (same constraint as
 *     `ProspectIdentityPanel`).
 *
 *   - `MilestoneChecklistConnected` — THIN WRAPPER. Calls
 *     `useMutation(api.lib.onboarding.milestones.setMilestone)` and forwards
 *     the resulting mutator to the pure shell. Mounted on the fiche
 *     (`prospect-fiche-view.tsx`).
 *
 * Closing-impact badge: each milestone whose `impactsClosing === true` gets
 * `data-impacts-closing="true"` on its row plus a visible « Closing » badge
 * — the operator sees in one glance which checks might trigger the
 * Acquisition → Préparation auto-bascule.
 *
 * Convex reactivity guarantees the fiche re-renders with the new phase +
 * the new milestone state without a manual refetch when the mutation
 * resolves.
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import {
  buildMilestoneChecklist,
  type MilestoneEntry,
  type ProspectMilestonesInput,
  type TabletteModeInput,
} from "../../_lib/milestoneChecklistModel";

/**
 * The 3 phases that own binary milestones (PRD 70 §3.3). Opérationnel has none
 * (`buildMilestoneChecklist` only ever yields entries for these 3).
 */
const PHASE_HEADINGS: ReadonlyArray<{
  key: "acquisition" | "preparation" | "installation";
  label: string;
}> = [
  { key: "acquisition", label: "Acquisition" },
  { key: "preparation", label: "Préparation" },
  { key: "installation", label: "Installation" },
];

/**
 * `setMilestone` mutation signature — the callback shape the pure shell
 * forwards row clicks to. The connected wrapper wires the canonical Convex
 * mutation; tests pass a `vi.fn()` directly.
 */
export type MilestoneToggleFn = (
  prospectId: Id<"prospects">,
  milestoneKey: MilestoneEntry["key"],
  achieved: boolean,
) => Promise<unknown> | unknown;

export type MilestoneChecklistProps = {
  prospectId: Id<"prospects">;
  /** The prospect's binary milestones (timestamp shape — see schema). */
  milestones: ProspectMilestonesInput;
  /** Drives the conditional tablette-invoice milestones (PRD 70 §3.3). */
  tabletteMode: TabletteModeInput;
  /**
   * Required callback fired on row click / checkbox change with the next
   * desired `achieved` state. The connected wrapper wires
   * `api.lib.onboarding.milestones.setMilestone`; tests inject a `vi.fn()`.
   */
  onToggle: MilestoneToggleFn;
};

/**
 * PURE shell — no Convex hooks. Renders the structured checklist returned
 * by `buildMilestoneChecklist` (PIPELINE-03 #218), grouped by phase, with
 * one row per milestone.
 */
export function MilestoneChecklist({
  prospectId,
  milestones,
  tabletteMode,
  onToggle,
}: MilestoneChecklistProps) {
  // Derive the structured checklist via the pure PIPELINE-03 module
  // (`buildMilestoneChecklist` — #218). Same tabletteMode-driven filter as
  // the backend `requiredClosingMilestones`.
  const entries = buildMilestoneChecklist({ milestones, tabletteMode });

  const grouped: Record<
    "acquisition" | "preparation" | "installation",
    MilestoneEntry[]
  > = {
    acquisition: [],
    preparation: [],
    installation: [],
  };
  for (const entry of entries) {
    grouped[entry.phase].push(entry);
  }

  const handleToggle = (entry: MilestoneEntry) => {
    void Promise.resolve(onToggle(prospectId, entry.key, !entry.achieved));
  };

  return (
    <Card data-slot="milestone-checklist">
      <CardHeader>
        <CardTitle>Milestones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {PHASE_HEADINGS.map((phase) => {
          const phaseEntries = grouped[phase.key];
          if (phaseEntries.length === 0) return null;
          return (
            <section
              key={phase.key}
              data-phase={phase.key}
              className="flex flex-col gap-2"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {phase.label}
              </h3>
              <ul className="flex flex-col gap-1">
                {phaseEntries.map((entry) => (
                  <li
                    key={entry.key}
                    data-slot="milestone-row"
                    data-milestone-key={entry.key}
                    data-achieved={entry.achieved}
                    data-impacts-closing={entry.impactsClosing}
                    onClick={() => handleToggle(entry)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:bg-accent/40",
                      entry.impactsClosing && "border-amber-200 bg-amber-50/40",
                    )}
                  >
                    <Checkbox
                      data-slot="milestone-checkbox"
                      data-checked={entry.achieved}
                      checked={entry.achieved}
                      onCheckedChange={() => handleToggle(entry)}
                      aria-label={entry.label}
                    />
                    <span
                      className={cn(
                        "flex-1 text-sm",
                        entry.achieved && "text-muted-foreground line-through",
                      )}
                    >
                      {entry.label}
                    </span>
                    {entry.impactsClosing ? (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-900"
                        data-slot="milestone-closing-badge"
                      >
                        Closing
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

export type MilestoneChecklistConnectedProps = Omit<
  MilestoneChecklistProps,
  "onToggle"
>;

/**
 * Convex-wired wrapper — mounted on the fiche. Wires
 * `useMutation(api.lib.onboarding.milestones.setMilestone)` and forwards
 * the mutator to the pure shell. Errors surface via `toast.error` (same
 * pattern as `generate-contract-launcher.tsx`).
 */
export function MilestoneChecklistConnected(
  props: MilestoneChecklistConnectedProps,
) {
  const setMilestoneMutation = useMutation(
    api.lib.onboarding.milestones.setMilestone,
  );

  const handleToggle: MilestoneToggleFn = async (
    prospectId,
    milestoneKey,
    achieved,
  ) => {
    try {
      await setMilestoneMutation({
        prospectId,
        milestoneKey: milestoneKey as Parameters<
          typeof setMilestoneMutation
        >[0]["milestoneKey"],
        achieved,
      });
    } catch (error) {
      toast.error(
        `Échec mise à jour milestone : ${getConvexErrorMessage(error)}`,
      );
    }
  };

  return <MilestoneChecklist {...props} onToggle={handleToggle} />;
}
