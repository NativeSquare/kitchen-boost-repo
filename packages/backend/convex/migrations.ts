import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components } from "./_generated/api.js";
import { DataModel } from "./_generated/dataModel.js";
import { mutation } from "./_generated/server.js";
import { acquisitionSource } from "./table/prospects.js";
import { bundledSeedProspects } from "./lib/onboarding/seedData.js";
import { findProspectByPhone, insertProspect } from "./lib/tenancy/index.js";

export const migrations = new Migrations<DataModel>(components.migrations);
export const runAll = migrations.runner();

/**
 * 2.9-B — one-shot seed of `crm_prospects.csv` into `prospects` (PRD 70 §3.4,
 * Q70-Q7 "migration one-shot script au build"). Run with
 * `npx convex run migrations:seedProspectsFromCsv` (or `--prod`).
 *
 * Behaviour mandated by the issue:
 *  - NO-OP when the CSV is absent: the bundled payload is EMPTY (the CSV is not
 *    versioned — it would contain real prospect PII, which must not be committed;
 *    see `lib/onboarding/seedData.ts`), so `bundledSeedProspects()` returns `[]`
 *    and nothing is inserted.
 *  - IDEMPOTENT: dedups on the natural key (`phone`) via `findProspectByPhone`, so
 *    re-running the seed (or running it after a partial import) inserts NO
 *    duplicates.
 *
 * It is a plain (deploy-time) mutation, NOT a tenancy-wrapped business function:
 * it seeds the KB-ADMIN-GLOBAL `prospects` table at provisioning time, before any
 * `kb_admin` is necessarily authenticated, so it reaches the table ONLY through
 * the sanctioned `lib/tenancy` store seam (`insertProspect` / `findProspectByPhone`)
 * — never raw `ctx.db.query("prospects")` here (`no-untenanted-query`, ADR 0010).
 *
 * `rows` is an OPTIONAL override (tests / a controlled local import) — when
 * omitted the bundled (empty) dataset is used. Returns the count of rows actually
 * inserted (0 on a no-op / fully-idempotent re-run).
 */
export const seedProspectsFromCsv = mutation({
  args: {
    rows: v.optional(
      v.array(
        v.object({
          name: v.string(),
          phone: v.string(),
          source: acquisitionSource,
          score: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<number> => {
    const rows = args.rows ?? bundledSeedProspects();
    let inserted = 0;
    for (const row of rows) {
      const existing = await findProspectByPhone(ctx, row.phone);
      if (existing !== null) continue; // idempotent: already seeded.
      await insertProspect(ctx, {
        name: row.name,
        phone: row.phone,
        source: row.source,
        score: row.score,
      });
      inserted += 1;
    }
    return inserted;
  },
});
