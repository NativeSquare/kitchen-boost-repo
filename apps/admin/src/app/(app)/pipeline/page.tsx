"use client";

/**
 * F-PIPELINE-CRM 01 (#216) → F-PIPELINE-CRM 05 (#255) → F-PIPELINE-CRM 06
 * (#262) — `/pipeline` Kanban surface.
 *
 * Composes :
 *
 *   - `ProspectSearchBar` — controlled name filter (case + accent
 *     insensitive), applied BEFORE partition so typing « pizz » narrows ALL
 *     columns AND the « Clients actifs » tab simultaneously.
 *   - `KanbanColumn` ×3 — Acquisition / Préparation / Installation. Each
 *     column is a `@dnd-kit/core` droppable (#262); cards inside are
 *     draggable.
 *   - `ActiveClientsTab` — separate tab for prospects in `operationnel`
 *     (PRD 70 §3.3 « onglet séparé Clients actifs, filtré du Kanban »).
 *
 * F-PIPELINE-CRM 06 (#262) — drag-and-drop wiring
 * -----------------------------------------------
 * `<DndContext sensors={sensors} onDragEnd={onDragEnd}>` wraps the Kanban
 * tab. The wiring lives in `useKanbanDnd` (sensors + Convex `changePhase`
 * mutation + pending-bypass state) and `useAutoBasculeToast` (toast on
 * Acquisition → Préparation auto-bascule detected via snapshot diff).
 * Decision logic stays pure (`decideKanbanDnDEnd`, `detectAutoBascule`).
 *
 * Drop policy (epic « Drag UX décidé », 2026-05-27, pinned by issue #262):
 *  - Drag forward CLEAN  → silent commit (mutation fired directly).
 *  - Drag forward BYPASS → opens `BypassConfirmDialog`; confirm fires
 *    the mutation (backend re-computes the gate and logs the
 *    `prospect.changePhase.bypass` audit row); cancel does nothing.
 *  - Drag backward       → silent commit (correction, gates ignored).
 *  - Drag noop           → ignored.
 *
 * Scope discipline (#262 hard constraint): this file + the 4 `_components/`
 * + the `_lib/*` modules are the SOLE surfaces touched. Zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@packages/backend/convex/_generated/api";

import { UnauthorizedCard } from "@/components/app/unauthorized-card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/session";

import { ActiveClientsTab } from "./_components/active-clients-tab";
import { BypassConfirmDialog } from "./_components/bypass-confirm-dialog";
import { DroppableKanbanColumn } from "./_components/droppable-kanban-column";
import { ProspectCard } from "./_components/prospect-card";
import { ProspectSearchBar } from "./_components/prospect-search-bar";
import type { ProspectCardSnapshot } from "./_lib/prospectFilter";
import {
  partitionProspectsByPhase,
  searchProspectsByName,
} from "./_lib/prospectFilter";
import type { ProspectPhaseSnapshot } from "./_lib/autoBasculeNotifier";
import type { DnDProspectSnapshot } from "./_lib/decideKanbanDnDEnd";
import { useAutoBasculeToast } from "./_lib/useAutoBasculeToast";
import { useKanbanDnd } from "./_lib/useKanbanDnd";

export default function PipelineKanbanPage() {
  const session = useSession();

  // `listProspects` is exposed via `kbAdminQuery` — Convex throws
  // `FORBIDDEN: kb_admin role required` for any non-root caller. Skip the
  // query unless the caller is a resolved root admin (same hazard as
  // `/monitoring`).
  const isAdminReady = session.status === "ready" && session.session.isAdmin;
  const prospects = useQuery(
    api.lib.onboarding.crm.listProspects,
    isAdminReady ? {} : "skip",
  );

  // F-PIPELINE-CRM 06 (#262) — auto-bascule toast. Hook is safe to call
  // unconditionally — it short-circuits on `undefined`. Fires a toast for
  // each prospect that just transitioned acquisition → preparation in the
  // latest Convex push (auto-bascule via `maybeAutoBascule` on the fiche).
  // The Doc shape carries everything `detectAutoBascule` needs (`_id`,
  // `name`, `phase`) — narrow snapshot is structurally assignable.
  useAutoBasculeToast(
    prospects as ReadonlyArray<ProspectPhaseSnapshot> | undefined,
  );

  // DnD wiring. Pass the full list (not the narrowed/partitioned one) so
  // the orchestration always resolves the dragged prospect against the
  // canonical snapshot (a search-narrowed list could miss the prospect
  // mid-drag). The Doc shape carries `milestones` + `tabletteMode` + `phase`
  // — structurally assignable to `DnDProspectSnapshot`.
  const dnd = useKanbanDnd(
    (prospects as ReadonlyArray<DnDProspectSnapshot> | undefined) ?? [],
  );

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"kanban" | "clients-actifs">("kanban");

  // Reference instant for `ProspectCard`'s relative-time rendering.
  const [referenceNow] = useState(() => Date.now());

  const buckets = useMemo(() => {
    if (prospects === undefined) return null;
    const narrowed = searchProspectsByName(
      prospects as ReadonlyArray<ProspectCardSnapshot>,
      query,
    );
    return partitionProspectsByPhase(narrowed);
  }, [prospects, query]);

  if (session.status !== "ready") {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!session.session.isAdmin) {
    return (
      <UnauthorizedCard
        description={
          <>
            La supervision du pipeline est réservée à l&apos;équipe
            KitchenBoost. Si vous pensez que c&apos;est une erreur, contactez le
            support.
          </>
        }
        primaryAction={{ label: "Retour au dashboard", href: "/" }}
      />
    );
  }

  if (prospects === undefined || buckets === null) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-muted-foreground text-sm">
            Chargement des prospects…
          </p>
        </div>
      </div>
    );
  }

  const totalNarrowed =
    buckets.acquisition.length +
    buckets.preparation.length +
    buckets.installation.length +
    buckets.operationnel.length;

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <p className="text-muted-foreground text-sm">
          {totalNarrowed} prospect{totalNarrowed === 1 ? "" : "s"}
          {query.trim().length > 0 ? " (filtré)" : ""}
        </p>
      </div>

      <div className="px-4 lg:px-6">
        <ProspectSearchBar value={query} onChange={setQuery} />
      </div>

      <div className="px-4 lg:px-6">
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as "kanban" | "clients-actifs")}
        >
          <TabsList>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="clients-actifs">
              Clients actifs ({buckets.operationnel.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="kanban" className="mt-4">
            <DndContext
              sensors={dnd.sensors}
              onDragStart={dnd.onDragStart}
              onDragEnd={dnd.onDragEnd}
              onDragCancel={dnd.onDragCancel}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <DroppableKanbanColumn
                  phase="acquisition"
                  title="Acquisition"
                  prospects={buckets.acquisition}
                  now={referenceNow}
                />
                <DroppableKanbanColumn
                  phase="preparation"
                  title="Préparation"
                  prospects={buckets.preparation}
                  now={referenceNow}
                />
                <DroppableKanbanColumn
                  phase="installation"
                  title="Installation"
                  prospects={buckets.installation}
                  now={referenceNow}
                />
              </div>
              {/*
                T17 fix (2026-06-01) — `<DragOverlay>` portal-renders the
                active card clone at the cursor (`position: fixed`,
                outside the columns' `overflow-y-auto` clip), so the
                preview actually follows the mouse instead of being
                anchored to the source slot. Rendered as a SIBLING of
                the columns grid INSIDE `<DndContext>` (dnd-kit hard
                requirement: the overlay reads the active drag context).
              */}
              <DragOverlay dropAnimation={null}>
                {dnd.activeId
                  ? (() => {
                      const active = (
                        prospects as ReadonlyArray<ProspectCardSnapshot>
                      ).find((p) => (p._id as string) === dnd.activeId);
                      return active ? (
                        <div className="cursor-grabbing">
                          <ProspectCard prospect={active} now={referenceNow} />
                        </div>
                      ) : null;
                    })()
                  : null}
              </DragOverlay>
            </DndContext>
          </TabsContent>

          <TabsContent value="clients-actifs" className="mt-4">
            <ActiveClientsTab
              prospects={buckets.operationnel}
              now={referenceNow}
            />
          </TabsContent>
        </Tabs>
      </div>

      <BypassConfirmDialog
        open={dnd.dialog.open}
        missing={dnd.dialog.missing}
        onConfirm={dnd.dialog.onConfirm}
        onCancel={dnd.dialog.onCancel}
      />
    </div>
  );
}
