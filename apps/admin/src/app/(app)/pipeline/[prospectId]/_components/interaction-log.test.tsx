/**
 * F-PIPELINE-CRM 08 (#263) — `InteractionLog` test matrix.
 *
 * Pure presentational timeline rendered on the supervision fiche
 * (`prospect-fiche-view.tsx`). Same React-tree-serializer pattern as
 * `milestone-checklist.test.tsx` — admin vitest runs the lean `node`
 * env (no jsdom).
 *
 * Issue #263 — « Timeline antichronologique des interactions du
 * prospect ; chaque entrée : date relative, canal (icône), note ;
 * bouton "Logger interaction" en haut → ouvre form modal ; nouvelle
 * interaction apparaît en tête (réactivité Convex) ».
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { InteractionLog } from "./interaction-log";
import { allText, flatten, serialize } from "../../_components/test-utils";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

type SerializedShape = ReturnType<typeof serialize>;

function baseProps(
  overrides: Partial<Parameters<typeof InteractionLog>[0]> = {},
) {
  return {
    prospectId: PROSPECT_ID,
    interactions: [],
    onLog: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("InteractionLog — F-PIPELINE-CRM 08 (#263) runtime", () => {
  it("renders the « Logger interaction » trigger button", () => {
    const tree = serialize(InteractionLog(baseProps()));
    const text = allText(tree);
    expect(text).toMatch(/logger interaction/i);
  });

  it("renders an empty-state message when no interaction is logged", () => {
    const tree = serialize(InteractionLog(baseProps({ interactions: [] })));
    const text = allText(tree);
    expect(text).toMatch(/aucune interaction|pas encore/i);
  });

  it("orders interactions antichronologically (most recent first)", () => {
    const interactions = [
      {
        note: "old call",
        date: 1_700_000_000_000,
        canal: "cold_call" as const,
      },
      {
        note: "fresh visit",
        date: 1_800_000_000_000,
        canal: "visite_physique" as const,
      },
    ];
    const tree = serialize(InteractionLog(baseProps({ interactions })));
    const rows = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedShape[];
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] === "interaction-row",
    );
    expect(rows.length).toBe(2);
    expect(rows[0]?.props["data-date"]).toBe(1_800_000_000_000);
    expect(rows[1]?.props["data-date"]).toBe(1_700_000_000_000);
  });

  it("renders each interaction's note + canal label", () => {
    const interactions = [
      {
        note: "Premier appel",
        date: 1_800_000_000_000,
        canal: "cold_call" as const,
      },
      {
        note: "RDV physique posé",
        date: 1_700_000_000_000,
        canal: "visite_physique" as const,
      },
    ];
    const tree = serialize(InteractionLog(baseProps({ interactions })));
    const text = allText(tree);
    expect(text).toContain("Premier appel");
    expect(text).toContain("RDV physique posé");
    expect(text).toMatch(/cold\s*call/i);
    expect(text).toMatch(/visite|physique/i);
  });
});

// ---------------------------------------------------------------------------
// Wiring contract — pins `useMutation(api.lib.onboarding.crm.logInteraction)`
// at the source level (the connected wrapper isn't expandable in `node` env).
// ---------------------------------------------------------------------------
const SOURCE = readFileSync(
  path.resolve(__dirname, "./interaction-log.tsx"),
  "utf8",
);

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

const CODE = stripNonCode(SOURCE);

describe("InteractionLog — F-PIPELINE-CRM 08 (#263) wiring", () => {
  it("fires the canonical `api.lib.onboarding.crm.logInteraction` mutation via Convex `useMutation`", () => {
    expect(CODE).toMatch(/api\.lib\.onboarding\.crm\.logInteraction/);
    expect(CODE).toMatch(/useMutation\(/);
  });

  it("never imports from `apps/web` or `apps/native` (scope discipline)", () => {
    expect(CODE).not.toMatch(/apps\/web/);
    expect(CODE).not.toMatch(/apps\/native/);
  });
});
