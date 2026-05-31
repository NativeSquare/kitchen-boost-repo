"use client";

/**
 * F-SHELL-10 (#233) — `ProspectFicheView`.
 *
 * Pure presentational shell of the `/pipeline/[prospectId]` supervision
 * route (ADR 0014 §5 + amendement 2026-05-27: la clé est `prospectId`, PAS
 * `tenantId` — le prospect précède le tenant, et le `tenantId` n'est qu'un
 * back-link posé au provisioning).
 *
 * Splitting it out of `page.tsx` (which owns `useSession` / `useQuery` /
 * `useParams` / `useRouter`) lets vitest pin every branch — forbidden,
 * loading, not-found, hydrated with/without tenantId back-link — under the
 * lean `node` env (no jsdom, no Convex test harness), same React-tree-
 * serializer pattern already used by `MonitoringView` /
 * `SupportContent` / `UnauthorizedCard`.
 *
 * Branches (matches the `decideProspectFiche` decision matrix):
 *
 *   - session not ready                                 → spinner.
 *   - `session.isAdmin === false`                       → shared
 *                                                          `UnauthorizedCard`
 *                                                          (« Accès non
 *                                                           autorisé »).
 *   - prospect `undefined` (Convex in-flight)           → loading skeleton.
 *   - prospect `null` (no doc with this id)             → not-found state.
 *   - prospect hydrated                                 → header (nom +
 *                                                          phase badge) +
 *                                                          `ProvisionLauncherButton`
 *                                                          (own visibility
 *                                                          logic) +
 *                                                          placeholder body.
 *
 * The provisioning CTA lives on `ProvisionLauncherButton`
 * (`provision-launcher-button.tsx`, F-WIZARD [2/10] #266): it decides
 * internally whether to render « Lancer le wizard », « Reprendre le
 * wizard », « Ouvrir la vue resto », or nothing — based on the prospect's
 * Closing-completion + the tenant's status (cf. `decideProvisionLauncher`).
 * This file simply hands it the snapshot.
 *
 * Out of scope for this slice (issue #233): the detailed content of the
 * fiche (milestones, intégrations, embed KYC, contrats, monitoring
 * drill-down) lives in EPIC F-PIPELINE-CRM. The placeholder copy below
 * explicitly names that epic so the next reader knows where the body lands.
 *
 * UX layer note (mirrors `MonitoringView`): the `session.isAdmin` check
 * here is UX-only. The real isolation barrier is backend `kbAdminQuery`
 * (ADR 0010) — if a `kb_manager` deep-linked the URL and the query DID
 * fire, Convex would still throw `FORBIDDEN: kb_admin role required`. This
 * surface just turns that into a clean refusal card instead of a raw error
 * boundary (A4 de la checklist E2E manuelle — la vocabulary est partagée
 * via `UnauthorizedCard`).
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { UnauthorizedCard } from "@/components/app/unauthorized-card";
import type { SessionState } from "@/lib/session";

import { decideProspectFiche } from "./prospect-fiche.decision";
import { ProvisionLauncherButton } from "./provision-launcher-button";

export type ProspectFicheViewProps = {
  /** The resolved session (decided by the `(app)` SessionGuard upstream). */
  session: SessionState;
  /**
   * The prospect from `useQuery(api.prospects.get, ...)`, following Convex's
   * tri-state contract: `undefined` (in-flight) | `null` (no such doc) |
   * `Doc<"prospects">` (hydrated). When the page stubs the query (today
   * — `api.prospects.get` lands in F-PIPELINE-CRM), pass `undefined`; the
   * decision short-circuits to `forbidden` for a non-admin caller BEFORE
   * looking at this field, so a stale `undefined` is safe.
   */
  prospect: Doc<"prospects"> | null | undefined;
  /**
   * The tenant doc when `prospect.tenantId` is set (Convex tri-state),
   * plumbed through to `ProvisionLauncherButton` (F-WIZARD [2/10] #266)
   * which decides whether to show the wizard CTA or the « Ouvrir la vue
   * resto » CTA based on `tenant.status === "active"`. STUBBED to
   * `undefined` today (the live `api.tenants.get` for an admin-side lookup
   * lives in F-PIPELINE-CRM scope); the launcher stays on `launch` /
   * `resume` until it lands. Optional so existing callers stay compatible.
   */
  tenant?: Doc<"tenants"> | null | undefined;
};

/**
 * Human-readable label for the canonical pipeline phase (kb-admin CONTEXT
 * « Phase pipeline », acté 2026-05-23). Kept tiny + co-located: the badge
 * lives only here and nowhere else needs to render a phase yet (the rest
 * of the supervision surface lands in F-PIPELINE-CRM).
 */
const PHASE_LABEL: Record<Doc<"prospects">["phase"], string> = {
  acquisition: "Acquisition",
  preparation: "Préparation",
  installation: "Installation",
  operationnel: "Opérationnel",
};

export function ProspectFicheView({
  session,
  prospect,
  tenant,
}: ProspectFicheViewProps) {
  const decision = decideProspectFiche({ session, prospect });

  if (decision.kind === "wait") {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (decision.kind === "forbidden") {
    return (
      <UnauthorizedCard
        description={
          <>
            Cette fiche est réservée à l&apos;équipe KitchenBoost. Si vous
            pensez que c&apos;est une erreur, contactez le support.
          </>
        }
        primaryAction={{ label: "Retour au dashboard", href: "/" }}
      />
    );
  }

  if (decision.kind === "loading-prospect") {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <div className="text-muted-foreground text-sm">
            Chargement du prospect…
          </div>
        </div>
      </div>
    );
  }

  if (decision.kind === "not-found") {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Prospect introuvable</h1>
          <p className="text-muted-foreground text-sm">
            Aucun prospect ne correspond à cet identifiant. Il a peut-être été
            supprimé, ou le lien est invalide.
          </p>
        </div>
      </div>
    );
  }

  // decision.kind === "show"
  const p = decision.prospect;
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-3 px-4 md:flex-row md:items-center md:justify-between lg:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Phase :</span>
            <Badge variant="secondary">{PHASE_LABEL[p.phase]}</Badge>
          </div>
        </div>
        {/* F-WIZARD [2/10] #266 — the launcher owns ALL provisioning-side
         *  CTAs (« Lancer » / « Reprendre » / « Ouvrir la vue resto ») plus
         *  the « email gérant manquant » warning. Its own visibility logic
         *  decides whether to render anything at all (Closing-completion
         *  gate). The fiche just hands it the snapshot. */}
        <ProvisionLauncherButton prospect={p} tenant={tenant} />
      </div>
      <div className="px-4 lg:px-6">
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Contenu détaillé livré par F-PIPELINE-CRM (milestones, intégrations,
            embed KYC, contrats, monitoring drill-down).
          </p>
        </div>
      </div>
    </div>
  );
}
