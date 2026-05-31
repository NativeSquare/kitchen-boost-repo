/**
 * F-COMMANDES-CSV-EXPORT (#244) — `ExportCsvButton`, the small controlled
 * button mounted in the Commandes page header.
 *
 * Fully controlled (no internal state, no `useState`):
 *  - The `onClick` prop is the single trigger — the page owns the handler
 *    (it knows the filtered orders + the tenant slug + the filename builder).
 *  - The `disabled` prop is set by the page when there are no orders to
 *    export (`orders === undefined` or `orders.length === 0`). The button
 *    stays mounted in those cases so the page chrome doesn't flash when the
 *    data lands — same discipline as the filters (mounted on every branch).
 *
 * Why a dedicated component (not inline `<Button>` in `commandes-view.tsx`):
 *  - Single-source-of-truth for the « Exporter CSV » label, slot marker, and
 *    button variant; a future surface (V2 keyboard shortcut, V2 scheduled
 *    export) reuses the same component.
 *  - Pinned by `export-csv-button.test.tsx` independent of the view's three
 *    data branches.
 *
 * Scope discipline (#244): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import { Button } from "@/components/ui/button";

export type ExportCsvButtonProps = {
  /** Fired when the gérant clicks the button — page-owned (knows the
   *  filtered orders + the tenant slug + the filename builder). */
  onClick: () => void;
  /** When true, the button renders disabled (no orders to export). */
  disabled: boolean;
};

export function ExportCsvButton({ onClick, disabled }: ExportCsvButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-slot="export-csv-button"
      onClick={onClick}
      disabled={disabled}
    >
      Exporter CSV
    </Button>
  );
}
