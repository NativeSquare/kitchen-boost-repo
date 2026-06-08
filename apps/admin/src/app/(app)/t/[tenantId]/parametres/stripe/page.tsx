"use client";

/**
 * Stripe Connect a posteriori — `/t/[tenantId]/parametres/stripe`.
 *
 * Why this page
 * -------------
 * Before this page, the Stripe Connect Express onboarding action
 * (`api.lib.stripe.account.createStripeAccountLink`) was exposed ONLY in
 * the new-tenant provisioning wizard at `(app)/pipeline/[prospectId]
 * /provision/step3-stripe-kyc-form.tsx`. There was NO way to launch /
 * re-launch the Stripe onboarding for a tenant that was created outside
 * the wizard (seeded test tenants, legacy tenants, or tenants whose KYC
 * needs to be redone). This page closes that gap from the tenant-scoped
 * Paramètres area.
 *
 * Surface
 * -------
 *  1. Reads the tenant's current Stripe state via the new
 *     `api.lib.admin.tenantSettings.getStripeState` (tenantQuery,
 *     allow: ["kb_manager"] + kb_admin root override). The query returns
 *     `{ stripeAccountId, stripeStatus, siret, name }` — never the full
 *     `Doc<"tenants">` (exposure discipline mirroring `getSettings`).
 *  2. Mounts `StripeSettingsView` (pure presentational) with the read
 *     state + the `onGenerate` / `onCopy` handlers wired here.
 *  3. `onGenerate` fires the existing root-only
 *     `api.lib.stripe.account.createStripeAccountLink` action with
 *     `refreshUrl` / `returnUrl` both pointing back to this same page
 *     (so Stripe sends the gérant back here on completion AND on link
 *     expiry; the operator simply clicks « Régénérer » in that case).
 *  4. The `account.updated` webhook flips `stripeStatus` to `ready` —
 *     because `useTenantQuery` subscribes, the status card refreshes
 *     live the moment the webhook lands (no manual reload needed).
 *
 * Wiring discipline (mirror of `step3-stripe-kyc-form.tsx`'s Step3Form
 * wrapper): owns the in-flight + URL + error state, fires the action,
 * surfaces backend errors inline AND via toast, threads
 * `navigator.clipboard.writeText` + `toast.success` through the `onCopy`
 * prop so the view stays presentational + testable under the lean `node`
 * vitest env.
 *
 * RBAC: the parent `(app)/t/[tenantId]/layout.tsx` already gates access
 * (kb_admin via root override, kb_manager via tenant membership). The
 * `getStripeState` query enforces the SAME RBAC at the backend level
 * (cross-tenant MOAT, ADR 0010 — a manager from tenant B is refused
 * Forbidden even if the layout regresses).
 *
 * Action degradation for kb_manager: the existing `createStripeAccountLink`
 * action is wrapped with `kbAdminQuery`-gated `loadTenantForStripe`, i.e.
 * root-only. A kb_manager pressing « Générer » will see a Forbidden
 * surfaced inline (the wrapper refuses BEFORE any Stripe call). This is
 * the documented degradation in V1 — admin support can step in via the
 * tenant switcher; widening the action to managers is a separate ticket
 * (would need its own audit + rate-limit story).
 *
 * Scope discipline (apps/admin ONLY for the page; one small backend
 * query under packages/backend/convex/lib/admin/ — `getStripeState` —
 * for the read; the action stays untouched).
 */

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";
import { Spinner } from "@/components/ui/spinner";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { StripeSettingsView, type StripeStatus } from "./stripe-settings-view";

export default function StripeSettingsPage() {
  const tenantId = useCurrentTenantId();

  // tenantQuery({ allow: ["kb_manager"] }) — auto-injects tenantId from the
  // TenantProvider context (ADR 0014 §4 / F-SHELL-05 #183). Loading sentinel
  // is `undefined`; the resolved shape is { stripeAccountId, stripeStatus,
  // siret, name }. Reactive: when the `account.updated` webhook flips
  // `stripeStatus` to `ready`, this query re-fires and the view repaints
  // without a reload.
  const stripeState = useTenantQuery(
    api.lib.admin.tenantSettings.getStripeState,
  );

  // The Stripe action is root-only (cf. page header). `useAction` for the
  // raw Convex action — we add an explicit `tenantId` arg ourselves
  // (`useTenantAction` would auto-inject it too, but the action is
  // root-flavoured and not wired through `tenantAction` — using `useAction`
  // directly mirrors the wizard's `Step3Form` discipline exactly).
  const createStripeAccountLink = useAction(
    api.lib.stripe.account.createStripeAccountLink,
  );

  // Backup admin override (chemin de secours quand le webhook
  // account.updated ne ramène pas le statut à ready). Backend rejette si
  // pas de stripeAccountId + audit-log chaque flip. Root-only via
  // kbAdminMutation.
  const forceStripeStatusOverride = useMutation(
    api.lib.stripe.account.forceStripeStatusOverride,
  );

  const [accountLink, setAccountLink] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [isOverriding, setIsOverriding] = useState(false);
  // Email du restaurant — requis par Stripe `/v1/accounts` (champ `email`).
  // Saisi par l'opérateur ici parce qu'aucun « prospect » n'existe pour un
  // tenant créé hors wizard (a posteriori).
  const [email, setEmail] = useState("");

  // Loading sentinel — the view requires a tenantName + the read state.
  if (stripeState === undefined) {
    return (
      <div
        className="flex h-[40vh] w-full items-center justify-center"
        data-slot="stripe-settings-loading"
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const handleGenerate = async (): Promise<void> => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      // Both refresh + return URLs point back to this page — Stripe sends
      // the gérant here on completion AND on link expiry. The reactive
      // `getStripeState` query will repaint the status card the moment
      // the `account.updated` webhook flips `stripeStatus`.
      const refreshUrl =
        typeof window !== "undefined" ? window.location.href : "";
      const returnUrl = refreshUrl;
      const result = await createStripeAccountLink({
        tenantId,
        refreshUrl,
        returnUrl,
        prefill: {
          siret: stripeState.siret,
          // Email saisi par l'opérateur dans le formulaire (la view garde
          // le bouton désactivé tant que la syntaxe email est invalide).
          // Stripe `/v1/accounts` rejette un email vide ("Invalid email
          // address: "), donc on ne se permet PAS de pousser "" comme le
          // faisait le wizard quand `prospect.email` était null.
          email: email.trim(),
        },
      });
      setAccountLink(result.url);
      toast.success("Lien Stripe Connect généré");
    } catch (error) {
      const message = getConvexErrorMessage(error);
      setGenError(message);
      toast.error("Impossible de générer le lien Stripe Connect", {
        description: message,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleForceReady = async (): Promise<void> => {
    if (isOverriding) return;
    if (!window.confirm("Confirmer l'override : marquer le KYC comme validé ?"))
      return;
    setIsOverriding(true);
    try {
      await forceStripeStatusOverride({ tenantId, status: "ready" });
      toast.success("Statut Stripe Connect forcé à « Prêt »");
    } catch (error) {
      const message = getConvexErrorMessage(error);
      toast.error("Impossible de forcer le statut", { description: message });
    } finally {
      setIsOverriding(false);
    }
  };

  const handleCopy = async (url: string): Promise<void> => {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard !== undefined
      ) {
        await navigator.clipboard.writeText(url);
        toast.success("Lien copié");
      }
    } catch {
      toast.error("Impossible de copier le lien");
    }
  };

  return (
    <StripeSettingsView
      tenantName={stripeState.name}
      email={email}
      onEmailChange={setEmail}
      stripeAccountId={stripeState.stripeAccountId ?? undefined}
      stripeStatus={
        (stripeState.stripeStatus ?? undefined) as StripeStatus | undefined
      }
      accountLink={accountLink}
      isGenerating={isGenerating}
      genError={genError}
      onGenerate={handleGenerate}
      onCopy={handleCopy}
      onForceReady={handleForceReady}
      isOverriding={isOverriding}
    />
  );
}
