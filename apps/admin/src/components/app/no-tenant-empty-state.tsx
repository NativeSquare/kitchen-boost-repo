"use client";

/**
 * F-SHELL-03 — `NoTenantEmptyState` (issue #169).
 *
 * Shown by `SessionGuard` (#164) when the actor is authenticated but has
 * neither `isAdmin` nor any tenant attached — i.e. the « pro authentifié
 * sans tenant accessible (rattachements détachés, compte en cours de
 * provisioning) » state described in ADR 0014 §3, AND the « customer qui
 * a signé up sans avoir accepté d'invite manager » edge case (couldn't be
 * distinguished from the previous one with today's session shape, so we
 * treat them identically — the result is the same : aucun accès KB).
 *
 * This is NOT a route — it's a state of the shell. The component is pure UI
 * dessus du composant partagé `UnauthorizedCard` (A4 de la checklist E2E
 * manuelle — les 3 surfaces de refus partagent le même vocabulaire « Accès
 * non autorisé »). Le sous-titre reste plus chaleureux (le user PEUT être
 * un manager en cours de provisioning — on garde l'angle « ressayez ou
 * contactez le support » avant de proposer la déconnexion).
 *
 * Click branching lives in `./no-tenant-empty-state.handlers.ts` so it can
 * be pinned by vitest in node env.
 */
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { IconLifebuoy, IconLogout } from "@tabler/icons-react";

import { UnauthorizedCard } from "./unauthorized-card";
import {
  SUPPORT_MAILTO_HREF,
  makeNoTenantHandlers,
} from "./no-tenant-empty-state.handlers";

export function NoTenantEmptyState() {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const { handleSignOut } = makeNoTenantHandlers({
    signOut,
    navigate: (path) => router.push(path),
  });

  return (
    <UnauthorizedCard
      title="Accès non autorisé"
      description={
        <>
          Votre compte est authentifié mais aucun restaurant ne lui est associé
          pour le moment. Si votre provisioning est en cours, réessayez dans
          quelques minutes. Sinon, contactez le support KitchenBoost — un de vos
          rattachements a peut-être été détaché.
        </>
      }
      primaryAction={{
        label: "Contacter le support",
        href: SUPPORT_MAILTO_HREF,
        icon: <IconLifebuoy />,
      }}
      secondaryAction={{
        label: "Se déconnecter",
        onClick: handleSignOut,
        icon: <IconLogout />,
      }}
    />
  );
}
