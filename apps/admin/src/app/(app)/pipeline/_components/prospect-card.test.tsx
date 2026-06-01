/**
 * F-PIPELINE-CRM 05 (#255) — `ProspectCard` test matrix.
 *
 * Presentational shell rendered inside a Kanban column (one card per
 * prospect). Same React-tree-serializer pattern as
 * `prospect-fiche-view.test.tsx` / `monitoring-view.test.tsx` — the admin
 * vitest config runs `node` env (no DOM, no jsdom). We expand the React tree
 * to plain nodes and assert on text + types.
 *
 * Issue #255 « ProspectCard rend nom + source + score + dernière interaction
 * (date relative) + badge "tenant ✓" si `prospect.tenantId` présent. Click
 * sur la carte → navigation vers `/pipeline/[prospectId]` ».
 *
 * Pins:
 *   - all 4 fields surface (name, source, score, last-interaction date)
 *   - tenant ✓ badge ONLY when `tenantId` is present
 *   - the card wraps a plain `<a>` pointing at `/pipeline/<id>` (the
 *     click target — bare anchor over `next/link` for the same reason as
 *     `provision-launcher-button.tsx`: keeps the React-tree serializer
 *     able to inspect `href` in the lean `node` env)
 *   - empty/absent fields don't print "undefined" garbage (defensive — a
 *     fresh prospect has no score and no interactions)
 */
import { describe, expect, it } from "vitest";

import { ProspectCard } from "./prospect-card";
import type { ProspectCardSnapshot } from "../_lib/prospectFilter";
import { allText, findFirstByName, serialize } from "./test-utils";

function makeProspect(
  overrides: Partial<ProspectCardSnapshot> = {},
): ProspectCardSnapshot {
  return {
    _id: "prospects_xyz",
    name: "L'Artisan",
    phase: "acquisition",
    source: "cold_call",
    score: undefined,
    tenantId: undefined,
    interactions: undefined,
    ...overrides,
  };
}

// Deterministic reference instant used by every test that doesn't care
// about the relative-time vocabulary itself (the card always takes `now`
// as a required prop — see `ProspectCardProps.now` docblock for the
// react-hooks/purity rationale).
const FIXED_NOW = 1_700_000_000_000;

describe("ProspectCard — F-PIPELINE-CRM 05 (#255)", () => {
  it("renders the prospect name", () => {
    const tree = serialize(
      ProspectCard({ prospect: makeProspect(), now: FIXED_NOW }),
    );
    expect(allText(tree)).toContain("L'Artisan");
  });

  it("renders the source label (cold_call → « Cold call »)", () => {
    const tree = serialize(
      ProspectCard({
        prospect: makeProspect({ source: "cold_call" }),
        now: FIXED_NOW,
      }),
    );
    expect(allText(tree)).toMatch(/cold\s*call/i);
  });

  it("renders the score when set", () => {
    const tree = serialize(
      ProspectCard({ prospect: makeProspect({ score: 7 }), now: FIXED_NOW }),
    );
    expect(allText(tree)).toContain("7");
  });

  it("does NOT render 'undefined' / 'NaN' garbage when score is absent (defensive)", () => {
    const tree = serialize(
      ProspectCard({
        prospect: makeProspect({ score: undefined }),
        now: FIXED_NOW,
      }),
    );
    const text = allText(tree);
    expect(text).not.toMatch(/undefined/i);
    expect(text).not.toMatch(/NaN/);
  });

  it("renders the last interaction date relative to NOW (« il y a … »)", () => {
    const now = 1_700_000_000_000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const tree = serialize(
      ProspectCard({
        prospect: makeProspect({
          interactions: [{ date: oneHourAgo, canal: "cold_call", note: "x" }],
        }),
        now,
      }),
    );
    // Relative-time vocabulary in French: « il y a … h / min / j ».
    expect(allText(tree)).toMatch(/il y a/i);
  });

  it("uses the MOST RECENT interaction (last by `date`) when several are logged", () => {
    const now = 1_700_000_000_000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
    const tree = serialize(
      ProspectCard({
        prospect: makeProspect({
          interactions: [
            { date: tenDaysAgo, canal: "cold_call", note: "old" },
            { date: oneDayAgo, canal: "whatsapp", note: "new" },
          ],
        }),
        now,
      }),
    );
    // « 1 j » or « hier » — pick the canonical short form rendered by the
    // component. Must NOT be « 10 j » (the older one).
    const text = allText(tree);
    expect(text).not.toMatch(/10\s*j/);
  });

  it("renders « Aucune interaction » when the prospect has no interactions yet (defensive empty state)", () => {
    const tree = serialize(
      ProspectCard({
        prospect: makeProspect({ interactions: undefined }),
        now: FIXED_NOW,
      }),
    );
    expect(allText(tree)).toMatch(/aucune interaction/i);
  });

  it("renders the « tenant ✓ » badge ONLY when prospect.tenantId is present", () => {
    const withTenant = serialize(
      ProspectCard({
        prospect: makeProspect({ tenantId: "tenants_aaa" }),
        now: FIXED_NOW,
      }),
    );
    expect(allText(withTenant)).toMatch(/tenant\s*[✓✔v]/i);

    const withoutTenant = serialize(
      ProspectCard({
        prospect: makeProspect({ tenantId: undefined }),
        now: FIXED_NOW,
      }),
    );
    expect(allText(withoutTenant)).not.toMatch(/tenant\s*[✓✔v]/i);
  });

  it("wraps the card in an anchor pointing at /pipeline/<prospectId>", () => {
    const tree = serialize(
      ProspectCard({
        prospect: makeProspect({ _id: "prospects_xyz" }),
        now: FIXED_NOW,
      }),
    );
    // Bare `<a>` (not next/link) — same testing-ergonomics rationale as
    // `provision-launcher-button.tsx`. Assert the canonical drill-down URL
    // from issue #255 / EPIC F-PIPELINE-CRM.
    const link = findFirstByName(tree, "a");
    expect(link).not.toBeNull();
    expect(link?.props.href).toBe("/pipeline/prospects_xyz");
  });
});
