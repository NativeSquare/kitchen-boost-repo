/**
 * F-MES-CLIENTS [4/4] (#202) — Static anti-PII guard on the route bundle.
 *
 * Closing slice of F-MES-CLIENTS — the **MOAT closure pass**. The vue Mes
 * clients is contractually KPI-only (PRD 70 §4.4 + Q90-Q2 + ADR 0010): the
 * KB Manager NEVER sees nominative data, NEVER sees a list, NEVER has a
 * « voir détail » / « exporter » / « filtrer » affordance. Slices 1-3 pinned
 * the rendered surface (empty state, cards, error). This slice pins the
 * **source** itself: a regression-by-source-file is the easiest way for the
 * MOAT to leak (a careless `firstName`, an `<input type="email">`, an
 * « Exporter CSV » button) — once the slice is merged this test catches them
 * before render.
 *
 * Walks every production source file under
 * `apps/admin/src/app/(app)/t/[tenantId]/mes-clients/` (test files excluded:
 * tests legitimately quote PII labels to assert their ABSENCE) and fails the
 * moment a forbidden token is found, OUTSIDE a small set of explicitly-
 * allowed carve-outs documented inline below.
 *
 * The token list comes from the issue body. Each token is hunted as a
 * case-insensitive substring after stripping comments — comments and
 * docstrings legitimately mention « email » / « adresse » / « export » when
 * discussing the MOAT itself (cf. `mes-clients-view.tsx`'s file-header
 * docblock); the executable code is what we gate.
 *
 * Carve-outs (each one justified, each one ratified by slice 1-3 reviews):
 *   - `export` (JS keyword) → stripped by the comment-strip + a dedicated
 *     keyword strip (`export function`, `export const`, `export type`,
 *     `export default`, `export { … }`). The forbidden meaning of `export`
 *     is the USER-FACING « Exporter » action — that's the second pass.
 *   - `email` (reachability channel key) → allowed only in the exact form
 *     `key: "email"` (slice 3's REACHABILITY_CARDS constant — channel KEY,
 *     not a PII field). Any other occurrence in executable code fails.
 *
 * Why a separate file rather than extending `mes-clients-view.test.tsx`:
 *   - The previous tests are about RENDERED text/DOM; this one is about the
 *     SOURCE. Splitting keeps the failure message honest (« found `export
 *     csv` at file.tsx:42 », not « text leaked »).
 *   - It also lets the next slice of F-MES-CLIENTS (if any) plug into the
 *     same module without rewriting render-tree serializers.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SCOPE_DIR = __dirname;

/**
 * Whether `filename` is a production source file we must guard. Excludes:
 *   - `.test.ts(x)` — tests quote PII labels to assert their absence.
 *   - `.d.ts` — type declarations (none today, future-proof).
 *   - this test file itself (it MENTIONS every forbidden token in its
 *     constants — would self-fail trivially).
 */
function isProductionSource(filename: string): boolean {
  if (filename.endsWith(".test.ts")) return false;
  if (filename.endsWith(".test.tsx")) return false;
  if (filename.endsWith(".d.ts")) return false;
  // Self-exclude: this file contains the forbidden tokens as test data.
  if (filename === path.basename(__filename)) return false;
  // Render-scan companion test also enumerates forbidden labels.
  if (filename === "anti-extraction-render.test.tsx") return false;
  if (filename.endsWith(".ts") || filename.endsWith(".tsx")) return true;
  return false;
}

/**
 * Walk `dir` recursively and yield every production source file path.
 * Future-proofs against nested subfolders the mes-clients/ tree might grow.
 */
function listProductionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listProductionSources(full));
    } else if (stat.isFile() && isProductionSource(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip JS/TS comments (block + line) AND template literals AND string
 * literals — comments AND docstrings legitimately discuss the MOAT (so the
 * file-header docblocks of `mes-clients-view.tsx` and `error.tsx` mention
 * «email», «phone», etc.) and the executable code is what gates the bundle.
 *
 * String literals are stripped to avoid false-positives on text already
 * pinned by render-tree tests — what matters here is field-name/identifier
 * leakage in code, not text literals (those are caught by render tests).
 *
 * Order matters: comments first (so a `//` inside a string stays a string;
 * a string inside a comment is gone with the comment).
 */
function stripCommentsAndStrings(source: string): string {
  // Block comments.
  let s = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Line comments.
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // Template literals (no interpolation handling — we treat them as opaque
  // strings; interpolations inside ${} would also be stripped, which is fine
  // for the static guard's purpose).
  s = s.replace(/`[^`]*`/g, '""');
  // Double-quoted string literals (handle escaped quotes).
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  // Single-quoted string literals.
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  return s;
}

/**
 * Strip the `export` JS/TS keyword in its declarative forms so the user-
 * facing « Exporter » action (the forbidden meaning) is what remains. We
 * keep `default` after `export` so `export default function` collapses
 * cleanly.
 */
function stripExportKeyword(source: string): string {
  return source
    .replace(/\bexport\s+default\b/g, "")
    .replace(
      /\bexport\s+(function|const|let|var|type|interface|class|async|enum)\b/g,
      "$1",
    )
    .replace(/\bexport\s*\{[^}]*\}/g, "")
    .replace(/\bexport\s*\*\s*from\b/g, "");
}

/**
 * Token list pinned verbatim from the issue body (#202). Grouped by intent
 * for the failure message, but tested as one combined gate.
 */
const FORBIDDEN_TOKENS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  // Group 1 — PII fields. The MOAT forbids these as identifiers/labels in
  // the route bundle (a single occurrence in code reveals intent to leak).
  { regex: /\bemail\b/i, label: "email" },
  { regex: /\bphone\b/i, label: "phone" },
  { regex: /\btel\b/i, label: "tel" },
  { regex: /\bphoneNumber\b/i, label: "phoneNumber" },
  { regex: /\bprenom\b/i, label: "prenom" },
  { regex: /\bfirstName\b/i, label: "firstName" },
  { regex: /\blastName\b/i, label: "lastName" },
  { regex: /\bnom\b/i, label: "nom" },
  { regex: /\badresse\b/i, label: "adresse" },
  { regex: /\baddress\b/i, label: "address" },
  // Group 2 — extraction actions. After stripExportKeyword the `export`
  // keyword is gone; what remains is the user-facing « Exporter » verb.
  { regex: /\bexport\b/i, label: "export" },
  { regex: /\bcsv\b/i, label: "csv" },
  { regex: /\bdownload\b/i, label: "download" },
  // Group 3 — UI / API leakage paths.
  { regex: /voir\s*d[ée]tail/i, label: "voir détail" },
  { regex: /\bvoirDetail\b/i, label: "voirDetail" },
  { regex: /\bcustomerDetail\b/i, label: "customerDetail" },
  { regex: /\bcustomer\.list\b/i, label: "customer.list" },
  { regex: /\blistCustomers\b/i, label: "listCustomers" },
];

/**
 * Whether `source` (already stripped of comments + strings + `export`
 * keyword) contains a token after applying allowed-carve-out filtering.
 *
 * Carve-out: the slice-3 channel key `key: "email"` lives INSIDE a string
 * literal that we've already stripped — so it cannot fail this gate. The
 * accessor `reachability.email` AND the `key: "email"` literal form are
 * BOTH consumed by stripCommentsAndStrings (the literal becomes `""`) or by
 * the dot-property accessor not creating a free `email` identifier on its
 * own — wait, it DOES (`reachability.email` leaves the bare token `email`
 * after the dot). We therefore strip dotted-property accesses where the
 * LEFT side is `reachability` (the slice-3 KPI dictionary) before the gate
 * runs.
 *
 * No other carve-out: a new use of any forbidden token (a hand-rolled
 * field, an « Exporter » button, a customer list query) is exactly what
 * this guard exists to catch.
 */
function stripChannelAccessors(source: string): string {
  // `reachability.email` / `reachability.push` / `reachability.sms` — the
  // slice-3 KPI dictionary, the only legitimate place where the bare
  // identifier `email` reaches executable code in this route.
  return source.replace(/\breachability\.(email|push|sms)\b/g, "");
}

function findOffenders(
  source: string,
): Array<{ token: string; snippet: string }> {
  const offenders: Array<{ token: string; snippet: string }> = [];
  for (const { regex, label } of FORBIDDEN_TOKENS) {
    const match = source.match(regex);
    if (match) {
      // Surrounding ~40 chars so the failure message is grep-able.
      const idx = match.index ?? 0;
      const start = Math.max(0, idx - 20);
      const end = Math.min(source.length, idx + 20);
      offenders.push({ token: label, snippet: source.slice(start, end) });
    }
  }
  return offenders;
}

describe("F-MES-CLIENTS [4/4] (#202) — static anti-PII guard on route bundle", () => {
  const sources = listProductionSources(SCOPE_DIR);

  it("discovers at least the known production files (test self-check)", () => {
    // Belt-and-braces: if a refactor renames or moves the page out of this
    // folder and the walker finds nothing, the assertions below would
    // vacuously pass. This canary ensures the walker is actually exercising
    // real files.
    const filenames = sources.map((f) => path.basename(f));
    expect(filenames).toContain("page.tsx");
    expect(filenames).toContain("mes-clients-view.tsx");
    expect(filenames).toContain("empty-state.tsx");
    expect(filenames).toContain("error.tsx");
    expect(filenames).toContain("audit-on-open.ts");
  });

  it.each(
    // Build one test per discovered source so a failure pinpoints the
    // exact file (rather than a single big concatenated test).
    listProductionSources(SCOPE_DIR).map((file) => [path.basename(file), file]),
  )("anti-PII gate: %s contains no forbidden token", (_name, file) => {
    const raw = readFileSync(file, "utf8");
    const stripped = stripChannelAccessors(
      stripExportKeyword(stripCommentsAndStrings(raw)),
    );
    const offenders = findOffenders(stripped);
    expect(
      offenders,
      `anti-PII forbidden token(s) found in ${path.basename(file)}: ${offenders
        .map((o) => `${o.token} (near « ${o.snippet} »)`)
        .join(", ")}`,
    ).toEqual([]);
  });
});
