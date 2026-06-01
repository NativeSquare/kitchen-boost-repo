"use client";

/**
 * F-PIPELINE-CRM 08 (#263) — `ExternalLinksPanel`.
 *
 * Pure presentational panel listing the 4 deep-link / external action
 * buttons of the supervision fiche (issue spec) :
 *
 *   - **Stripe Connect onboarding** — disabled today : the `prospects`
 *     schema has no `stripeConnectOnboardingUrl` field at the time of
 *     writing. Issue spec verbatim plans this fallback : « URL
 *     pré-construite si dispo… ; sinon disabled avec tooltip “Pas
 *     encore généré” ». Re-enabling is a follow-up that lands the
 *     field on the prospect doc.
 *   - **Odoo** — generic link target (`https://www.odoo.com`) : the
 *     per-contract Odoo URL is not traced anywhere yet. Issue spec :
 *     « URL Odoo du contrat si tracée, sinon lien Odoo générique ».
 *   - **direct.uber.com** — constant deep-link (`https://direct.uber.com`)
 *     opens in a new tab (PRD 70 §3.3 — instructions copy-paste pour le
 *     resto).
 *   - **WhatsApp** — `wa.me/<E.164-digits>` (no `+`, no spaces). FR
 *     fallback : a leading `0` is replaced by `33`. Issue spec :
 *     « WhatsApp deep-link bien formaté (sans + sans espaces) ».
 *
 * Pure / no Convex hooks — expanded directly by the lean `node` test env.
 *
 * Scope discipline (#263) — lives under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/_components/` only.
 */
import {
  IconBrandStripe,
  IconBrandWhatsapp,
  IconCar,
  IconBuildingStore,
} from "@tabler/icons-react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Canonical Uber Direct merchant URL — operators copy-paste tasks from
 * here onto the partner's tablet (PRD 70 §3.3). Hardcoded — there's no
 * per-tenant variant.
 */
const UBER_DIRECT_URL = "https://direct.uber.com";

/**
 * Generic Odoo link target — the per-contract Odoo URL is NOT traced
 * anywhere on the prospect doc yet (no field on `prospects`). When a
 * field lands (future story), this constant gets replaced by
 * `prospect.odooContractUrl ?? ODOO_FALLBACK_URL`.
 */
const ODOO_FALLBACK_URL = "https://www.odoo.com";

/**
 * Format a free-form FR phone number as the digits-only payload of a
 * `wa.me/` deep-link. Rules :
 *  - strip every non-digit (whitespace, `+`, `-`, dots, parens)
 *  - if the result starts with `0` (FR national format), replace that
 *    leading `0` by `33` (FR country code)
 *  - return `null` for an empty input (the caller disables the link)
 *
 * Pure function — exported for re-use + direct unit-testing if needed.
 */
export function formatWhatsAppPhone(phone: string): string | null {
  const digits = phone.replace(/\D+/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("0")) return `33${digits.slice(1)}`;
  return digits;
}

export type ExternalLinksPanelProps = {
  prospect: Doc<"prospects">;
};

export function ExternalLinksPanel({ prospect }: ExternalLinksPanelProps) {
  // Stripe : no `stripeConnectOnboardingUrl` field exists on the prospect
  // doc today — the link stays disabled. Issue spec already plans this
  // fallback (« sinon disabled avec tooltip "Pas encore généré" »).
  const stripeDisabled = true;
  const stripeTitle = "Pas encore généré";

  const waDigits = formatWhatsAppPhone(prospect.phone);
  const whatsappDisabled = waDigits === null;
  const whatsappHref =
    waDigits === null ? undefined : `https://wa.me/${waDigits}`;

  return (
    <Card data-slot="external-links-panel">
      <CardHeader>
        <CardTitle>Liens externes</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {/* Stripe Connect onboarding — disabled today. */}
        <a
          data-slot="external-link-stripe"
          data-disabled={stripeDisabled}
          aria-disabled={stripeDisabled}
          title={stripeTitle}
          href="#"
          onClick={(e) => e.preventDefault()}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            "pointer-events-none opacity-50",
          )}
        >
          <IconBrandStripe size={16} />
          <span>Ouvrir Stripe Connect onboarding</span>
        </a>

        {/* Odoo — generic link (per-contract URL not traced yet). */}
        <a
          data-slot="external-link-odoo"
          href={ODOO_FALLBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/40"
        >
          <IconBuildingStore size={16} />
          <span>Ouvrir Odoo</span>
        </a>

        {/* direct.uber.com — constant URL, new tab. */}
        <a
          data-slot="external-link-uber-direct"
          href={UBER_DIRECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/40"
        >
          <IconCar size={16} />
          <span>Ouvrir direct.uber.com</span>
        </a>

        {/* WhatsApp deep-link. */}
        <a
          data-slot="external-link-whatsapp"
          data-disabled={whatsappDisabled}
          aria-disabled={whatsappDisabled}
          href={whatsappHref ?? "#"}
          target={whatsappDisabled ? undefined : "_blank"}
          rel={whatsappDisabled ? undefined : "noopener noreferrer"}
          onClick={(e) => {
            if (whatsappDisabled) e.preventDefault();
          }}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/40",
            whatsappDisabled && "pointer-events-none opacity-50",
          )}
        >
          <IconBrandWhatsapp size={16} />
          <span>Ouvrir WhatsApp</span>
        </a>
      </CardContent>
    </Card>
  );
}
