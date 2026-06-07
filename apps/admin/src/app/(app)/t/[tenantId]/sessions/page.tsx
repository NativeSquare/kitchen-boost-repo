"use client";

/**
 * #396 (KB Admin — Page Sessions actives) — Route `/t/[tenantId]/sessions/`.
 *
 * Wiring de la page « Sessions actives par tenant » (PRD 20 §13 « Révocation
 * session distante », PRD 70 — RGPD Article 2 ter du contrat). Mutation
 * backend partagée avec #400 côté native : la sub Convex temps réel du
 * client native détectera la disparition de la `authSessions` row et
 * basculera en écran « Session révoquée ».
 *
 * Pure wiring layer (mirror `parametres/page.tsx`, `menu/page.tsx`) :
 *  - lit `api.lib.auth.sessions.listTenantSessions` via `useTenantQuery`
 *    (front-side `withTenant`, ADR 0014 §4 / #183) ;
 *  - wrap `api.lib.auth.sessions.revokeSession` via `useTenantMutation` ;
 *  - délègue le rendering à `<SessionsView/>` (pure presentational).
 *
 * RBAC — kb_admin only (décision terrain 2026-06-07) :
 *  - Le wrapper backend (`tenantQuery({ allow: [] })` sur
 *    `listTenantSessions` + même chose sur `revokeSession`) est la VRAIE
 *    barrière sécurité (ADR 0010). Cross-tenant fuzz shippé par
 *    `sessions.test.ts`.
 *  - La sidebar (`app-sidebar.tsx::buildOperationalItems`) cache l'entrée
 *    pour un kb_manager — pas d'onglet cliquable qui ouvre un Forbidden.
 *  - Ce gate-ci est la défense en profondeur si un kb_manager force l'URL
 *    `/t/<id>/sessions` directement : on rend `<UnauthorizedCard/>` au
 *    lieu de laisser les hooks Convex flasher un toast Forbidden (mirror
 *    du pattern `/pipeline/page.tsx:120-133`).
 *
 * Scope discipline : ce fichier (et ses siblings sous `t/[tenantId]/sessions/`)
 * est la seule surface front touchée par cette story côté `apps/admin`. Zéro
 * touche à `apps/web` / `apps/native`. La mutation backend est aussi consommée
 * par `apps/native` via le path Convex `api.lib.auth.sessions.revokeSession` —
 * mais ça reste #400, pas cette story.
 */

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { toast } from "sonner";
import { useParams } from "next/navigation";

import { api } from "@packages/backend/convex/_generated/api";

import { UnauthorizedCard } from "@/components/app/unauthorized-card";
import { Spinner } from "@/components/ui/spinner";
import { useTenantMutation, useTenantQuery } from "@/hooks";
import { useSession } from "@/lib/session";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { SessionsView } from "./sessions-view";

export default function SessionsPage() {
  const session = useSession();
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId as unknown as Id<"tenants">;

  // RBAC gate — kb_admin only (cf. docblock). Skip les hooks Convex
  // quand non-admin (`"skip"`) pour éviter un flash de toast Forbidden
  // au premier render — mirror exact du pattern `/pipeline/page.tsx`.
  const isAdminReady = session.status === "ready" && session.session.isAdmin;

  const sessions = useTenantQuery(
    api.lib.auth.sessions.listTenantSessions,
    isAdminReady ? undefined : "skip",
  );

  // `useTenantMutation` wrap — never a raw `useMutation` sur une
  // tenantMutation (bypasse l'injection de tenantId — ADR 0014 §4).
  const revokeSession = useTenantMutation(api.lib.auth.sessions.revokeSession);

  /**
   * Handler appelé depuis la `<SessionsView/>` après le 2-step confirm. Re-
   * throw pour que la view puisse fermer / rester ouverte selon l'issue (le
   * dialog laisse l'utilisateur retry après un échec).
   */
  const onRevokeSession = async (
    sessionId: Id<"authSessions">,
  ): Promise<void> => {
    try {
      await revokeSession({ sessionId });
      toast.success("Session révoquée.");
    } catch (error) {
      toast.error("Impossible de révoquer la session", {
        description: getConvexErrorMessage(error),
      });
      // Re-throw — la view garde le dialog ouvert + on logge en console pour
      // le debug local.
      throw error;
    }
  };

  // Spinner pendant que la session se résout — évite un flash
  // `<UnauthorizedCard/>` qui disparaît dès que `session.status === "ready"`.
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
            La gestion des sessions actives est réservée à l&apos;équipe
            KitchenBoost. Si tu as besoin de révoquer une session (vol, perte,
            employé licencié), contacte le support.
          </>
        }
        primaryAction={{
          label: "Retour au tableau de bord",
          href: `/t/${tenantId as unknown as string}`,
        }}
      />
    );
  }

  return (
    <SessionsView
      sessions={sessions}
      onRevokeSession={onRevokeSession}
      // V1 : le `currentSessionId` du caller n'est pas exposé par
      // `getSession` (out of scope #396). La view dégrade gracieusement
      // quand currentSessionId === undefined (pas de marker « cette
      // session »). Le marker passera live le jour où `getSession` ou un
      // probe `whoAmISession` renverra le sessionId du caller.
      currentSessionId={undefined}
    />
  );
}
