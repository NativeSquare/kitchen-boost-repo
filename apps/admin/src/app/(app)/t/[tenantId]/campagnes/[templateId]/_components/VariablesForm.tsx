/**
 * F-CAMPAGNES [3/7] (#205) + [4/7] (#215) — `VariablesForm`, the dynamic
 * per-template variable form (parent EPIC #145, ADR 0006 / PRD 80 §4).
 *
 * Issue body verbatim:
 *   - generates fields dynamically from the variable constraints declared
 *     on the picked template (`{prenom_client}`, `{nom_resto}`,
 *     `{item_hero}`, `{discount}`, `{nom_plat}`, `{heure_debut}`,
 *     `{heure_fin}`, `{jour}`);
 *   - mapping (V1 closed, ADR 0006):
 *       `{discount}` → slider 0-50 % (cap hardcoded, FR label
 *                       « -X % de réduction »);
 *       `{prenom_client}`, `{nom_resto}`, `{item_hero}`, `{nom_plat}`,
 *       `{jour}` → text input + FR/length validation;
 *       `{heure_debut}`, `{heure_fin}` → time picker HH:MM.
 *   - validation client-side miroir des garde-fous backend
 *     (`templateBounds.ts`): `discount ≤ 50 %` (impossible côté slider),
 *     longueur raisonnable (cap final 200 chars rendu sliced [4/7]),
 *     FR uniquement (refus mention alcool dans les champs libres).
 *
 * Slice [4/7] (#215) integration: the « Envoyer maintenant » button no
 * longer lives here — it moved into `<CampaignPreview/>`, which is rendered
 * inline below the fields by the shell. The shell threads its `values` state
 * into both the fields AND the preview, so the live preview + bound-aware
 * button update in real time as the gérant types. The pure `VariablesFormView`
 * remains an input-only surface (test-callable under `environment: "node"`).
 *
 * Scope (#205 / #215 hard constraint): under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/[templateId]/`. Zero
 * touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 *
 * Two-layer split — same testability discipline as `CampagnesView` ↔
 * `page.tsx`:
 *   - `VariablesForm` (this file's public export): the THIN stateful
 *     shell. Owns the per-field local state (one `useState` map seeded
 *     from `initialValues`); wires `onChange` per field; renders the
 *     pure `VariablesFormView` for the inputs + the `CampaignPreview` for
 *     the live preview surface and the bound-aware submit button.
 *   - `VariablesFormView`: PURE presentational. Receives the values + the
 *     onChange callback. Computes per-field violations from
 *     `validateVariableValue` and paints them inline. Callable as a plain
 *     function under `environment: "node"` — that is what the test does
 *     when it walks the React tree.
 *
 * MOAT / isolation: pure presentational form — no query, no mutation, no
 * recipient identity. Isolation owned upstream by the picker's
 * `listTenantTemplates` wrapper (ADR 0010).
 */

"use client";

import { useState } from "react";
import { toast } from "sonner";

// Value imports from the pure submodule (`templateBounds.ts`) — the barrel
// re-exports `engine.ts` which transitively pulls `getCurrentActor.ts`
// (`whoAmI = query(...)`). Any value-import from the barrel forces the
// browser bundler to evaluate server-only Convex code. `import type` from
// the barrel is fine (TS elides the import at compile time).
import { MAX_DISCOUNT_PERCENT } from "@packages/backend/convex/lib/notifications/templateBounds";
import type { TemplateVariable } from "@packages/backend/convex/lib/notifications/templateBounds";
import type {
  CampaignResult,
  TenantTemplateSummary,
} from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  type CampaignAnomalyReason,
  classifySendError,
} from "../_lib/classifySendError";
import { CampaignAnomalyDialog } from "./CampaignAnomalyDialog";
import { CampaignPreview } from "./CampaignPreview";
import { CampaignResultStats } from "./CampaignResultStats";
import {
  type VariableValidationViolation,
  MAX_INPUT_LENGTH,
  validateVariableValue,
} from "./variables-form-validation";

/**
 * FR labels for every variable of the V1 closed set (ADR 0006). Centralised
 * here so a typographic polish is one edit, and so the test can pin the
 * load-bearing word per variable without coupling to the exact wording.
 */
const VARIABLE_LABELS: Record<TemplateVariable, string> = {
  prenom_client: "Prénom du client",
  nom_resto: "Nom du restaurant",
  item_hero: "Plat phare",
  discount: "Pourcentage de réduction",
  nom_plat: "Nom du plat",
  heure_debut: "Heure de début",
  heure_fin: "Heure de fin",
  jour: "Jour",
};

/** Human-readable FR violation copy — the test pins the load-bearing word. */
const VIOLATION_COPY: Record<VariableValidationViolation, string> = {
  INPUT_TOO_LONG: `Texte trop long (max ${MAX_INPUT_LENGTH} caractères)`,
  ALCOHOL_NOT_ALLOWED:
    "Mention d'alcool interdite (templates KitchenBoost — ADR 0006).",
  DISCOUNT_TOO_HIGH: `Réduction trop élevée (max ${MAX_DISCOUNT_PERCENT} %).`,
  DISCOUNT_INVALID: "Valeur de réduction invalide.",
  TIME_INVALID: "Heure invalide (format attendu HH:MM).",
};

/**
 * Args shape forwarded to `onSend` — `tenantId` is auto-injected by
 * `useTenantMutation` upstream (ADR 0014 §4 / #183), so the shell only
 * carries the two business-relevant fields.
 */
export type SendCampaignArgs = {
  templateId: Id<"notificationTemplates">;
  variables: Record<string, string>;
};

export type VariablesFormProps = {
  /** Current tenant — threaded by the page for parity with the picker's
   *  per-card hrefs and any future per-tenant deep-link the form might
   *  build (not used by the form itself today). */
  tenantId: Id<"tenants">;
  /** The pre-validated template picked by the gérant (backend projection
   *  from `listTenantTemplates`). Its `variables` array drives the field
   *  generation 1:1. */
  template: TenantTemplateSummary;
  /** Optional pre-seeded values per variable name. The test uses this to
   *  pin the error-surface branches deterministically (node-env, no
   *  event simulation). In production the form starts uncontrolled
   *  (empty values) and the gérant fills it. */
  initialValues?: Partial<Record<TemplateVariable, string>>;
  /**
   * F-CAMPAGNES [5/7] (#228) — the `sendTenantCampaign` mutation trigger
   * threaded by the page (`useTenantMutation(api.lib.notifications.campaigns.sendTenantCampaign)`).
   * Returns the aggregate `CampaignResult` payload on success, throws a
   * `ConvexError` on backend failure (anomaly or template-bound violation).
   * Optional so the slice [3/7] / [4/7] tests of the inner view stay
   * decoupled from the mutation wiring.
   */
  onSend?: (args: SendCampaignArgs) => Promise<CampaignResult>;
};

/**
 * The stateful shell. Owns the per-field `useState` map (seeded from
 * `initialValues`) AND, since slice [5/7] (#228), the send state machine
 * (idle / sending / success). On success the input form is swapped for
 * the aggregate-only `CampaignResultStats` surface (MOAT, ADR 0010 /
 * PRD 90 §3-§5). On a `CAMPAIGN_ANOMALY` ConvexError the
 * `CampaignAnomalyDialog` opens with the parsed reason; any other failure
 * surfaces as a generic FR `toast.error` + retry (the button stays
 * enabled).
 *
 * NOT directly invoked under `environment: "node"` (uses `useState`); the
 * serializer catches the hook throw and the inner pure view is tested
 * separately via `VariablesFormView`.
 */
export function VariablesForm({
  tenantId,
  template,
  initialValues,
  onSend,
}: VariablesFormProps) {
  const [values, setValues] = useState<
    Partial<Record<TemplateVariable, string>>
  >(() => ({ ...(initialValues ?? {}) }));

  // Send state machine — `idle` is the editing phase; `sending` disables the
  // button while the mutation is in flight; `success` swaps the form for the
  // result surface. An error never enters the machine — it surfaces via toast
  // (generic) or the anomaly dialog (CAMPAIGN_ANOMALY) and the machine stays
  // `idle` so the gérant can retry.
  const [sendState, setSendState] = useState<"idle" | "sending" | "success">(
    "idle",
  );
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [anomalyReason, setAnomalyReason] =
    useState<CampaignAnomalyReason | null>(null);

  const handleSubmit = async () => {
    // Defensive guard — the CampaignPreview button is disabled when a bound
    // violation is present, and absent when `onSend` is not wired (the view
    // also lives in a slice-3/4 read-only context).
    if (onSend === undefined || sendState === "sending") return;

    // Coerce the partial `Record<TemplateVariable, string>` to the plain
    // record the backend mutation accepts (mirror of the CampaignPreview
    // coercion: undefined values collapse to "" via the backend's benign-
    // blank semantics).
    const variablesPayload: Record<string, string> = {};
    for (const k of Object.keys(values) as TemplateVariable[]) {
      const v = values[k];
      if (v !== undefined) variablesPayload[k] = v;
    }

    setSendState("sending");
    try {
      const sent = await onSend({
        templateId: template.id,
        variables: variablesPayload,
      });
      setResult(sent);
      setSendState("success");
    } catch (error) {
      const classified = classifySendError(error);
      if (classified.kind === "anomaly") {
        setAnomalyReason(classified.reason);
        setAnomalyOpen(true);
      } else {
        toast.error("Envoi impossible. Réessaie dans un instant.");
      }
      setSendState("idle");
    }
  };

  // Success branch — swap the form for the aggregate-only result surface.
  // « Lancer une nouvelle campagne » resets the state machine and the form
  // values so the gérant can fire another campaign without leaving the route.
  if (sendState === "success" && result !== null) {
    return (
      <div className="flex flex-col gap-6">
        <CampaignResultStats result={result} />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSendState("idle");
              setResult(null);
              setValues({});
            }}
          >
            Lancer une nouvelle campagne
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VariablesFormView
        tenantId={tenantId}
        template={template}
        values={values}
        onChange={(name, next) =>
          setValues((prev) => ({ ...prev, [name]: next }))
        }
      />
      <CampaignPreview
        template={template}
        values={values}
        onSubmit={handleSubmit}
        sending={sendState === "sending"}
      />
      <CampaignAnomalyDialog
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
        reason={anomalyReason}
      />
    </div>
  );
}

export type VariablesFormViewProps = {
  tenantId: Id<"tenants">;
  template: TenantTemplateSummary;
  values: Partial<Record<TemplateVariable, string>>;
  onChange: (name: TemplateVariable, next: string) => void;
};

/**
 * Pure presentational view — no hooks, no Convex. Callable as a plain
 * function (the test walks its React tree under `environment: "node"`).
 * Computes the per-field violation from `validateVariableValue` and paints
 * the error inline; surfaces the « Envoyer maintenant » submit button
 * disabled (slice [4/7] enables it).
 */
export function VariablesFormView({
  template,
  values,
  onChange,
}: VariablesFormViewProps) {
  const violations: Partial<
    Record<TemplateVariable, VariableValidationViolation>
  > = {};
  for (const name of template.variables) {
    const v = values[name] ?? "";
    const violation = validateVariableValue(name, v);
    if (violation !== null) violations[name] = violation;
  }

  return (
    <form
      data-slot="variables-form"
      className="flex flex-col gap-4"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-4">
        {template.variables.map((name) => (
          <VariableField
            key={name}
            name={name}
            value={values[name] ?? ""}
            onChange={(next) => onChange(name, next)}
            violation={violations[name]}
          />
        ))}
      </div>
      {/*
       * Slice [4/7] (#215): the « Envoyer maintenant » button + the live
       * preview surface no longer live here — they moved into
       * `<CampaignPreview/>`, rendered by the stateful `VariablesForm`
       * shell alongside this view so both share the same `values` state.
       */}
    </form>
  );
}

type VariableFieldProps = {
  name: TemplateVariable;
  value: string;
  onChange: (next: string) => void;
  violation: VariableValidationViolation | undefined;
};

function VariableField({
  name,
  value,
  onChange,
  violation,
}: VariableFieldProps) {
  const label = VARIABLE_LABELS[name];
  const errorId = `${name}-error`;
  const error = violation !== undefined ? VIOLATION_COPY[violation] : null;

  return (
    <div data-slot="variable-field" className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {name === "discount" ? (
        <DiscountSlider
          id={name}
          value={value}
          onChange={onChange}
          ariaInvalid={error !== null}
          ariaDescribedBy={error !== null ? errorId : undefined}
        />
      ) : name === "heure_debut" || name === "heure_fin" ? (
        <Input
          id={name}
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
        />
      ) : (
        <Input
          id={name}
          type="text"
          value={value}
          maxLength={MAX_INPUT_LENGTH}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
        />
      )}
      {error !== null ? (
        <p
          id={errorId}
          data-slot="variable-field-error"
          className="text-destructive text-xs"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

type DiscountSliderProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  ariaInvalid: boolean;
  ariaDescribedBy: string | undefined;
};

function DiscountSlider({
  id,
  value,
  onChange,
  ariaInvalid,
  ariaDescribedBy,
}: DiscountSliderProps) {
  const numeric = value === "" ? 0 : Number(value);
  const display = Number.isFinite(numeric) ? numeric : 0;
  // We use a native `<input type="range">` instead of the shadcn `Slider`
  // primitive: the contract V1 is bounded (0..50, integer step) and the
  // native widget already enforces it at the browser level — no extra
  // JS needed. Bonus: the test can pin `max={50}` on the actual DOM
  // element without having to invoke a shadcn forwardRef under
  // `environment: "node"` (which would throw « invalid hook call »).
  // `data-slot="slider"` keeps the marker the picker tests already
  // recognise.
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        data-slot="slider"
        type="range"
        max={MAX_DISCOUNT_PERCENT}
        min={0}
        step={1}
        value={display}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="flex-1 accent-[#1B7A3D]"
      />
      <span className="text-muted-foreground w-28 text-right text-sm tabular-nums">
        -{display} % de réduction
      </span>
    </div>
  );
}
