/**
 * F-COMMANDES-CSV-EXPORT (#244) — `orders-csv`, the deep pure module that
 * serialises a list of orders to a downloadable CSV string and triggers a
 * browser download.
 *
 * Two responsibilities, both isolated under their own tests:
 *
 *  1. `ordersToCsv(orders): string` — pure function, no DOM, no I/O. Turns a
 *     `Doc<"orders">[]` payload into the comptable-friendly CSV string the
 *     « Exporter CSV » button hands to the browser. The headers are FR-snake-
 *     case so the comptable's spreadsheet parses them as cells, not as a free
 *     sentence. The serialiser is the MOAT last-line-of-defence (ADR 0010 /
 *     Article 2 ter): even if a future regression makes a customer coordinate
 *     available in the order payload, the serialiser MUST NOT emit it (the
 *     fixed column list in `CSV_HEADERS` is the closed contract pinned by the
 *     test suite).
 *
 *  2. `downloadCsv(filename, csv): void` — the ONLY place that knows about
 *     `URL.createObjectURL` + `<a download>` for CSVs. Wraps the CSV string
 *     in a `text/csv;charset=utf-8` Blob, creates an object URL, mounts a
 *     hidden anchor, clicks it, removes it, and revokes the URL. The helper
 *     is deliberately tiny — its V1 contract matches the issue body « Aucun
 *     endpoint backend (decision actee EPIC #141) » verbatim.
 *
 * Format (issue body verbatim — also pinned by `orders-csv.test.ts`):
 *  - UTF-8 + BOM (`U+FEFF`) en tête (Excel FR compat — without it, an
 *    accentué cell renders as garbage).
 *  - Séparateur `;` (Excel FR sépare par `;` par défaut, pas `,`).
 *  - Échappement RFC 4180 : champ contenant `;`, `"` ou newline → entouré de
 *    `"…"`, `"` internes doublés.
 *  - En-têtes FR snake_case :
 *    `id;date;statut;mode;source;sous_total_centimes;frais_livraison_centimes;
 *    total_centimes;paye_le;refuse_le`.
 *  - Dates au format ISO 8601 (Date.toISOString() — `YYYY-MM-DDTHH:mm:ss.sssZ`).
 *  - AUCUNE coordonnée client (MOAT, Article 2 ter contrat, ADR 0010). Pas
 *    d'email, pas de téléphone, pas de nom client, pas d'adresse, pas de
 *    lat/lng.
 *
 * Tests run under `environment: "node"`. `downloadCsv` uses `globalThis.URL`
 * and `globalThis.document` (Next.js client component context); the test
 * mounts a minimal shim so we don't pull jsdom into the lean test env.
 *
 * Scope discipline (#244): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";

/**
 * The closed list of CSV columns the export emits. Single source of truth —
 * pinned by `orders-csv.test.ts`. The labels are FR snake_case (cells parse
 * cleanly in Excel FR; no accents in the header itself so a comptable can
 * filter on `paye_le` without typing the « é »).
 *
 * Why a closed list (no `(keyof Doc<"orders">)[]` derivation): the order doc
 * carries customer-coordinate fields (`address`, `lat`, `lng`) that MUST
 * NEVER reach the CSV (MOAT — ADR 0010 / Article 2 ter). An explicit literal
 * list is the only way to guarantee a future schema addition doesn't
 * silently slip into the export; the negative test `MOAT — no header
 * references any customer PII concept` keeps the list honest.
 */
export const CSV_HEADERS = [
  "id",
  "date",
  "statut",
  "mode",
  "source",
  "sous_total_centimes",
  "frais_livraison_centimes",
  "total_centimes",
  "paye_le",
  "refuse_le",
] as const;

/** UTF-8 BOM — Excel FR's « this file is UTF-8 » marker. */
const UTF8_BOM = "﻿";

/** RFC 4180 — wrap a cell in `"…"` if it contains a separator, quote, or newline. */
function escapeCsvCell(value: string): string {
  if (
    value.includes(";") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Render an optional epoch as an ISO 8601 string, or empty when absent. */
function formatIsoOrEmpty(epochMs: number | undefined): string {
  if (epochMs === undefined) return "";
  // The backend writes finite epochs (`Date.now()`); defensive check guards
  // against the regression case (NaN / Infinity would crash `toISOString`).
  if (!Number.isFinite(epochMs)) return "";
  return new Date(epochMs).toISOString();
}

/** Render an optional centimes integer, or empty when absent. */
function formatCentimesOrEmpty(centimes: number | undefined): string {
  if (centimes === undefined) return "";
  // Bare integer — no comma decimal, no euro sign. The comptable parses
  // these directly into their accounting spreadsheet.
  return String(centimes);
}

/**
 * Build the data row for a single order. The cell order matches `CSV_HEADERS`
 * (same length, same order — drift is caught by the test suite).
 */
function orderToRow(order: Doc<"orders">): string[] {
  return [
    escapeCsvCell(String(order._id)),
    escapeCsvCell(new Date(order.createdAt).toISOString()),
    escapeCsvCell(order.status),
    escapeCsvCell(order.mode),
    escapeCsvCell(order.source),
    formatCentimesOrEmpty(order.pricingSnapshot?.subtotal),
    formatCentimesOrEmpty(order.pricingSnapshot?.deliveryFee),
    formatCentimesOrEmpty(order.pricingSnapshot?.total),
    escapeCsvCell(formatIsoOrEmpty(order.paidAt)),
    escapeCsvCell(formatIsoOrEmpty(order.refusedAt)),
  ];
}

/**
 * Serialise a list of orders as a CSV string ready for browser download.
 * Pure — same input gives same output, no I/O, no date-of-day surprises.
 *
 * The output starts with the UTF-8 BOM (Excel FR compat), then the header
 * line, then one line per order (in input order — backend already returned
 * DESC by createdAt, the page may have applied a filter; the serialiser is
 * neutral on both).
 */
export function ordersToCsv(orders: Doc<"orders">[]): string {
  const headerLine = CSV_HEADERS.join(";");
  const dataLines = orders.map((o) => orderToRow(o).join(";"));
  return UTF8_BOM + [headerLine, ...dataLines].join("\n") + "\n";
}

/**
 * Trigger a browser download of the given CSV string under the given filename.
 *
 * Implementation: wrap the CSV in a `text/csv;charset=utf-8` Blob, create an
 * object URL, mount a hidden anchor, click it, then revoke the URL.
 *
 * Throws on an empty filename — the page builds it from
 * `tenantSlug + YYYYMMDD`, so an empty filename is a contract violation
 * (defensive — would otherwise produce an unnamed download Excel can't
 * persist).
 *
 * Surfaces a `text/csv;charset=utf-8` MIME — Excel FR + Numbers + Google
 * Sheets all detect it correctly. The `;` separator on the wire is enough
 * for Excel FR to auto-detect French-locale parsing.
 */
export function downloadCsv(filename: string, csv: string): void {
  if (filename.length === 0) {
    throw new Error("downloadCsv: filename must be non-empty");
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    // Hide so it doesn't flash before being clicked.
    if (anchor.style) anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    // Remove the anchor first, THEN revoke the URL — some browsers cancel
    // the in-flight download if the URL goes away before the click is
    // observed by the navigation pipeline. The `remove()` path is the
    // canonical cleanup (works in every modern browser).
    if (typeof anchor.remove === "function") {
      anchor.remove();
    } else if (anchor.parentNode) {
      anchor.parentNode.removeChild(anchor);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Build the canonical export filename: `commandes_<tenantSlug>_<YYYYMMDD>.csv`.
 *
 * Exposed so the page can call it without duplicating the date formatting.
 * Pure — `now` defaults to `Date.now()` and is overridable for tests.
 *
 *  - `tenantSlug` already passes the kebab-case/slug invariant upstream
 *    (provisioning emits `[a-z0-9-]+`), so we don't re-sanitise here.
 *  - `YYYYMMDD` is computed in UTC — same convention as the `formatOrderDate`
 *    helper (deterministic across CI / Paris machines, no
 *    accidentally-different filename if the gérant exports at 23h45 Paris
 *    vs. 00h15).
 */
export function buildCsvFilename(
  tenantSlug: string,
  now: number = Date.now(),
): string {
  const d = new Date(now);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `commandes_${tenantSlug}_${yyyy}${mm}${dd}.csv`;
}
