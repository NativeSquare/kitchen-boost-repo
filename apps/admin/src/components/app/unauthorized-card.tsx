"use client";

/**
 * Shared "Accès non autorisé" surface — used by every UX-layer auth refusal
 * across the shell (ADR 0014 §3 + §4):
 *
 *   1. KB Manager landing on `/t/<tenantId>` they don't own
 *      (`(app)/t/[tenantId]/layout.tsx`, branch `not-authorized` of
 *      `decideTenantGate`).
 *   2. KB Manager landing on `/monitoring` (root-only supervision page —
 *      `monitoring-view.tsx`).
 *   3. Authenticated actor with neither admin role nor any tenant
 *      (`no-tenant-empty-state.tsx`).
 *
 * History — before this slice, each of those surfaces rendered its own
 * ad-hoc "Accès refusé" / silent redirect / "Pas de resto rattaché" message.
 * Three different visuals + one of them was a silent redirect (no copy at
 * all). Users could not tell whether they were rate-limited, redirected by
 * mistake, or genuinely refused. ADR 0014 §3 requires that the auth refusal
 * be SURFACED explicitly to the user, with the same vocabulary everywhere.
 * This component is that vocabulary.
 *
 * Reminder: this is the UX layer only — the real security barrier remains
 * backend (`tenantQuery` / `kbAdminQuery`, ADR 0010). A crafted URL still
 * cannot leak tenant data even if this card fails to render.
 *
 * Slot-based on purpose: each caller decides its own copy and CTAs (a
 * manager-redirect needs "Aller à mon resto", a monitoring refusal needs
 * "Retour au dashboard", a no-tenant state needs "Contacter le support" +
 * "Se déconnecter"). The TITLE defaults to "Accès non autorisé" so the
 * vocabulary stays consistent without forcing every caller to retype it.
 */
import type { ReactNode } from "react";
import { IconLock } from "@tabler/icons-react";

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

/**
 * Shape of one CTA rendered by the card. `href` and `onClick` are mutually
 * complementary: if `href` is set we render an `<a>` (or `<Link>` if you
 * wrap it in the icon slot), otherwise a `<Button onClick>`.
 *
 * `variant` defaults to `"default"` for the primary, `"outline"` for the
 * secondary — set explicitly only when overriding.
 */
export type UnauthorizedAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "outline";
  icon?: ReactNode;
};

export type UnauthorizedCardProps = {
  /** Defaults to "Accès non autorisé" — keep the same vocabulary across the
   *  shell unless you have a strong reason to deviate. */
  title?: string;
  description: ReactNode;
  primaryAction?: UnauthorizedAction;
  secondaryAction?: UnauthorizedAction;
};

function ActionButton({
  action,
  defaultVariant,
}: {
  action: UnauthorizedAction;
  defaultVariant: "default" | "outline";
}) {
  const variant = action.variant ?? defaultVariant;
  if (action.href !== undefined) {
    return (
      <Button asChild variant={variant}>
        <a href={action.href}>
          {action.icon}
          {action.label}
        </a>
      </Button>
    );
  }
  return (
    <Button variant={variant} onClick={action.onClick}>
      {action.icon}
      {action.label}
    </Button>
  );
}

export function UnauthorizedCard({
  title = "Accès non autorisé",
  description,
  primaryAction,
  secondaryAction,
}: UnauthorizedCardProps) {
  return (
    <div
      className="flex min-h-[60vh] w-full items-center justify-center p-6"
      data-slot="unauthorized-card"
    >
      <Card className="w-full max-w-md">
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconLock />
              </EmptyMedia>
              <EmptyTitle>{title}</EmptyTitle>
              <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
            {(primaryAction || secondaryAction) && (
              <EmptyContent>
                {primaryAction && (
                  <ActionButton
                    action={primaryAction}
                    defaultVariant="default"
                  />
                )}
                {secondaryAction && (
                  <ActionButton
                    action={secondaryAction}
                    defaultVariant="outline"
                  />
                )}
              </EmptyContent>
            )}
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
