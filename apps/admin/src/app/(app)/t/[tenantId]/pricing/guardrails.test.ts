/**
 * F-PRICING-1 (#241) — module-wide static guardrails (greps over every source
 * file in `apps/admin/src/app/(app)/t/[tenantId]/pricing/`).
 *
 * The issue body lists three CROSS-CUTTING bans that must hold on EVERY current
 * AND FUTURE file of the module (slices 2-5 will keep adding files — the test
 * sweeps the directory so the bans apply automatically):
 *
 *   1. Pas de drag-handle DOM — aucune lib `@dnd-kit` / `react-beautiful-dnd`
 *      importée dans ce module.
 *   2. Pas d'affichage de `priority` / `order` — au-delà du DOM (pinned by
 *      pricing-view.test.tsx), pas d'IMPORT structurel ni de constante locale
 *      qui les nommerait.
 *   3. Pas d'import statique vers `api.lib.pricing.evaluate.evaluate` dans tout
 *      le module pricing (le moteur est backend-only, ADR 0013).
 *
 * Greps stay LEXICAL on purpose — a future contributor who needs an exception
 * pays the cost of justifying it on the test name explicitly (e.g. by
 * narrowing the grep), rather than silently slipping a regression past the
 * acceptance criteria.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MODULE_DIR = __dirname;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    // Sweep .ts and .tsx, but skip the test files themselves — they reference
    // the banned strings on purpose (the bans + the test that enforces them).
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx)$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

const SOURCE_FILES = listSourceFiles(MODULE_DIR);

/** Strip comments + template strings so a docstring mentioning a banned word
 *  (e.g. "no draggable here") doesn't false-positive. */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "")
    .replace(/"[^"\n]*"/g, "")
    .replace(/'[^'\n]*'/g, "");
}

describe("F-PRICING-1 (#241) module-wide guardrails", () => {
  it("at least one source file exists (sanity: directory wasn't moved)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
  });

  it("GUARDRAIL 1 — no `@dnd-kit` / `react-beautiful-dnd` import anywhere in the module", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = readFileSync(file, "utf8");
      // The import statement is what we want to ban — pin via the `from "..."`
      // shape so a docstring mentioning dnd-kit doesn't false-positive.
      if (/from\s+["']@dnd-kit/.test(code)) offenders.push(file);
      if (/from\s+["']react-beautiful-dnd/.test(code)) offenders.push(file);
    }
    expect(
      offenders,
      `dnd lib imports found in: ${offenders.join(", ")}`,
    ).toHaveLength(0);
  });

  it("GUARDRAIL 2 — no `priority` / `order` identifier in non-comment code", () => {
    // Lexical scan — the schema doesn't expose these fields, but a slice 2
    // mistake could re-introduce them. We strip comments + strings first so
    // a docstring saying "no order here" doesn't trigger.
    const offenders: { file: string; matches: string[] }[] = [];
    for (const file of SOURCE_FILES) {
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
      const matches: string[] = [];
      // Whole-word match so `formatActionSummary` doesn't trigger on
      // "absorbée" containing "ordre" partial — it doesn't, but pinning
      // \b...\b makes the intent explicit.
      if (/\bpriority\b/.test(code)) matches.push("priority");
      if (/\border\b/.test(code)) matches.push("order");
      if (/\bordre\b/.test(code)) matches.push("ordre");
      if (matches.length > 0) offenders.push({ file, matches });
    }
    expect(
      offenders,
      `priority/order identifier found: ${offenders
        .map((o) => `${o.file} (${o.matches.join(", ")})`)
        .join("; ")}`,
    ).toHaveLength(0);
  });

  it("GUARDRAIL 3 — no import of `api.lib.pricing.evaluate.evaluate` anywhere in the module (engine is backend-only, ADR 0013)", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = readFileSync(file, "utf8");
      // The path is what we ban: `api.lib.pricing.evaluate` in any form,
      // including a chained `.evaluate` on it. We accept the bare `lib.pricing.rules`
      // (the list query) — that's the only sanctioned consumer.
      if (/api\.lib\.pricing\.evaluate/.test(code)) offenders.push(file);
    }
    expect(
      offenders,
      `evaluate import found in: ${offenders.join(", ")}`,
    ).toHaveLength(0);
  });
});
