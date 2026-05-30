"use client";

/**
 * `NoTenantAttached` — placeholder page shown when an authenticated pro user
 * has no tenant accessible (i.e. `isAdmin === false && tenants.length === 0`).
 *
 * Per ADR 0014 §3, this is a transitional state: « pro authentifié sans
 * tenant accessible (rattachements détachés, compte en cours de
 * provisioning) → page « pas de resto rattaché » ». The full UX of this page
 * (support contact, status of provisioning, etc.) will land with a later
 * tracer-bullet — F-SHELL-02 (issue #164) only wires up the garde-side
 * rendering hook for it.
 */
import { Spinner } from "@/components/ui/spinner";

export function NoTenantAttached() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <Spinner className="h-8 w-8 text-muted-foreground" />
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">Aucun restaurant rattaché</h1>
        <p className="text-sm text-muted-foreground">
          Votre compte n&apos;a pas encore de restaurant associé. Si votre
          provisioning est en cours, ressayez dans quelques minutes. Sinon,
          contactez votre interlocuteur KitchenBoost.
        </p>
      </div>
    </div>
  );
}
