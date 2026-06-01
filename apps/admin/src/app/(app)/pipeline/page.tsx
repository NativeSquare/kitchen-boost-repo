"use client";

/**
 * F-PIPELINE-CRM 01 (#216) → F-PIPELINE-CRM 05 (#255) — `/pipeline` Kanban surface.
 *
 * Static Kanban supervision view (no drag-and-drop yet — PIPELINE-06 #221
 * cables that). Composes the 4 `_components/` shells :
 *
 *   - `ProspectSearchBar` — controlled name filter (case + accent insensitive),
 *     applied BEFORE partition so typing « pizz » narrows ALL columns AND
 *     the « Clients actifs » tab simultaneously.
 *   - `KanbanColumn` ×3 — Acquisition / Préparation / Installation, rendered
 *     side by side, scrollable (PRD 70 §3.3 « 3 colonnes visibles »).
 *   - `ActiveClientsTab` — separate tab for prospects in `operationnel`
 *     (PRD 70 §3.3 « onglet séparé Clients actifs, filtré du Kanban »).
 *
 * Wiring layer responsibilities (no business logic here — that's in the
 * pure modules / decision files) :
 *
 *   1. The backend wire (`api.lib.onboarding.crm.listProspects`, exposed via
 *      `kbAdminQuery` — ADR 0010 backend isolation barrier). Returns the
 *      FLAT prospect list; partitioning + search are pure derivations done
 *      front-side (`searchProspectsByName` + `partitionProspectsByPhase`
 *      in `./_lib/prospectFilter`).
 *   2. The UX-layer RBAC gate (shared `UnauthorizedCard` + skip-until-admin
 *      sentinel, mirrors `/monitoring`'s pattern). The real security
 *      boundary is backend (`kbAdminQuery` throws Forbidden); this surface
 *      just turns a Forbidden into a clean refusal card instead of a raw
 *      error boundary (A4 of the canonical E2E checklist).
 *   3. A loading state distinct from the empty state (Convex tri-state
 *      contract — `undefined` (in-flight) | `[]` (resolved, empty) |
 *      `Doc[]` (hydrated)).
 *   4. The tab state (`kanban` | `clients-actifs`). `useState` is sufficient
 *      (no URL persistence in V1 — the operator's flow is « ouvrir
 *      Kanban → drill-down → revenir », not « partager une URL deep-link
 *      sur l'onglet »).
 *
 * The fiche surface (`/pipeline/[prospectId]/page.tsx`) already exists
 * (F-SHELL-10 #233) and is already wired live to `crm.getProspect`. AC of
 * #216 « État loading et état "prospect introuvable" gérés sur la fiche »
 * is therefore already covered there — owned by `prospect-fiche.decision.ts`
 * and pinned by `prospect-fiche-view.test.tsx`.
 *
 * Sidebar gating: the « Pipeline » entry already lives in
 * `ADMIN_SUPERVISION_ITEMS` of `app-sidebar.tsx` (returned only for
 * `kind: "admin-supervision"`, i.e. KB Admin outside `/t/[id]`). A KB
 * Manager gets `manager-operational` which does NOT include `/pipeline`
 * — pinned by `app-sidebar.decision.test.ts`. We do NOT touch the sidebar
 * in this slice.
 *
 * Why under `(app)/pipeline/`, not `(app)/t/[tenantId]/...`?
 * --------------------------------------------------------
 * The supervision space (KB-Admin-global ops) lives directly under
 * `(app)/` (ADR 0014 §5). The `/t/[tenantId]/...` URLs are the
 * OPERATIONAL space, scoped per tenant. The Kanban is a supervision
 * surface — it lists prospects across the whole pipeline regardless of
 * any single tenant — so it lives at `/pipeline`, not `/t/<id>/...`.
 *
 * Scope discipline (#255 hard constraint): this file + the 4 `_components/`
 * + the `_lib/prospectFilter` pure module are the SOLE surfaces touched.
 * Zero touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@packages/backend/convex/_generated/api";

import { UnauthorizedCard } from "@/components/app/unauthorized-card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/session";

import { ActiveClientsTab } from "./_components/active-clients-tab";
import { KanbanColumn } from "./_components/kanban-column";
import { ProspectSearchBar } from "./_components/prospect-search-bar";
import type { ProspectCardSnapshot } from "./_lib/prospectFilter";
import {
  partitionProspectsByPhase,
  searchProspectsByName,
} from "./_lib/prospectFilter";

export default function PipelineKanbanPage() {
  const session = useSession();

  // `listProspects` is exposed via `kbAdminQuery` — Convex throws
  // `FORBIDDEN: kb_admin role required` for any non-root caller. Same
  // hazard as `/monitoring`: if we fired the query unconditionally, a
  // manager landing here would surface a raw Convex error boundary
  // INSTEAD of the canonical `UnauthorizedCard`. Skip the query unless
  // the caller is a resolved root admin.
  const isAdminReady = session.status === "ready" && session.session.isAdmin;
  const prospects = useQuery(
    api.lib.onboarding.crm.listProspects,
    isAdminReady ? {} : "skip",
  );

  // Local UI state — search query + active tab. `useState` is sufficient
  // (no URL persistence in V1 — drop-in additions later if needed).
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"kanban" | "clients-actifs">("kanban");

  // Reference instant for `ProspectCard`'s relative-time rendering.
  // Captured ONCE at mount (lazy init) so the React purity rule
  // (`react-hooks/purity`) isn't tripped by calling `Date.now()` inside
  // the render body. Side-effect: a card's « il y a 3 min » is frozen
  // to mount-time — acceptable for a supervision Kanban that the
  // operator opens, scans, then navigates away from (no second-by-
  // second tick). A future slice can wire a `setInterval` if needed.
  const [referenceNow] = useState(() => Date.now());

  // Pure derivations. Memoised so a re-render from `setQuery` on every
  // keystroke doesn't re-walk the (potentially few-hundred-card) list.
  const buckets = useMemo(() => {
    if (prospects === undefined) return null;
    const narrowed = searchProspectsByName(
      prospects as ReadonlyArray<ProspectCardSnapshot>,
      query,
    );
    return partitionProspectsByPhase(narrowed);
  }, [prospects, query]);

  // 1. Session still resolving → spinner. SessionGuard upstream already
  //    blocks unauthenticated/no-tenant; this branch only fires during
  //    the brief in-flight of getSession itself.
  if (session.status !== "ready") {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // 2. UX-layer auth refusal (the real barrier is backend `kbAdminQuery`).
  //    Same vocabulary as /monitoring + the no-tenant empty state — see
  //    `unauthorized-card.tsx` docblock for the three canonical refusal
  //    sites.
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

  // 3. Convex query still in flight → loading shell distinct from the
  //    empty state (so the user can tell « still loading » from « really
  //    empty »).
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

  // 4. Hydrated. Tabs: « Kanban » (3 colonnes) | « Clients actifs »
  //    (Opérationnel, filtré du Kanban — PRD 70 §3.3).
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <KanbanColumn
                phase="acquisition"
                title="Acquisition"
                prospects={buckets.acquisition}
                now={referenceNow}
              />
              <KanbanColumn
                phase="preparation"
                title="Préparation"
                prospects={buckets.preparation}
                now={referenceNow}
              />
              <KanbanColumn
                phase="installation"
                title="Installation"
                prospects={buckets.installation}
                now={referenceNow}
              />
            </div>
          </TabsContent>

          <TabsContent value="clients-actifs" className="mt-4">
            <ActiveClientsTab
              prospects={buckets.operationnel}
              now={referenceNow}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
