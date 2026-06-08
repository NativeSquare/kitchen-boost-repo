"use client";

/**
 * Uber Direct a posteriori — `/t/[tenantId]/parametres/uber-direct`.
 *
 * Why this page (mirror of `/parametres/stripe`) :
 * the existing `setUberCredentials` mutation (slice 2.6-A) has ZERO frontend
 * call site today. The only way to configure Uber Direct for a tenant was a
 * direct `convex run` (root). This page closes that gap from the
 * tenant-scoped Paramètres area, available for BOTH a fresh tenant (the
 * wizard step is optional / skippable per Alex's product decision) AND for
 * already-active tenants whose Uber Direct setup needs editing.
 *
 * Surface
 * -------
 *  1. Reads `getUberState` (tenantQuery({ allow: ["kb_manager"] }) +
 *     kb_admin root override) → `{ uberCustomerId, isConfigured, name }`.
 *  2. Hosts the form (controlled here) for the 4 credential fields. We
 *     NEVER pre-fill stored values — to update, the operator re-enters
 *     them (the « rotate » flow is identical to the « create » flow).
 *  3. Save fires `setUberCredentials` (tenantMutation, audit-logged,
 *     envelope-encrypted server-side via `encryptForTenant`).
 *  4. Probe fires `probeUberAccount` (action, root-only) → live OAuth +
 *     Customers API check. Result rendered inline (✅/❌ per fact).
 *
 * RBAC : `getUberState` + `setUberCredentials` both `allow: ["kb_manager"]`
 * with kb_admin root override (cross-tenant MOAT enforced at the wrapper).
 * `probeUberAccount` is root-only (kb_manager would see a Forbidden
 * surfaced inline if they pressed « Tester » — matching the Stripe page).
 */

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";
import { Spinner } from "@/components/ui/spinner";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import {
  UberDirectSettingsView,
  type UberCredentialsForm,
  type UberProbeResult,
} from "./uber-direct-settings-view";

const EMPTY_FORM: UberCredentialsForm = {
  clientId: "",
  clientSecret: "",
  customerId: "",
  webhookSigningKey: "",
};

export default function UberDirectSettingsPage(): React.JSX.Element {
  const tenantId = useCurrentTenantId();

  const uberState = useTenantQuery(api.lib.admin.tenantSettings.getUberState);

  const setUberCredentials = useMutation(
    api.lib.uberDirect.credentials.setUberCredentials,
  );
  const probeUberAccount = useAction(
    api.lib.uberDirect.account.probeUberAccount,
  );

  const [form, setForm] = useState<UberCredentialsForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<UberProbeResult | null>(null);

  if (uberState === undefined) {
    return (
      <div
        className="flex h-[40vh] w-full items-center justify-center"
        data-slot="uber-settings-loading"
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const handleFormChange = (
    field: keyof UberCredentialsForm,
    value: string,
  ): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (): Promise<void> => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await setUberCredentials({
        tenantId,
        credentials: {
          clientId: form.clientId.trim(),
          clientSecret: form.clientSecret.trim(),
          customerId: form.customerId.trim(),
          // Omit the field entirely when empty (matches the optional
          // backend validator — `v.optional(v.string())`).
          ...(form.webhookSigningKey.trim().length > 0
            ? { webhookSigningKey: form.webhookSigningKey.trim() }
            : {}),
        },
      });
      toast.success("Credentials Uber Direct enregistrées (chiffrées)");
      // Vider la prévisualisation de la probe — l'admin doit re-tester après
      // un changement de creds.
      setProbeResult(null);
      // Vider le formulaire — invite à un nouveau cycle, et évite que des
      // secrets traînent côté DOM.
      setForm(EMPTY_FORM);
    } catch (error) {
      const message = getConvexErrorMessage(error);
      setSaveError(message);
      toast.error("Impossible d'enregistrer les credentials", {
        description: message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleProbe = async (): Promise<void> => {
    if (isProbing) return;
    setIsProbing(true);
    setProbeResult(null);
    try {
      const r = await probeUberAccount({ tenantId });
      setProbeResult({ ok: true, ...r });
    } catch (error) {
      const message = getConvexErrorMessage(error);
      setProbeResult({ ok: false, error: message });
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <UberDirectSettingsView
      tenantName={uberState.name}
      isConfigured={uberState.isConfigured}
      form={form}
      onFormChange={handleFormChange}
      isSaving={isSaving}
      onSave={handleSave}
      saveError={saveError}
      isProbing={isProbing}
      onProbe={handleProbe}
      probeResult={probeResult}
    />
  );
}
