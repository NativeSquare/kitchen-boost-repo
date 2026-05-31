"use client";

/**
 * F-SHELL-10 (#233) — `/pipeline/[prospectId]` supervision fiche skeleton.
 *
 * Thin wiring layer for the supervision fiche of a [[Prospect]] (ADR 0014
 * §5 + amendement 2026-05-27: la clé est `prospectId`, PAS `tenantId`, car
 * le prospect précède le tenant — le `tenantId` n'est qu'un back-link posé
 * au provisioning).
 *
 * Reads:
 *   - `useSession()` for the access gate (UX-only — the real isolation
 *     barrier is backend `kbAdminQuery`, ADR 0010).
 *   - `useParams<{ prospectId }>()` for the URL segment (kept live even
 *     while the Convex query is stubbed, so when F-PIPELINE-CRM lands
 *     `api.prospects.get` the only change is the `useQuery` call below —
 *     the param is already wired).
 *   - `api.prospects.get` — STUBBED for now. Issue #233 explicitly allows
 *     this: « Si `api.prospects.get` n'est pas mergée, stub côté front pour
 *     permettre le routage. » The page short-circuits the data hydration
 *     to `undefined` (Convex's "in-flight" sentinel). The access gate +
 *     view branches still pin correctly (a manager sees the
 *     UnauthorizedCard; an admin sees the « Chargement du prospect… »
 *     loading shell). When the backend query lands, replace the stub with
 *     the live `useQuery(api.prospects.get, isAdminReady ? { prospectId }
 *     : "skip")` — the rest of the wiring does not move.
 *
 * Delegates rendering to `ProspectFicheView` so the branches stay pinned
 * by `prospect-fiche-view.test.tsx` under the lean `node` vitest env.
 *
 * Mounted under `(app)/layout.tsx` (`SessionLoader` + `SessionGuard`), so
 * by the time this component renders the SessionGuard has already admitted
 * the actor. The `forbidden` branch fires when an admitted-but-non-admin
 * actor (a KB Manager) deep-links a supervision URL — the supervision
 * surfaces are admin-only (ADR 0014 §5).
 *
 * Why under `(app)/pipeline/[prospectId]/`, not `(app)/t/[tenantId]/...` ?
 * --------------------------------------------------------------------
 * The supervision fiche keys on the prospect, not the tenant (ADR 0014
 * amendement 2026-05-27). `/t/[tenantId]/...` is the operational space
 * (post-provisioning), reachable from this fiche via the « Ouvrir la vue
 * resto » CTA when `prospect.tenantId` is set.
 *
 * Scope discipline (#233 hard constraint, mirrors support/page.tsx et
 * monitoring/page.tsx): this file (and its siblings under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/`) is the SOLE surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useSession } from "@/lib/session";

import { ProspectFicheView } from "./prospect-fiche-view";

export default function ProspectFichePage() {
  const session = useSession();
  // The param is read defensively even while the Convex query is stubbed,
  // so the wiring is ready for F-PIPELINE-CRM. The cast mirrors the
  // upstream tenant layout's pattern (`useParams<{ tenantId: string }>`):
  // Next.js' param type is `string | string[]` and we explicitly assume a
  // single-segment dynamic route.
  const params = useParams<{ prospectId: string }>();
  // `params?.prospectId` is consumed live below by the F-CONTRATS query
  // (slice 1/4, #158). When F-PIPELINE-CRM lands `api.prospects.get`, the
  // wiring becomes:
  //   const prospect = useQuery(
  //     api.prospects.get,
  //     isAdminReady && params?.prospectId
  //       ? { prospectId: params.prospectId as unknown as Id<"prospects"> }
  //       : "skip",
  //   );
  // The contracts query already follows that shape — replace the prospect
  // stub the same way and the rest of the wiring does not move.

  // F-CONTRATS slice 1/4 (#158) — read the prospect's contracts list via
  // `api.lib.admin.contracts.listContractsForProspect` (exposed by
  // `kbAdminQuery`, ADR 0010). Like `/monitoring`'s `previewIncidents`, we
  // SKIP the query until the session resolves as a root admin: a manager
  // landing here would otherwise surface a raw Convex « FORBIDDEN » error
  // boundary INSTEAD of the canonical `UnauthorizedCard` (the view's
  // `decideProspectFiche` short-circuits to `forbidden` before any data
  // is rendered — A4 of the manual E2E checklist).
  const isAdminReady = session.status === "ready" && session.session.isAdmin;

  // Prospect is now LIVE (F-CONTRATS slice 3/4 #174 — the modal needs the
  // juridical fields to pre-fill the « Générer contrat » recap). The hook
  // is gated on a ready root admin actor + a present URL segment, mirroring
  // the contracts query below. The slice [1/10] (#265) wizard hook already
  // depends on this exact root-only kbAdminQuery
  // (`api.lib.onboarding.crm.getProspect`); this page now consumes it
  // directly so the launcher can derive a partner payload without an extra
  // sub-query.
  const prospect = useQuery(
    api.lib.onboarding.crm.getProspect,
    isAdminReady && params?.prospectId
      ? {
          prospectId: params.prospectId as unknown as Id<"prospects">,
        }
      : "skip",
  );
  // STUB until F-PIPELINE-CRM lands the admin-side `api.tenants.get`
  // lookup. The fiche plumbs `tenant` through to
  // `ProvisionLauncherButton` (F-WIZARD [2/10] #266), which stays on
  // `launch` / `resume` until the live query reports a hydrated tenant
  // (`view-tenant` lights up automatically when `status === "active"`).
  const tenant = undefined;

  const contracts = useQuery(
    api.lib.admin.contracts.listContractsForProspect,
    isAdminReady && params?.prospectId
      ? {
          prospectId: params.prospectId as unknown as Id<"prospects">,
        }
      : "skip",
  );

  // F-CONTRATS slice 3/4 (#174) + slice 4/4 (#185) — the page owns the
  // « currently previewed contract id this session ». Two events flip
  // this state to a fresh id :
  //   1. Slice 3/4 — the `GenerateContractLauncher` (mounted inside the
  //      `ContractsBlock` header by `ProspectFicheView`) calls
  //      `onGenerated(newId)` after a successful mutation; the iframe
  //      below the block re-renders with the freshly-generated HTML.
  //   2. Slice 4/4 — a click on a row of the contracts list calls
  //      `onSelectContract(rowId)`; the iframe re-renders with that
  //      contract's HTML (loop closed : the operator can re-read any
  //      version after generating multiple).
  // Both events share the SAME `useQuery(getContract, { contractId })`
  // (no new backend dependency — AC «pas de nouvelle dépendance
  // backend» of slice 4/4). The id is reset only on full page reload.
  const [selectedContractId, setSelectedContractId] =
    useState<Id<"contracts"> | null>(null);
  const selectedContract = useQuery(
    api.lib.admin.contracts.getContract,
    isAdminReady && selectedContractId !== null
      ? { contractId: selectedContractId }
      : "skip",
  );
  // The view's `generatedContractHtml` prop is tri-state:
  //   - `undefined` → no contract id selected yet (no iframe rendered at all)
  //   - `null`       → contract row resolved-but-no-html (iframe's
  //                    error branch surfaces a clear message)
  //   - `string`     → hydrated HTML (iframe renders the sandboxed
  //                    preview + the « Télécharger HTML » action)
  const generatedContractHtml: string | null | undefined =
    selectedContractId === null
      ? undefined
      : selectedContract === undefined
        ? undefined
        : (selectedContract?.htmlContent ?? null);

  return (
    <ProspectFicheView
      session={session}
      prospect={prospect}
      tenant={tenant}
      contracts={contracts}
      onGenerated={setSelectedContractId}
      generatedContractHtml={generatedContractHtml}
      onSelectContract={setSelectedContractId}
      selectedContractId={selectedContractId}
    />
  );
}
