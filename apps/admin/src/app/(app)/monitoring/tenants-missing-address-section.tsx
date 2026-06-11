"use client";

/**
 * Address-first slice 4 (2026-06-11) — `TenantsMissingAddressSection`
 * (follow-up to PRs #484/#485/#486).
 *
 * Pure presentational section rendered BELOW the incidents table on the KB
 * Admin `/monitoring` page. Lists every ALREADY-active tenant whose 4-tuple
 * (`address` + `addressLat` + `addressLng` + `addressComponents`) is
 * incomplete — the legacy rows that were activated BEFORE the slice-3
 * activation gate (#486) landed.
 *
 * Why a separate section (not a 5th incident kind)? Conceptually these are
 * NOT live ops incidents — they don't fire / clear on a webhook, they don't
 * have a severity ladder, and the resolution path is HUMAN-driven (contact
 * the resto, walk the gérant through the new editor). Mixing them into the
 * incidents table would pollute the filters and the severity badge logic.
 *
 * Page wiring (`page.tsx`) feeds this component via
 * `useQuery(api.lib.admin.addressAudit.listTenantsWithMissingAddress)`
 * — root-gated by `kbAdminQuery` on the backend. The section itself is a
 * pure callable (vitest pins every branch without jsdom/Convex).
 */
import Link from "next/link";

import type { TenantMissingAddressRow } from "@packages/backend/convex/lib/admin/addressAudit";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type TenantsMissingAddressSectionProps = {
  /** Rows from `useQuery(api.lib.admin.addressAudit.listTenantsWithMissingAddress)`. */
  rows: TenantMissingAddressRow[] | undefined;
};

export function TenantsMissingAddressSection({
  rows,
}: TenantsMissingAddressSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">
          Tenants sans adresse configurée
        </h2>
        <p className="text-muted-foreground text-sm">
          Tenants déjà actifs dont l&apos;adresse 4-tuple (display +
          latitude/longitude + composants Google Places) est incomplète. Le
          gérant doit la re-saisir via la page Paramètres pour que le devis Uber
          Direct fonctionne.
        </p>
      </div>
      <SectionBody rows={rows} />
    </section>
  );
}

function SectionBody({
  rows,
}: {
  rows: TenantMissingAddressRow[] | undefined;
}) {
  if (rows === undefined) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-muted-foreground text-sm">Chargement en cours…</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-muted-foreground text-sm">
          Aucun tenant à migrer — chaque resto actif a une adresse Google Places
          complète.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead>Slug</TableHead>
            <TableHead>Nom</TableHead>
            <TableHead>Champs manquants</TableHead>
            <TableHead>Lien</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row._id}>
              <TableCell className="font-mono text-xs">{row.slug}</TableCell>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>
                <MissingFieldsBadges row={row} />
              </TableCell>
              <TableCell>
                <Link
                  href={`/t/${row._id}/parametres`}
                  className="text-blue-600 hover:underline"
                >
                  Ouvrir paramètres
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MissingFieldsBadges({ row }: { row: TenantMissingAddressRow }) {
  // Render one badge per missing field so the kb_admin sees AT A GLANCE
  // whether the legacy tenant is fully bare (no address at all) or just
  // missing the structured siblings (display-string-only legacy).
  const fields: { key: string; missing: boolean; label: string }[] = [
    { key: "address", missing: row.missingAddress, label: "address" },
    { key: "lat", missing: row.missingLat, label: "lat" },
    { key: "lng", missing: row.missingLng, label: "lng" },
    {
      key: "components",
      missing: row.missingComponents,
      label: "components",
    },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {fields
        .filter((f) => f.missing)
        .map((f) => (
          <Badge
            key={f.key}
            variant="outline"
            className="border-orange-200 bg-orange-50 text-orange-700"
          >
            {f.label}
          </Badge>
        ))}
    </div>
  );
}
