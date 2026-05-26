import { describe, expect, it } from "vitest";
import { parseProspectsCsv } from "./csv";

/**
 * 2.9-B — pure CSV parser for the `crm_prospects.csv` seed (PRD 70 §3.4, Q70-Q7).
 * The CSV is NOT versioned yet (the issue is explicit), so the seed dataset is
 * EMPTY in the repo and the migration is a no-op; this parser is the pure,
 * deterministic transform the seed uses, unit-tested in isolation. It maps the
 * legacy `build_crm_html.py` column shape to the `prospects` insert shape. It
 * NEVER fabricates data: an empty/blank/absent CSV string yields `[]`.
 */

describe("2.9-B parseProspectsCsv", () => {
  it("returns [] for an empty / absent CSV (no fabricated prospects)", () => {
    expect(parseProspectsCsv("")).toEqual([]);
    expect(parseProspectsCsv("   \n  ")).toEqual([]);
  });

  it("returns [] for a header-only CSV", () => {
    expect(parseProspectsCsv("name,phone,source\n")).toEqual([]);
  });

  it("parses a row into the prospect insert shape", () => {
    const rows = parseProspectsCsv(
      "name,phone,source,score\nMalakoff Kebab,0612345678,cold_call,80\n",
    );
    expect(rows).toEqual([
      {
        name: "Malakoff Kebab",
        phone: "0612345678",
        source: "cold_call",
        score: 80,
      },
    ]);
  });

  it("treats blank optional columns as absent (not empty strings)", () => {
    const rows = parseProspectsCsv(
      "name,phone,source,score,email\nResto,0700000000,referral,,\n",
    );
    expect(rows).toEqual([
      { name: "Resto", phone: "0700000000", source: "referral" },
    ]);
  });

  it("trims whitespace and skips blank lines", () => {
    const rows = parseProspectsCsv(
      "name,phone,source\n  A , 0600000001 , whatsapp \n\n B ,0600000002,visite_physique\n",
    );
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(rows[0]?.phone).toBe("0600000001");
    expect(rows[0]?.source).toBe("whatsapp");
  });

  it("rejects a row with an unknown source value", () => {
    expect(() =>
      parseProspectsCsv("name,phone,source\nX,0600000000,linkedin\n"),
    ).toThrow(/source/i);
  });

  it("rejects a row missing the required name or phone", () => {
    expect(() =>
      parseProspectsCsv("name,phone,source\n,0600000000,cold_call\n"),
    ).toThrow(/name/i);
    expect(() =>
      parseProspectsCsv("name,phone,source\nX,,cold_call\n"),
    ).toThrow(/phone/i);
  });
});
