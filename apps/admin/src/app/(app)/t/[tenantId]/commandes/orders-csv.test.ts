/**
 * F-COMMANDES-CSV-EXPORT (#244) — `orders-csv`, the deep pure module that
 * serialises a list of orders to a downloadable CSV string and triggers a
 * browser download.
 *
 * Pinned contract of `ordersToCsv(orders): string`:
 *  - AC nominal — 3 varied orders → string CSV starting with the UTF-8 BOM
 *    (U+FEFF), the French headers separated by `;`, then one row per order in
 *    input order (the page already filtered + the backend already sorted DESC
 *    — the CSV preserves both).
 *  - AC RFC 4180 escape — a field containing `;`, `"`, or `\n` is wrapped in
 *    `"…"` and any internal `"` is doubled. The headers themselves never need
 *    escaping (we picked snake_case literals), but data fields might.
 *  - AC optional fields — `paidAt` / `refusedAt` absent → empty cell (literal
 *    empty string, NEVER the string `"undefined"`).
 *  - AC MOAT — no « email », « phone », « name », « customerId », « address »,
 *    « lat », « lng » field surfaces in the CSV. The serialiser is the MOAT
 *    last-line-of-defence: even if a future regression makes those fields
 *    available on the wire (they're already on `Doc<"orders">`), this test
 *    pin keeps them out of the comptable's CSV. The contract is enforced via
 *    BOTH (a) the literal header set and (b) a static scan of the output
 *    against the forbidden keywords.
 *
 * Why a dedicated pure module:
 *  - The serialisation logic is the canonical place for « what does the CSV
 *    look like » — a future surface (V2 schedule send, V2 backend CSV) reuses
 *    the same string, not a re-implementation.
 *  - `downloadCsv(filename, csv)` is the SOLE place that knows about
 *    `URL.createObjectURL` + `<a download>` for CSV; pinning it here means a
 *    regression that drops the `.csv` MIME type or the BOM is caught on the
 *    unit suite, not on the comptable's Excel.
 *
 * Tests run under `environment: "node"` (apps/admin/vitest.config.ts). The
 * `downloadCsv` helper is exercised against a minimal mocked
 * `URL.createObjectURL` / `document.createElement` shim so we don't pull
 * jsdom into the lean test env.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { CSV_HEADERS, downloadCsv, ordersToCsv } from "./orders-csv";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT = "tenants_fixture" as unknown as Id<"tenants">;
const CUSTOMER = "customers_fixture" as unknown as Id<"customers">;

function order(
  partial: Partial<Omit<Doc<"orders">, "_id">> & {
    _id: string;
    createdAt: number;
  },
): Doc<"orders"> {
  const { _id, createdAt, ...rest } = partial;
  return {
    _id: _id as unknown as Id<"orders">,
    _creationTime: createdAt,
    tenantId: TENANT,
    customerId: CUSTOMER,
    status: "nouvelle",
    mode: "delivery",
    source: "direct",
    createdAt,
    ...rest,
  } as Doc<"orders">;
}

// ---------------------------------------------------------------------------
// CSV_HEADERS — the closed list of columns (single source of truth)
// ---------------------------------------------------------------------------
describe("CSV_HEADERS — F-COMMANDES-CSV-EXPORT (#244)", () => {
  it("exposes the documented header list (issue body verbatim)", () => {
    // Issue body: « id;date;statut;mode;source;sous_total_centimes;
    // frais_livraison_centimes;total_centimes;paye_le;refuse_le ». We pin
    // every literal so a future drift (e.g. a translator who renames
    // « paye_le » → « paid_at ») is caught here loudly.
    expect(CSV_HEADERS).toEqual([
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
    ]);
  });

  it("MOAT — no header references any customer PII concept", () => {
    // The CSV is the comptable's surface — Article 2 ter of the contract
    // forbids any customer coordinate from leaving the resto's surface. We
    // pin the negative side of CSV_HEADERS so a future addition that breaks
    // the contract surfaces here before reaching the comptable's mail.
    const forbidden = [
      "email",
      "phone",
      "telephone",
      "name",
      "nom",
      "customerId",
      "customer_id",
      "address",
      "adresse",
      "lat",
      "lng",
    ];
    for (const f of forbidden) {
      expect(CSV_HEADERS).not.toContain(f);
    }
  });
});

// ---------------------------------------------------------------------------
// ordersToCsv — the serialiser
// ---------------------------------------------------------------------------
describe("ordersToCsv — F-COMMANDES-CSV-EXPORT (#244)", () => {
  // -------------------------------------------------------------------------
  // AC nominal — 3 varied orders → string CSV with BOM, headers FR, ';'
  // -------------------------------------------------------------------------
  describe("AC nominal — 3 varied orders → CSV with BOM, French headers, ';' separator", () => {
    it("starts with the UTF-8 BOM (Excel FR compat)", () => {
      const csv = ordersToCsv([
        order({
          _id: "orders_a",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
          status: "livrée",
          paidAt: Date.UTC(2026, 4, 29, 14, 31),
        }),
      ]);
      // U+FEFF — the only character Excel FR reliably reads as « this file is
      // UTF-8 » when the rest of the CSV is `;`-separated.
      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });

    it("emits a header line right after the BOM, ';'-separated, FR labels", () => {
      const csv = ordersToCsv([]);
      const noBom = csv.startsWith("﻿") ? csv.slice(1) : csv;
      // The first line carries the exact headers in order, separated by `;`.
      const firstLine = noBom.split(/\r?\n/)[0];
      expect(firstLine).toBe(
        "id;date;statut;mode;source;sous_total_centimes;frais_livraison_centimes;total_centimes;paye_le;refuse_le",
      );
    });

    it("emits one data row per order, in input order (preserves backend DESC)", () => {
      const csv = ordersToCsv([
        order({
          _id: "orders_a",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
          status: "livrée",
          paidAt: Date.UTC(2026, 4, 29, 14, 31),
          mode: "delivery",
          source: "direct",
        }),
        order({
          _id: "orders_b",
          createdAt: Date.UTC(2026, 4, 29, 13, 15),
          pricingSnapshot: { subtotal: 1250, deliveryFee: 0, total: 1250 },
          status: "collectée",
          paidAt: Date.UTC(2026, 4, 29, 13, 16),
          mode: "pickup",
          source: "direct",
        }),
        order({
          _id: "orders_c",
          createdAt: Date.UTC(2026, 4, 28, 10, 0),
          // Refused order: no `paidAt` (refunded), `refusedAt` set.
          status: "refusée",
          mode: "delivery",
          source: "direct",
          refusedAt: Date.UTC(2026, 4, 28, 10, 5),
        }),
      ]);
      const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
      // 1 header + 3 data rows.
      expect(lines.length).toBe(4);
      // Row order matches input order (no defensive sort here).
      expect(lines[1]).toMatch(/^orders_a;/);
      expect(lines[2]).toMatch(/^orders_b;/);
      expect(lines[3]).toMatch(/^orders_c;/);
    });

    it("serialises numeric centimes as bare integers (no comma, no euro sign — comptable parses these directly)", () => {
      const csv = ordersToCsv([
        order({
          _id: "orders_a",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
          status: "livrée",
        }),
      ]);
      // The 6th / 7th / 8th cells of the only data row are the centimes
      // integers. We assert they appear as `1800`, `200`, `2000` (NOT « 18,00 »
      // / « 18.00 » / « 18,00 € »).
      const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
      const cells = lines[1]?.split(";") ?? [];
      expect(cells[5]).toBe("1800");
      expect(cells[6]).toBe("200");
      expect(cells[7]).toBe("2000");
    });

    it("serialises createdAt / paidAt / refusedAt as ISO 8601 datetime strings", () => {
      // Issue body: « Dates au format ISO 8601 ». Pick a fixed instant so we
      // can pin a regex that matches the canonical
      // `YYYY-MM-DDTHH:mm:ss.sssZ` shape `Date.prototype.toISOString` emits.
      const csv = ordersToCsv([
        order({
          _id: "orders_a",
          createdAt: Date.UTC(2026, 4, 29, 14, 30, 7),
          pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
          status: "livrée",
          paidAt: Date.UTC(2026, 4, 29, 14, 31, 8),
          refusedAt: undefined,
        }),
      ]);
      // `date` is the second cell; ISO 8601 + UTC `Z` is the contract.
      const cells = csv.split(/\r?\n/)[1]?.split(";") ?? [];
      expect(cells[1]).toBe("2026-05-29T14:30:07.000Z");
      // `paye_le` is the 9th cell (zero-based index 8).
      expect(cells[8]).toBe("2026-05-29T14:31:08.000Z");
    });
  });

  // -------------------------------------------------------------------------
  // AC RFC 4180 — escape `;`, `"`, `\n` (wrap in `"…"`, double internal `"`)
  // -------------------------------------------------------------------------
  describe("AC RFC 4180 — escape semicolon / double quote / newline in a field", () => {
    // The fixed columns (id / date / centimes integers / status / mode /
    // source) cannot legitimately contain `;` / `"` / `\n`. But the issue
    // body pins the escape rules as a structural contract — we exercise them
    // via the `escapeCsvCell` predicate the module exports (a regression that
    // would later add a free-text column — restaurantNote in V2 — surfaces
    // here BEFORE production).
    it('wraps a field containing `;` in `"…"`', () => {
      // We pin the predicate's contract by invoking the serialiser on a
      // synthesised order whose id we deliberately set to a string with `;`.
      // The id column is the first cell — it MUST be quoted.
      const csv = ordersToCsv([
        order({
          _id: "orders_with;semicolon" as unknown as string,
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
        }),
      ]);
      const dataLine = csv.split(/\r?\n/)[1] ?? "";
      // The id cell is the first one; the `;` inside it would otherwise be
      // parsed as a column separator by Excel. RFC 4180 escape wraps it in
      // double quotes.
      expect(dataLine.startsWith('"orders_with;semicolon";')).toBe(true);
    });

    it('wraps a field containing `"` in `"…"` and doubles the internal `"`', () => {
      const csv = ordersToCsv([
        order({
          _id: 'orders_with"quote' as unknown as string,
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
        }),
      ]);
      const dataLine = csv.split(/\r?\n/)[1] ?? "";
      // The id cell is wrapped, with internal `"` doubled → `""`.
      expect(dataLine.startsWith('"orders_with""quote";')).toBe(true);
    });

    it('wraps a field containing a newline in `"…"`', () => {
      const csv = ordersToCsv([
        order({
          _id: "orders_with\nnewline" as unknown as string,
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
        }),
      ]);
      // The serialised CSV must contain the literal id wrapped in double
      // quotes — splitting on `\n` would otherwise tear the row in half.
      expect(csv).toContain('"orders_with\nnewline";');
    });

    it('does NOT wrap fields that contain none of `;`, `"`, or `\\n`', () => {
      const csv = ordersToCsv([
        order({
          _id: "orders_plain",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
        }),
      ]);
      const dataLine = csv.split(/\r?\n/)[1] ?? "";
      // The id cell renders bare (no surrounding `"`).
      expect(dataLine.startsWith("orders_plain;")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // AC optional — paidAt / refusedAt absent → empty cells (NOT "undefined")
  // -------------------------------------------------------------------------
  describe("AC optional — missing paidAt / refusedAt → empty cell", () => {
    it("renders empty cells (not « undefined ») when paidAt + refusedAt are absent", () => {
      const csv = ordersToCsv([
        order({
          _id: "orders_pending",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          status: "nouvelle",
          // No paidAt, no refusedAt, no pricingSnapshot.
        }),
      ]);
      const cells = csv.split(/\r?\n/)[1]?.split(";") ?? [];
      // Cell 5/6/7 (snapshot fields), 8 (paye_le), 9 (refuse_le) all empty.
      // We pin the trailing 4 explicitly (issue body « cellules vides, PAS
      // "undefined" »).
      expect(cells[5]).toBe("");
      expect(cells[6]).toBe("");
      expect(cells[7]).toBe("");
      expect(cells[8]).toBe("");
      expect(cells[9]).toBe("");
    });

    it("never emits the literal string `undefined` anywhere in the output", () => {
      const csv = ordersToCsv([
        order({
          _id: "orders_pending",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          status: "en attente de paiement",
        }),
        order({
          _id: "orders_refused",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          status: "refusée",
          refusedAt: Date.UTC(2026, 4, 29, 14, 35),
        }),
      ]);
      expect(csv).not.toMatch(/undefined/);
      expect(csv).not.toMatch(/\bnull\b/);
      expect(csv).not.toMatch(/NaN/);
    });
  });

  // -------------------------------------------------------------------------
  // AC MOAT — no customer coordinate surfaces in the output
  // -------------------------------------------------------------------------
  describe("AC MOAT — no email / phone / name / address / lat / lng in the CSV", () => {
    it("never leaks any customer coordinate even when the order doc carries them", () => {
      // The `Doc<"orders">` schema carries `address` / `lat` / `lng` (delivery
      // mode). The CSV is the comptable's surface — Article 2 ter forbids any
      // customer coordinate from leaving the resto's surface. We pin the
      // negative side: synthesise an order with those fields populated AND
      // assert NONE surface in the output.
      const csv = ordersToCsv([
        order({
          _id: "orders_a",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
          status: "livrée",
          paidAt: Date.UTC(2026, 4, 29, 14, 31),
          address: "12 rue secrète, 75001 Paris",
          lat: 48.8566,
          lng: 2.3522,
          restaurantNote: "Sonner à la porte",
        }),
      ]);
      // The full string must not contain any of these field VALUES nor any
      // of the forbidden header keywords. We use case-insensitive checks so a
      // future capitalisation drift doesn't slip through.
      expect(csv).not.toMatch(/rue secrète/i);
      expect(csv).not.toMatch(/48\.8566/);
      expect(csv).not.toMatch(/2\.3522/);
      expect(csv).not.toMatch(/sonner à la porte/i);
      // Header-side guard (mirrors CSV_HEADERS spec but pinned on the
      // serialised string itself).
      expect(csv).not.toMatch(/\bemail\b/i);
      expect(csv).not.toMatch(/\bphone\b/i);
      expect(csv).not.toMatch(/\btelephone\b/i);
      expect(csv).not.toMatch(/\bname\b/i);
      expect(csv).not.toMatch(/\bcustomer/i);
      expect(csv).not.toMatch(/\baddress\b/i);
      expect(csv).not.toMatch(/\badresse\b/i);
      expect(csv).not.toMatch(/\blat\b/i);
      expect(csv).not.toMatch(/\blng\b/i);
    });

    it("the only `customerId`-shaped reference in the output is the resto-side `id` (the order id, NOT the customer id)", () => {
      // The `id` column carries the `_id` of the order, which prefixes
      // `orders_` (the table-prefixed branded id Convex emits). We pin that
      // a `customers_` prefix NEVER surfaces — a regression that swapped
      // the wrong field into the id column would surface here.
      const csv = ordersToCsv([
        order({
          _id: "orders_a",
          createdAt: Date.UTC(2026, 4, 29, 14, 30),
          pricingSnapshot: { subtotal: 1800, deliveryFee: 200, total: 2000 },
        }),
      ]);
      expect(csv).toMatch(/orders_a/);
      expect(csv).not.toMatch(/customers_/);
    });
  });

  // -------------------------------------------------------------------------
  // Boundary — empty input
  // -------------------------------------------------------------------------
  describe("boundary — empty input", () => {
    it("returns just the BOM + header line (no data rows) when no orders are provided", () => {
      const csv = ordersToCsv([]);
      const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      // The header line is intact even with no data rows.
      const noBom = csv.startsWith("﻿") ? csv.slice(1) : csv;
      expect(noBom.split(/\r?\n/)[0]).toBe(
        "id;date;statut;mode;source;sous_total_centimes;frais_livraison_centimes;total_centimes;paye_le;refuse_le",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// downloadCsv — browser download trigger
// ---------------------------------------------------------------------------
describe("downloadCsv — F-COMMANDES-CSV-EXPORT (#244)", () => {
  // The test env is `environment: "node"` (apps/admin/vitest.config.ts). We
  // mount a minimal shim on the global so the helper has a `URL` + a
  // `document` to talk to. Each test cleans up its own shim so the suite
  // stays isolated.
  type AnchorShim = {
    href?: string;
    download?: string;
    rel?: string;
    style?: { display?: string };
    click: ReturnType<typeof vi.fn>;
    remove?: ReturnType<typeof vi.fn>;
    setAttribute?: (k: string, v: string) => void;
  };

  let createdAnchors: AnchorShim[] = [];
  let appended: AnchorShim[] = [];
  let createdUrls: { blob: unknown; url: string }[] = [];
  let revokedUrls: string[] = [];
  let originalURL: typeof URL;
  let originalDocument: unknown;

  function installShim() {
    originalURL = globalThis.URL;
    originalDocument = (globalThis as { document?: unknown }).document;
    createdAnchors = [];
    appended = [];
    createdUrls = [];
    revokedUrls = [];

    const URLShim = {
      ...originalURL,
      createObjectURL(blob: unknown): string {
        const url = `blob:fixture-${createdUrls.length}`;
        createdUrls.push({ blob, url });
        return url;
      },
      revokeObjectURL(url: string): void {
        revokedUrls.push(url);
      },
    } as unknown as typeof URL;
    (globalThis as { URL: typeof URL }).URL = URLShim;

    (globalThis as { document: unknown }).document = {
      createElement(tag: string): AnchorShim {
        if (tag !== "a") {
          throw new Error(`unexpected createElement tag: ${tag}`);
        }
        const anchor: AnchorShim = {
          click: vi.fn(),
          remove: vi.fn(),
          setAttribute(k: string, v: string) {
            (anchor as unknown as Record<string, string>)[k] = v;
          },
          style: {},
        };
        createdAnchors.push(anchor);
        return anchor;
      },
      body: {
        appendChild(node: AnchorShim) {
          appended.push(node);
        },
        removeChild(_node: AnchorShim) {
          // no-op — `remove()` on the anchor itself handles cleanup
        },
      },
    };
  }

  afterEach(() => {
    (globalThis as { URL: typeof URL }).URL = originalURL;
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it("creates a Blob with the `text/csv;charset=utf-8` MIME type and the CSV body", () => {
    installShim();
    downloadCsv("commandes_demo_20260529.csv", "id;date\nfoo;bar");
    expect(createdUrls.length).toBe(1);
    const blob = createdUrls[0]?.blob as { type?: string; size?: number };
    expect(blob.type).toBe("text/csv;charset=utf-8");
    // The Blob is non-empty.
    expect(typeof blob.size === "number" ? blob.size : 0).toBeGreaterThan(0);
  });

  it("creates an anchor with `download=<filename>` and `href=<object URL>` then clicks it", () => {
    installShim();
    downloadCsv("commandes_demo_20260529.csv", "id;date\nfoo;bar");
    expect(createdAnchors.length).toBe(1);
    const anchor = createdAnchors[0];
    expect(anchor?.download).toBe("commandes_demo_20260529.csv");
    expect(anchor?.href).toBe("blob:fixture-0");
    expect(anchor?.click).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URL after the click (no leak)", () => {
    installShim();
    downloadCsv("commandes_demo_20260529.csv", "id;date\nfoo;bar");
    expect(revokedUrls).toContain("blob:fixture-0");
  });

  it("throws on an empty filename (defensive — the page builds it from tenantSlug + date, never empty)", () => {
    installShim();
    expect(() => downloadCsv("", "id;date\nfoo;bar")).toThrow();
  });
});
