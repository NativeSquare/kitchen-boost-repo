"use client";

/**
 * F-PIPELINE-CRM 01 (#216) — `/pipeline` Kanban surface scaffold (V1 dump).
 *
 * First tracer-bullet of EPIC F-PIPELINE-CRM (#144). At this slice the
 * Kanban is intentionally a **placeholder dump** of the prospects list —
 * NO columns, NO drag-and-drop, NO search bar yet (those land in later
 * slices of #144). The job here is to **POSE THE ROUTE** with:
 *
 *   1. The right backend wire (`api.lib.onboarding.crm.listProspects`,
 *      exposed via `kbAdminQuery` — ADR 0010 backend isolation barrier).
 *   2. The right UX-layer RBAC gate (shared `UnauthorizedCard` + skip-
 *      until-admin sentinel, mirrors `/monitoring`'s pattern). The real
 *      security boundary is backend; this surface just turns a Forbidden
 *      into a clean refusal card instead of a raw error boundary
 *      (A4 of the canonical E2E checklist).
 *   3. A loading state distinct from the empty state (Convex tri-state
 *      contract — `undefined` (in-flight) | `[]` (resolved, empty) |
 *      `Doc[]` (hydrated)).
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
 * — that part of #216 AC is already shipped + pinned by
 * `app-sidebar.decision.test.ts`. We do NOT touch the sidebar in this
 * slice.
 *
 * Why under `(app)/pipeline/`, not `(app)/t/[tenantId]/...`?
 * --------------------------------------------------------
 * The supervision space (KB-Admin-global ops) lives directly under
 * `(app)/` (ADR 0014 §5). The `/t/[tenantId]/...` URLs are the
 * OPERATIONAL space, scoped per tenant. The Kanban is a supervision
 * surface — it lists prospects across the whole pipeline regardless of
 * any single tenant — so it lives at `/pipeline`, not `/t/<id>/...`.
 *
 * Scope discipline (#216 hard constraint): this file is the SOLE
 * NEW surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import Link from "next/link";
import { useQuery } from "convex/react";

import { api } from "@packages/backend/convex/_generated/api";

import { UnauthorizedCard } from "@/components/app/unauthorized-card";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/lib/session";

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
  if (prospects === undefined) {
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

  // 4. Hydrated. V1 dump (issue #216 « What to build »): just a flat list
  //    of prospects. Columns + DnD + search arrive in later slices of
  //    EPIC F-PIPELINE-CRM (#144). Each row links to the existing fiche
  //    `/pipeline/[prospectId]` so the drill-down is reachable from day
  //    one — that's the whole point of the supervision space.
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <p className="text-muted-foreground text-sm">
          {prospects.length} prospect{prospects.length === 1 ? "" : "s"} —
          Kanban riche (colonnes + drag &amp; drop) livré par F-PIPELINE-CRM.
        </p>
      </div>
      <div className="px-4 lg:px-6">
        {prospects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-muted-foreground text-sm">
              Aucun prospect dans le pipeline pour le moment.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {prospects.map((p) => (
              <li
                key={p._id as unknown as string}
                className="rounded-lg border p-3"
                data-prospect-id={p._id as unknown as string}
                data-phase={p.phase}
              >
                <Link
                  href={`/pipeline/${p._id as unknown as string}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground text-xs uppercase">
                    {p.phase}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
