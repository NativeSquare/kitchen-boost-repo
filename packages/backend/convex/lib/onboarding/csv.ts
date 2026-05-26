/**
 * 2.9-B — pure parser for the legacy `crm_prospects.csv` seed (PRD 70 §3.4,
 * Q70-Q7 "migration one-shot script au build").
 *
 * The CSV is NOT versioned in the repo yet (the issue is explicit), so this is
 * the deterministic transform the seed migration uses on whatever CSV content it
 * is given. It is INTENTIONALLY conservative:
 *  - an empty / blank / header-only CSV yields `[]` — it NEVER fabricates a
 *    prospect (the seed must be a no-op when the file is absent);
 *  - the only enums it validates are those fixed by the schema/PRD (`source`);
 *    no prospect lifecycle field is invented.
 *
 * This is a PURE function (no `ctx`, no I/O), unit-tested in isolation; the seed
 * migration (convex/migrations.ts) feeds it a string and inserts the result
 * idempotently. Kept tiny on purpose — the legacy CSV is a flat, KB-authored
 * `build_crm_html.py` export, not arbitrary third-party CSV (no quoted-comma /
 * multiline-field handling needed).
 */

/** The 4 acquisition channels — MUST match `acquisitionSource` in table/prospects.ts. */
const ACQUISITION_SOURCES = [
  "cold_call",
  "whatsapp",
  "referral",
  "visite_physique",
] as const;

type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

/** A parsed CSV row mapped to the minimal `prospects` create shape. */
export type SeedProspect = {
  name: string;
  phone: string;
  source: AcquisitionSource;
  score?: number;
};

function isAcquisitionSource(value: string): value is AcquisitionSource {
  return (ACQUISITION_SOURCES as readonly string[]).includes(value);
}

/**
 * Parse the raw `crm_prospects.csv` text into validated seed rows. Returns `[]`
 * for an empty / blank / header-only input. Throws a precise error on a malformed
 * row (missing required `name`/`phone`, or an unknown `source`) rather than
 * silently importing garbage.
 */
export function parseProspectsCsv(csv: string): SeedProspect[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Empty or header-only → nothing to seed.
  if (lines.length <= 1) return [];

  const header = lines[0].split(",").map((c) => c.trim());
  const nameIdx = header.indexOf("name");
  const phoneIdx = header.indexOf("phone");
  const sourceIdx = header.indexOf("source");
  const scoreIdx = header.indexOf("score");

  if (nameIdx === -1 || phoneIdx === -1 || sourceIdx === -1) {
    throw new Error(
      "crm_prospects.csv must have name, phone and source columns.",
    );
  }

  return lines.slice(1).map((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const rowNo = i + 1;

    const name = cells[nameIdx] ?? "";
    const phone = cells[phoneIdx] ?? "";
    const source = cells[sourceIdx] ?? "";

    if (name.length === 0) {
      throw new Error(`crm_prospects.csv row ${rowNo}: missing name.`);
    }
    if (phone.length === 0) {
      throw new Error(`crm_prospects.csv row ${rowNo}: missing phone.`);
    }
    if (!isAcquisitionSource(source)) {
      throw new Error(
        `crm_prospects.csv row ${rowNo}: unknown source "${source}".`,
      );
    }

    const row: SeedProspect = { name, phone, source };

    // Optional score: a blank cell stays absent (not 0).
    const rawScore = scoreIdx === -1 ? "" : (cells[scoreIdx] ?? "");
    if (rawScore.length > 0) {
      const score = Number(rawScore);
      if (!Number.isFinite(score)) {
        throw new Error(
          `crm_prospects.csv row ${rowNo}: invalid score "${rawScore}".`,
        );
      }
      row.score = score;
    }

    return row;
  });
}
