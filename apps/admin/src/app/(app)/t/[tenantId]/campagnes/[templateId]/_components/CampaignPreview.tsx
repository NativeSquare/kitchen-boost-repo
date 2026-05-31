/**
 * F-CAMPAGNES [4/7] (#215) — `CampaignPreview`, the live preview of the final
 * rendered message + the bound-aware « Envoyer maintenant » button (parent
 * EPIC #145, ADR 0006 / PRD 80 §4).
 *
 * Issue body verbatim:
 *   - Affiche le message final selon le canal du template (mock push notif ou
 *     mock email HTML simple).
 *   - Compteur visuel `< 200 chars` (vert / rouge).
 *   - Indicateur violation si présent (inline, FR).
 *   - Bouton « Envoyer maintenant » actif ssi `violation === null`,
 *     désactivé sinon (avec tooltip expliquant pourquoi).
 *   - Le composant se met à jour en temps réel quand l'utilisateur modifie le
 *     `VariablesForm`.
 *
 * Channel choice — tenant cascade (`TENANT_CASCADE` =
 * `[web_push, wallet_push, email]`, `marketingCascade.ts`): PUSH is the V1
 * primary channel for tenant campaigns; the email fallback is the deterministic
 * last leg of the cascade. The preview surface renders BOTH a push mock and an
 * email mock so the gérant sees what each surface will look like. We don't
 * branch on a per-template channel field: every tenant template goes through
 * the same cascade (same logic the `TemplateCard` picker uses).
 *
 * Scope (#215 hard constraint): only this folder under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/[templateId]/`. Zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 *
 * MOAT / isolation: pure presentational preview — no query, no mutation, no
 * recipient identity. Isolation owned upstream (the `listTenantTemplates`
 * `tenantQuery({ allow: ["kb_manager"] })` wrapper, ADR 0010, fuzzed in
 * `listTenantTemplates.test.ts`).
 */

"use client";

import {
  MAX_RENDERED_LENGTH,
  type TemplateVariable,
} from "@packages/backend/convex/lib/notifications";
import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { renderTemplatePreview } from "../_lib/renderTemplatePreview";

export type CampaignPreviewProps = {
  /** The pre-validated template picked by the gérant (backend projection from
   *  `listTenantTemplates`). Drives the rendered body + the alcohol/language
   *  bound checks. */
  template: TenantTemplateSummary;
  /** Live variable values from the upstream `VariablesForm`. Controlled prop
   *  — the parent owns the state, this component is fully derived from
   *  `template + values` (true live update). */
  values: Partial<Record<TemplateVariable, string>>;
  /** Called when the gérant clicks « Envoyer maintenant » with NO violation.
   *  The button stays disabled when a violation is present, so this is never
   *  called on an invalid render. The slice [5/7] (#192 send wiring) will
   *  plug in the Convex mutation behind this callback. */
  onSubmit: () => void;
};

export function CampaignPreview({
  template,
  values,
  onSubmit,
}: CampaignPreviewProps) {
  // Coerce the partial `Record<TemplateVariable, string>` to the plain string
  // map the pure renderer accepts; undefined values collapse to "" inside
  // `renderTemplate`, mirror of the backend's benign-blank semantics.
  const valuesMap: Record<string, string> = {};
  for (const k of Object.keys(values) as TemplateVariable[]) {
    const v = values[k];
    if (v !== undefined) valuesMap[k] = v;
  }

  const { rendered, violation } = renderTemplatePreview(template, valuesMap);
  const overflow = rendered.length >= MAX_RENDERED_LENGTH;
  const disabled = violation !== null;

  return (
    <div className="flex flex-col gap-4" data-slot="campaign-preview">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Aperçu
      </h2>

      {/* Channel mocks — tenant cascade renders both push + email surfaces.
       *  The push surface is the V1 primary (Web Push > Wallet > Email). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PushMock label={template.label} body={rendered} />
        <EmailMock label={template.label} body={rendered} />
      </div>

      {/* Counter — < 200 chars (vert / rouge selon overflow).
       *  `data-slot="campaign-preview-counter"` lets the test pin the element. */}
      <div
        data-slot="campaign-preview-counter"
        className={cn(
          "text-xs font-medium tabular-nums",
          overflow ? "text-destructive" : "text-[#1B7A3D]",
        )}
      >
        {rendered.length} / {MAX_RENDERED_LENGTH} caractères
      </div>

      {/* Violation banner — inline FR copy when present. */}
      {violation !== null ? (
        <div
          data-slot="campaign-preview-violation"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {violation.message}
        </div>
      ) : null}

      {/* Send button — enabled iff no violation. Disabled state carries a
       *  `title` attribute (tooltip) with the FR violation message so the
       *  gérant understands WHY the button is greyed out (issue body:
       *  « tooltip ou inline expliquant la violation »). */}
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={disabled}
          title={violation?.message}
          onClick={() => {
            if (!disabled) onSubmit();
          }}
          data-slot="button"
          className="bg-[#1B7A3D] hover:bg-[#1B7A3D]/90"
        >
          Envoyer maintenant
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mock surfaces — visual approximations of each channel. Kept INLINE because
// they are tiny presentational primitives, used only here, and pinning them
// in the test would obscure the preview's intent. The `data-slot` markers
// give the test a stable hook regardless of styling iteration.
// ---------------------------------------------------------------------------

type ChannelMockProps = { label: string; body: string };

function PushMock({ label, body }: ChannelMockProps) {
  return (
    <div
      data-slot="campaign-preview-mock"
      data-channel="push"
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 rounded bg-[#1B7A3D]"
        />
        <span>Notification push</span>
      </div>
      <div className="mt-2 text-sm font-semibold">{label}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
        {body}
      </p>
    </div>
  );
}

function EmailMock({ label, body }: ChannelMockProps) {
  return (
    <div
      data-slot="campaign-preview-mock"
      data-channel="email"
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 rounded bg-[#E5A100]"
        />
        <span>E-mail</span>
      </div>
      <div className="mt-2 text-sm font-semibold">Objet : {label}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
        {body}
      </p>
    </div>
  );
}
