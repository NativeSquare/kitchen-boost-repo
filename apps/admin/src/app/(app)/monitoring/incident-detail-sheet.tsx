"use client";

/**
 * F-MONITORING — `IncidentDetailSheet` (issue #207, parent EPIC #147).
 *
 * The drill-down panel opened when a KB Admin clicks an incident row in
 * the `/monitoring` table. Wraps the shadcn `Sheet` primitive (Radix
 * Dialog under the hood) so the panel slides in from the right WITHOUT
 * navigating away from the table — keeping the supervision flow in one
 * place (ADR 0014 « Mode supervision »).
 *
 * Layout of the body:
 *
 *   - Title  = the human kind label (e.g. « KYC en attente ») from
 *              `deriveIncidentDisplay`.
 *   - Fields = every raw key/value of the discriminated `Incident`
 *              (optional fields omitted when undefined — see
 *              `toIncidentDetail`).
 *   - Link   = a Next.js `<Link>` to the relevant supervision view, when
 *              `deriveIncidentDisplay.href` is buildable for that kind:
 *                · `kyc_pending`    → `/pipeline/[prospectId]`
 *                · `paid_no_course` → `/t/[tenantId]/commandes` (only with
 *                                     a `tenantId`)
 *                · `webhook_latency` → no link in V1.
 *
 * Body is split out as `IncidentDetailSheetBody` so vitest can invoke it
 * directly in the lean `node` env: the outer `Sheet` (Radix portal)
 * throws outside a real React render and would truncate the serializer's
 * view of the panel.
 */
import Link from "next/link";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { toIncidentDetail } from "./lib";

export type IncidentDetailSheetProps = {
  /** Selected incident, or `null` when the sheet is closed / nothing chosen. */
  incident: Incident | null;
  /** Controlled open flag (owned by the page / `MonitoringView`). */
  open: boolean;
  /** Setter for the open flag — wired to the shadcn Sheet's `onOpenChange`. */
  onOpenChange: (open: boolean) => void;
};

/**
 * Outer wrapper: shadcn `Sheet` (Radix DialogRoot) + the contextual body.
 * Body short-circuits when no incident is selected so the user never sees
 * stale data after closing the panel.
 */
export function IncidentDetailSheet({
  incident,
  open,
  onOpenChange,
}: IncidentDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {incident !== null ? (
          <IncidentDetailSheetBody incident={incident} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Inner body: portal-free so vitest can invoke it directly. Renders the
 * panel title + raw field list + optional contextual link.
 */
export function IncidentDetailSheetBody({ incident }: { incident: Incident }) {
  const detail = toIncidentDetail(incident);
  return (
    <div className="flex flex-col gap-4 p-4">
      <SheetHeader className="p-0">
        <SheetTitle>{detail.typeLabel}</SheetTitle>
        <SheetDescription>kind : {detail.kind}</SheetDescription>
      </SheetHeader>

      <dl className="flex flex-col gap-2 text-sm">
        {detail.fields.map((field) => (
          <div
            key={field.label}
            className="grid grid-cols-[140px_1fr] items-baseline gap-2"
          >
            <dt className="text-muted-foreground font-medium">{field.label}</dt>
            <dd className="break-all">{field.value}</dd>
          </div>
        ))}
      </dl>

      {detail.href !== undefined ? (
        <div>
          <Link
            href={detail.href}
            className="text-sm text-blue-600 underline hover:no-underline"
          >
            Ouvrir
          </Link>
        </div>
      ) : null}
    </div>
  );
}
