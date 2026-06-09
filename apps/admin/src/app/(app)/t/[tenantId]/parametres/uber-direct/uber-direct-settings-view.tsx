"use client";

/**
 * `UberDirectSettingsView` — pure presentational view for the « Uber Direct
 * a posteriori » page at `/t/[tenantId]/parametres/uber-direct`. Surfaces
 * the form to enter Uber Direct credentials + a probe button to validate
 * they actually authenticate.
 *
 * Mirror of `stripe-settings-view.tsx` discipline — purely presentational,
 * every side-effect threaded via props (`onSave`, `onProbe`). The Convex
 * wiring (`getUberState` read, `setUberCredentials` write,
 * `probeUberAccount` action) is owned by the parent `page.tsx`.
 *
 * Inputs collected (PRD 40 §1, `UberCredentials` shape) :
 *  - `clientId`            — Uber Direct app client_id (from Uber Developer dashboard)
 *  - `clientSecret`        — Uber Direct app client_secret (sensitive)
 *  - `customerId`          — Uber Customer/sub-account id (organization)
 *  - `webhookSigningKey`   — OPTIONAL ; only required to verify status webhooks
 *
 * Status badge :
 *  - `not-configured`  → "Non configuré" (no credentials stored)
 *  - `configured`      → "Configuré" (credentials stored, never probed)
 *  - `probe-ok`        → "Configuré · Connexion validée" (last probe = success)
 *  - `probe-failed`    → "Configuré · Erreur de connexion" (last probe = error)
 *
 * Testability — pure component (zero Convex hooks, zero toast). Pinned by
 * `uber-direct-settings-view.test.tsx` under the lean `node` vitest env
 * (same React-tree serializer as `stripe-settings-view.test.tsx`).
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UberCredentialsForm = {
  clientId: string;
  clientSecret: string;
  customerId: string;
  webhookSigningKey: string;
};

export type UberProbeResult =
  | {
      ok: true;
      customerId: string;
      tokenObtained: boolean;
      customerReachable: boolean;
      hasWebhookSigningKey: boolean;
      deliveryCountSample: number;
    }
  | { ok: false; error: string };

export type UberDirectSettingsViewProps = {
  /** Tenant name for the page header. */
  tenantName: string;
  /** Whether the tenant already has Uber Direct credentials stored (from `getUberState.isConfigured`). */
  isConfigured: boolean;
  /**
   * Form state (controlled). Owned by the parent. Pre-filled empty even
   * when `isConfigured` — we NEVER expose the stored secret values back
   * to the UI (the only way to update them is to re-enter the full set,
   * which is the sanctioned « rotate » flow).
   */
  form: UberCredentialsForm;
  /** Setter for one form field (parent owns state). */
  onFormChange: (field: keyof UberCredentialsForm, value: string) => void;
  /** Disable the « Sauvegarder » button while the mutation is in flight. */
  isSaving: boolean;
  /** Save handler — parent wires `useMutation(setUberCredentials)`. */
  onSave: () => void;
  /** Backend error message after a failed save (e.g. VALIDATION). */
  saveError: string | null;
  /** Disable the « Tester » button while the probe action is in flight. */
  isProbing: boolean;
  /** Probe handler — parent wires `useAction(probeUberAccount)`. */
  onProbe: () => void;
  /**
   * Last probe result (or `null` if never probed). Discriminated by `ok`
   * so the call-site forces both branches in the UI.
   */
  probeResult: UberProbeResult | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ProbeLine(props: {
  label: string;
  ok: boolean;
  detail?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={props.ok ? "text-emerald-600" : "text-red-600"}
      >
        {props.ok ? "✅" : "❌"}
      </span>
      <span className="flex-1">{props.label}</span>
      {props.detail !== undefined ? (
        <span className="font-mono text-xs text-muted-foreground">
          {props.detail}
        </span>
      ) : null}
    </div>
  );
}

type StatusCopy = {
  label: string;
  description: string;
};

function statusCopy(
  isConfigured: boolean,
  probeResult: UberProbeResult | null,
): StatusCopy {
  if (!isConfigured) {
    return {
      label: "Uber Direct : Non configuré",
      description:
        "Aucune credential Uber Direct n'est enregistrée pour ce restaurant. Saisis-les ci-dessous puis sauvegarde.",
    };
  }
  if (probeResult === null) {
    return {
      label: "Uber Direct : Configuré",
      description:
        "Les credentials sont enregistrées (chiffrées). Lance « Tester la connexion » pour vérifier qu'elles authentifient bien.",
    };
  }
  if (probeResult.ok) {
    return {
      label: "Uber Direct : Configuré · Connexion validée",
      description:
        "OAuth + accès Customers API confirmés. Le restaurant peut créer des courses Uber Direct.",
    };
  }
  return {
    label: "Uber Direct : Configuré · Erreur de connexion",
    description:
      "Les credentials sont enregistrées mais la dernière probe a échoué — vois le détail ci-dessous.",
  };
}

// Activation du bouton « Sauvegarder ». Deux régimes :
//  - Création (`!isConfigured`) : les 3 secrets sont OBLIGATOIRES (le backend
//    setUberCredentials exige le tuple complet — refuse un envelope partiel).
//  - Update (`isConfigured`) : AU MOINS UN champ doit être saisi (les autres
//    gardent leur valeur stockée via patchUberCredentials côté backend).
//    `webhookSigningKey` reste toujours optionnel sur le tuple.
function isFormSubmittable(
  form: UberCredentialsForm,
  isConfigured: boolean,
): boolean {
  if (!isConfigured) {
    return (
      form.clientId.trim().length > 0 &&
      form.clientSecret.trim().length > 0 &&
      form.customerId.trim().length > 0
    );
  }
  return (
    form.clientId.trim().length > 0 ||
    form.clientSecret.trim().length > 0 ||
    form.customerId.trim().length > 0 ||
    form.webhookSigningKey.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UberDirectSettingsView(
  props: UberDirectSettingsViewProps,
): React.JSX.Element {
  const {
    tenantName,
    isConfigured,
    form,
    onFormChange,
    isSaving,
    onSave,
    saveError,
    isProbing,
    onProbe,
    probeResult,
  } = props;

  const status = statusCopy(isConfigured, probeResult);
  const canSubmit = isFormSubmittable(form, isConfigured) && !isSaving;
  const canProbe = isConfigured && !isProbing;

  return (
    <div
      className="flex flex-col gap-4 px-4 py-4 lg:px-6"
      data-slot="uber-settings-view"
    >
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Uber Direct — {tenantName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Saisis les credentials API Uber Direct du restaurant (récupérées sur
          le dashboard Uber Direct du resto). Une fois enregistrées, lance le
          test de connexion pour valider qu&apos;elles authentifient.
        </p>
      </div>

      {/* Status card */}
      <Card data-slot="uber-settings-status">
        <CardHeader>
          <CardTitle>{status.label}</CardTitle>
          <CardDescription>{status.description}</CardDescription>
        </CardHeader>
      </Card>

      {/* Form — toujours visible. Deux régimes :
          - !isConfigured (création initiale) : les 3 secrets sont OBLIGATOIRES.
          - isConfigured (rotation/update) : tous les champs sont OPTIONNELS,
            les champs vides gardent leur valeur stockée (merge backend via
            patchUberCredentials). L'opérateur peut donc modifier 1 seul
            champ — ex : ajouter la webhook_signing_key sans retaper les
            secrets.
          Labels alignés sur la nomenclature OFFICIELLE Uber Direct FR
          (dashboard Uber → API credentials), avec le nom technique
          (`customer_id` / `client_id` / `client_secret`) entre parenthèses
          pour lever l'ambiguïté « Identifiant client » vs
          « Identifiant DU client » côté Uber. */}
      <Card data-slot="uber-settings-form">
        <CardHeader>
          <CardTitle>Credentials Uber Direct</CardTitle>
          <CardDescription>
            Récupérables sur le dashboard Uber Direct du restaurant (section API
            credentials). Les valeurs sont chiffrées côté serveur (envelope
            encryption) — on ne les ré-affiche jamais en clair.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="uber-settings-customer-id">
              Identifiant du client{" "}
              <span className="text-xs text-muted-foreground">
                (customer_id)
              </span>
            </Label>
            <Input
              id="uber-settings-customer-id"
              data-slot="uber-settings-customer-id"
              value={form.customerId}
              onChange={(e) => onFormChange("customerId", e.target.value)}
              autoComplete="off"
              placeholder="a32bdddd-6566-5028-9a83-1c48037f551b"
            />
            <p className="text-xs text-muted-foreground">
              UUID du restaurant chez Uber. Visible dans l&apos;URL
              d&apos;exemple côté Uber :{" "}
              <code className="font-mono">
                api.uber.com/v1/customers/&lt;ici&gt;/deliveries
              </code>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="uber-settings-client-id">
              Identifiant client{" "}
              <span className="text-xs text-muted-foreground">(client_id)</span>
            </Label>
            <Input
              id="uber-settings-client-id"
              data-slot="uber-settings-client-id"
              value={form.clientId}
              onChange={(e) => onFormChange("clientId", e.target.value)}
              autoComplete="off"
              placeholder={
                isConfigured
                  ? "•••••• (laisser vide pour ne pas changer)"
                  : "0XgWA4ZpWH3ooTA4Ltzmo_GdOGd1MPHO"
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="uber-settings-client-secret">
              Secret client{" "}
              <span className="text-xs text-muted-foreground">
                (client_secret)
              </span>
            </Label>
            <Input
              id="uber-settings-client-secret"
              data-slot="uber-settings-client-secret"
              type="password"
              value={form.clientSecret}
              onChange={(e) => onFormChange("clientSecret", e.target.value)}
              autoComplete="off"
              placeholder={
                isConfigured
                  ? "•••••• (laisser vide pour ne pas changer)"
                  : undefined
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="uber-settings-webhook-key">
              Clé de signature webhook{" "}
              <span className="text-xs text-muted-foreground">
                (webhook_signing_key, optionnel)
              </span>
            </Label>
            <Input
              id="uber-settings-webhook-key"
              data-slot="uber-settings-webhook-key"
              type="password"
              value={form.webhookSigningKey}
              onChange={(e) =>
                onFormChange("webhookSigningKey", e.target.value)
              }
              autoComplete="off"
              placeholder={
                isConfigured
                  ? "•••••• (laisser vide pour ne pas changer)"
                  : undefined
              }
            />
            <p className="text-xs text-muted-foreground">
              Requis pour vérifier les webhooks de statut de course. Le resto le
              récupère sur Uber après avoir configuré l&apos;URL webhook :
              <code className="ml-1 font-mono">
                /webhooks/uber/&lt;tenantId&gt;
              </code>
            </p>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              data-slot="uber-settings-save"
              onClick={onSave}
              disabled={!canSubmit}
            >
              {isSaving
                ? "Sauvegarde…"
                : isConfigured
                  ? "Mettre à jour les credentials"
                  : "Sauvegarder les credentials"}
            </Button>
            {saveError !== null ? (
              <span
                data-slot="uber-settings-save-error"
                className="text-sm text-destructive"
              >
                {saveError}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Probe — visible seulement quand au moins une sauvegarde a eu lieu */}
      {isConfigured ? (
        <div
          data-slot="uber-settings-probe-block"
          className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                Tester la connexion Uber Direct
              </p>
              <p className="text-xs text-muted-foreground">
                Interroge l&apos;API Uber Direct en live (OAuth + accès
                Customers) pour confirmer que les credentials authentifient.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              data-slot="uber-settings-probe"
              onClick={onProbe}
              disabled={!canProbe}
            >
              {isProbing ? "Test…" : "Tester la connexion"}
            </Button>
          </div>

          {probeResult !== null ? (
            probeResult.ok ? (
              <div
                data-slot="uber-settings-probe-result"
                className="mt-2 flex flex-col gap-1.5 rounded border border-slate-200 bg-white p-3 text-sm"
              >
                <ProbeLine
                  label="Authentification OAuth (client_id + secret)"
                  ok={probeResult.tokenObtained}
                />
                <ProbeLine
                  label="Identifiant du client reconnu (customer_id)"
                  ok={probeResult.customerReachable}
                  detail={probeResult.customerId}
                />
                <ProbeLine
                  label="Clé de signature webhook renseignée"
                  ok={probeResult.hasWebhookSigningKey}
                  detail={
                    probeResult.hasWebhookSigningKey ? "présente" : "absente"
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Échantillon deliveries renvoyées :{" "}
                  {probeResult.deliveryCountSample}
                </p>
              </div>
            ) : (
              <div
                data-slot="uber-settings-probe-error"
                className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"
              >
                ❌ {probeResult.error}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
