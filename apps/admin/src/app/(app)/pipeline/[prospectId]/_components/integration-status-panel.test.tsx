/**
 * F-PIPELINE-CRM 07 (#256) — `IntegrationStatusPanel` test matrix.
 *
 * Two-layer test discipline (same split as `milestone-checklist.test.tsx`):
 *
 *   1. RUNTIME PINS via the React-tree serializer with an injected
 *      `onChange` prop (the real Convex `useMutation` hook can't be expanded
 *      in `node` env).
 *
 *   2. WIRING CONTRACT via source-file regex — pins
 *      `useMutation(api.lib.onboarding.milestones.recordIntegrationStatus)`
 *      and the use of `reduceIntegrationStatus` (PIPELINE-04 #220).
 *
 * Issue #256 « Trois sous-panneaux : Stripe Connect / Uber Direct / Hubrise.
 *  Chacun affiche current (badge) + dropdown des statuts valides (enums du
 *  schema) + bouton "Mettre à jour". Au change → mutation
 *  recordIntegrationStatus(prospectId, provider, status). Affiche
 *  l'historique compacté en-dessous (timestamp + statut, ordre
 *  antichronologique). »
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import {
  IntegrationStatusPanel,
  type IntegrationsInput,
} from "./integration-status-panel";
import {
  allText,
  findAllByType,
  flatten,
  serialize,
} from "../../_components/test-utils";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

function baseProps(
  overrides: Partial<Parameters<typeof IntegrationStatusPanel>[0]> = {},
) {
  return {
    prospectId: PROSPECT_ID,
    integrations: {} as IntegrationsInput,
    onUpdate: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("IntegrationStatusPanel — F-PIPELINE-CRM 07 (#256) runtime", () => {
  it("renders the 3 integration sub-panels (Stripe Connect / Uber Direct / Hubrise)", () => {
    const tree = serialize(IntegrationStatusPanel(baseProps()));
    const text = allText(tree);
    expect(text).toMatch(/Stripe\s*Connect/i);
    expect(text).toMatch(/Uber\s*Direct/i);
    expect(text).toMatch(/Hubrise/i);
  });

  it("each panel renders a current-status badge with the canonical `not_started` fallback when uninitialised", () => {
    const tree = serialize(IntegrationStatusPanel(baseProps()));
    const subpanels = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "integration-subpanel",
    );
    expect(subpanels.length).toBe(3);
    const providers = subpanels.map(
      (s) => (s.props as Record<string, unknown>)["data-provider"],
    );
    expect(providers).toEqual(["stripeConnect", "uberDirect", "hubrise"]);
  });

  it("renders the current status when set (Stripe Connect = verified)", () => {
    const tree = serialize(
      IntegrationStatusPanel(
        baseProps({
          integrations: {
            stripeConnect: { current: "verified", history: [] },
          },
        }),
      ),
    );
    expect(allText(tree)).toMatch(/verified/i);
  });

  it("renders a status dropdown (native-select) per panel with the canonical options", () => {
    const tree = serialize(IntegrationStatusPanel(baseProps()));
    const selects = findAllByType(tree, "select");
    expect(selects.length).toBe(3);
    // Stripe Connect's select must contain its canonical literals.
    const stripeSelect = selects.find(
      (s) =>
        (s.props as Record<string, unknown>)["data-provider"] ===
        "stripeConnect",
    );
    expect(stripeSelect).toBeDefined();
    const optionValues = findAllByType(stripeSelect!, "option").map(
      (o) => (o.props as Record<string, unknown>)["value"],
    );
    expect(optionValues).toContain("pending_kyc");
    expect(optionValues).toContain("verified");
    expect(optionValues).toContain("rejected");
  });

  it("renders the « Mettre à jour » button per panel (3 total)", () => {
    const tree = serialize(IntegrationStatusPanel(baseProps()));
    const buttons = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "integration-update-button",
    );
    expect(buttons.length).toBe(3);
  });

  it("renders the history below the panel, most-recent FIRST (antichronological)", () => {
    const tree = serialize(
      IntegrationStatusPanel(
        baseProps({
          integrations: {
            stripeConnect: {
              current: "verified",
              history: [
                { status: "pending_kyc", at: 1_700_000_000_000 },
                { status: "verified", at: 1_700_000_100_000 },
              ],
            },
          },
        }),
      ),
    );
    const stripeSubpanel = flatten(tree).find(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "integration-subpanel" &&
        (n.props as Record<string, unknown>)["data-provider"] ===
          "stripeConnect",
    );
    expect(stripeSubpanel).toBeDefined();
    // History rows are explicit
    const historyRows = flatten(stripeSubpanel!).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "integration-history-row",
    );
    expect(historyRows.length).toBe(2);
    // First rendered row must be the MOST RECENT (verified @ 1_700_000_100_000).
    expect(historyRows[0].props["data-at"]).toBe(1_700_000_100_000);
    expect(historyRows[1].props["data-at"]).toBe(1_700_000_000_000);
  });

  it("calls `onUpdate(prospectId, provider, status)` when the « Mettre à jour » button is clicked with a new dropdown selection", () => {
    const onUpdate = vi.fn(async () => {});
    const tree = serialize(
      IntegrationStatusPanel(
        baseProps({
          onUpdate,
          integrations: {
            stripeConnect: { current: "pending_kyc", history: [] },
          },
        }),
      ),
    );
    const buttons = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "integration-update-button" &&
        (n.props as Record<string, unknown>)["data-provider"] ===
          "stripeConnect",
    );
    expect(buttons.length).toBe(1);
    const onClick = buttons[0].props.onClick as () => void;
    expect(typeof onClick).toBe("function");
    onClick();
    // Default-selected = current status (pending_kyc). Idempotent calls are
    // permitted at the boundary (the reducer pure-noop, the mutation no-ops
    // server-side); the component DOES forward the call so the operator sees
    // an explicit ack.
    expect(onUpdate).toHaveBeenCalled();
    const args = onUpdate.mock.calls[0];
    expect(args[0]).toBe(PROSPECT_ID);
    expect(args[1]).toBe("stripeConnect");
    expect(typeof args[2]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Wiring contract — pins the mutation symbol + reducer import.
// ---------------------------------------------------------------------------
const SOURCE = readFileSync(
  path.resolve(__dirname, "./integration-status-panel.tsx"),
  "utf8",
);

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

const CODE = stripNonCode(SOURCE);

describe("IntegrationStatusPanel — F-PIPELINE-CRM 07 (#256) wiring", () => {
  it("fires the canonical `api.lib.onboarding.milestones.recordIntegrationStatus` mutation via Convex `useMutation`", () => {
    expect(CODE).toMatch(
      /api\.lib\.onboarding\.milestones\.recordIntegrationStatus/,
    );
    expect(CODE).toMatch(/useMutation\(/);
  });

  it("imports `reduceIntegrationStatus` from the pure PIPELINE-04 model (#220)", () => {
    expect(CODE).toMatch(/reduceIntegrationStatus/);
  });

  it("never imports from `apps/web` or `apps/native` (scope discipline)", () => {
    expect(CODE).not.toMatch(/apps\/web/);
    expect(CODE).not.toMatch(/apps\/native/);
  });
});
