"use client";

/**
 * F-SHELL-03 — `NoTenantEmptyState` (issue #169).
 *
 * Shown by `SessionGuard` (#164) when the actor is authenticated but has
 * neither `isAdmin` nor any tenant attached — i.e. the « pro authentifié
 * sans tenant accessible (rattachements détachés, compte en cours de
 * provisioning) » state described in ADR 0014 §3.
 *
 * This is NOT a route — it's a state of the shell. The component is pure UI:
 * it doesn't query Convex, doesn't read URL, doesn't pick a default route.
 * It just exposes two CTAs to unstick the user:
 *
 *   - « Contacter le support » → `mailto:support@kitchen-boost.fr`
 *     (anchor; opens the OS mail client — no auth needed, works even if the
 *     backend is degraded).
 *   - « Se déconnecter » → calls Convex Auth's `signOut`, then pushes
 *     `/login`. Mirrors `NavUser`'s logout flow so the two surfaces stay
 *     consistent.
 *
 * The click branching lives in `./no-tenant-empty-state.handlers.ts` so it
 * can be pinned by vitest in node env (same split as `session-guard` /
 * `decideSessionGate`).
 */
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  IconLifebuoy,
  IconLogout,
  IconBuildingStore,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
    <div className="flex min-h-screen w-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconBuildingStore />
              </EmptyMedia>
              <EmptyTitle>Pas de resto rattaché</EmptyTitle>
              <EmptyDescription>
                Votre compte est authentifié mais aucun restaurant ne lui est
                associé pour le moment. Si votre provisioning est en cours,
                ressayez dans quelques minutes. Sinon, contactez le support
                KitchenBoost — un de vos rattachements a peut-être été détaché.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <a href={SUPPORT_MAILTO_HREF}>
                  <IconLifebuoy />
                  Contacter le support
                </a>
              </Button>
              <Button variant="outline" onClick={handleSignOut}>
                <IconLogout />
                Se déconnecter
              </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
