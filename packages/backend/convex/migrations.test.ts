import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives at
// the convex root, so same-dir keys are already "./x" — no normalisation needed.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

/**
 * 2.9-B — `seedProspectsFromCsv` one-shot import of `crm_prospects.csv` into
 * `prospects` (PRD 70 §3.4, Q70-Q7), written BEFORE the implementation (TDD red).
 *
 * The CSV is NOT versioned yet, so:
 *  - it must be a NO-OP when the bundled dataset is absent/empty (the default), and
 *  - it must be IDEMPOTENT (re-running inserts no duplicates), deduping on the
 *    natural key (phone).
 *
 * The seed mutation takes an optional `rows` override so the import path can be
 * exercised without committing real prospect PII to the repo (the default run
 * reads the EMPTY bundled dataset → no-op).
 */

describe("2.9-B seedProspectsFromCsv", () => {
  it("is a no-op when the bundled CSV is absent (default empty dataset)", async () => {
    const t = convexTest(schema, modules);
    const inserted = await t.mutation(api.migrations.seedProspectsFromCsv, {});
    expect(inserted).toBe(0);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("prospects").collect(),
    );
    expect(rows).toEqual([]);
  });

  it("imports sample rows into prospects", async () => {
    const t = convexTest(schema, modules);
    const inserted = await t.mutation(api.migrations.seedProspectsFromCsv, {
      rows: [
        {
          name: "L'Artisan",
          phone: "0612345678",
          source: "cold_call",
          score: 80,
        },
        { name: "La Table Libanaise", phone: "0700000000", source: "referral" },
      ],
    });
    expect(inserted).toBe(2);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("prospects").collect(),
    );
    expect(rows.length).toBe(2);
    const artisan = rows.find((r) => r.name === "L'Artisan");
    expect(artisan?.phase).toBe("acquisition");
    expect(artisan?.source).toBe("cold_call");
    expect(artisan?.score).toBe(80);
  });

  it("is idempotent — re-running inserts no duplicates (dedup on phone)", async () => {
    const t = convexTest(schema, modules);
    const rows = [
      { name: "L'Artisan", phone: "0612345678", source: "cold_call" as const },
    ];
    const first = await t.mutation(api.migrations.seedProspectsFromCsv, {
      rows,
    });
    const second = await t.mutation(api.migrations.seedProspectsFromCsv, {
      rows,
    });
    expect(first).toBe(1);
    expect(second).toBe(0); // already present → skipped

    const all = await t.run(async (ctx) => ctx.db.query("prospects").collect());
    expect(all.length).toBe(1);
  });
});
