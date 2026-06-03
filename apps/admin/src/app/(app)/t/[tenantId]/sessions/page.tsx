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
 * Access guard (cross-tenant) : hérité de la layout parente
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175). Le wrapper backend
 * (`tenantQuery({ allow: ["kb_manager"] })` sur `listTenantSessions`) reste la
 * vraie barrière (ADR 0010 — refuse Forbidden même si le shell régresse,
 * cross-tenant fuzz shipé par `sessions.test.ts`).
 *
 * Scope discipline : ce fichier (et ses siblings sous `t/[tenantId]/sessions/`)
 * est la seule surface front touchée par cette story côté `apps/admin`. Zéro
 * touche à `apps/web` / `apps/native`. La mutation backend est aussi consommée
 * par `apps/native` via le path Convex `api.lib.auth.sessions.revokeSession` —
 * mais ça reste #400, pas cette story.
 */

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";

import { useTenantMutation, useTenantQuery } from "@/hooks";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { SessionsView } from "./sessions-view";

export default function SessionsPage() {
  // `useTenantQuery` injecte `tenantId` depuis le `<TenantProvider/>` mounted
  // by `(app)/t/[tenantId]/layout.tsx` (ADR 0014 §4). Convex sentinel :
  // `undefined` = chargement, `SessionRow[]` = résolu.
  const sessions = useTenantQuery(api.lib.auth.sessions.listTenantSessions);

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
