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

import { useParams } from "next/navigation";

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
  // Read — but DO NOT use — the prospectId yet. The stubbed `prospect`
  // below is `undefined` regardless. When `api.prospects.get` lands, the
  // shape becomes:
  //   const isAdminReady = session.status === "ready" && session.session.isAdmin;
  //   const prospect = useQuery(
  //     api.prospects.get,
  //     isAdminReady && params?.prospectId
  //       ? { prospectId: params.prospectId as unknown as Id<"prospects"> }
  //       : "skip",
  //   );
  // Until then, we keep the param read so a future grep / refactor doesn't
  // miss the wiring slot.
  void params?.prospectId;

  // STUB until F-PIPELINE-CRM lands `api.prospects.get` (issue #233 explicit
  // allowance). The view's decision treats `undefined` as Convex in-flight,
  // which is the correct UX while the backend isn't ready.
  const prospect = undefined;
  // STUB until F-PIPELINE-CRM lands the admin-side `api.tenants.get`
  // lookup. The fiche plumbs `tenant` through to
  // `ProvisionLauncherButton` (F-WIZARD [2/10] #266), which stays on
  // `launch` / `resume` until the live query reports a hydrated tenant
  // (`view-tenant` lights up automatically when `status === "active"`).
  const tenant = undefined;

  return (
    <ProspectFicheView session={session} prospect={prospect} tenant={tenant} />
  );
}
