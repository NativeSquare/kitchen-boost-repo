import { type SeedProspect, parseProspectsCsv } from "./csv";

/**
 * 2.9-B — the bundled `crm_prospects.csv` payload the seed migration imports.
 *
 * The CSV is NOT versioned yet (the issue is explicit) AND it would contain real
 * prospect PII (names + phone numbers of restaurants being prospected) — which
 * must NOT be committed as a repo fixture (no secrets / PII in commits). So the
 * bundled payload is an EMPTY string: a Convex function cannot read an arbitrary
 * file off disk at runtime, so the only way to feed it is to inline the content
 * here, and inlining real PII is forbidden. With an empty payload the seed is a
 * NO-OP — exactly the "no-op when the file is absent" behaviour the issue requires.
 *
 * When the real CSV is provided (locally / in a deploy step), replace this
 * constant's value with the file content (e.g. paste it in, or have a build step
 * inline it) WITHOUT committing the PII to git. The parser + idempotent seed then
 * import it on the next `convex run migrations:seedProspectsFromCsv`.
 */
export const CRM_PROSPECTS_CSV = "";

/** Parsed seed rows from the bundled CSV (empty until the real CSV is supplied). */
export function bundledSeedProspects(): SeedProspect[] {
  return parseProspectsCsv(CRM_PROSPECTS_CSV);
}
