/**
 * F-PIPELINE-CRM 08 (#263) — `ExternalLinksPanel` test matrix.
 *
 * Pure presentational panel. Renders 4 external-link buttons:
 *   - Stripe Connect onboarding (disabled today — no
 *     `prospect.stripeConnectOnboardingUrl` field exists in the
 *     `prospects` schema at the time of writing; the issue spec already
 *     plans the disabled-with-tooltip fallback verbatim).
 *   - Odoo (generic Odoo link — no per-contract URL traced yet).
 *   - direct.uber.com (constant URL, opens in a new tab — instructions
 *     copy-paste pour le resto, cf. PRD 70 §3.3).
 *   - WhatsApp deep-link (`wa.me/<tel>`, formatted E.164 — no `+`,
 *     no spaces, FR fallback 33 for a leading 0).
 *
 * Strict format pin on the WhatsApp deep-link (issue spec : « WhatsApp
 * deep-link bien formaté (sans + sans espaces) »).
 */
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { ExternalLinksPanel } from "./external-links-panel";
import { flatten, serialize } from "../../_components/test-utils";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

type SerializedShape = ReturnType<typeof serialize>;

function makeProspect(
  overrides: Partial<Doc<"prospects">> = {},
): Doc<"prospects"> {
  return {
    _id: PROSPECT_ID,
    _creationTime: 1_700_000_000_000,
    name: "L'Artisan",
    phone: "0612345678",
    phase: "acquisition",
    source: "cold_call",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function findSlot(
  tree: SerializedShape,
  slot: string,
): {
  type: string;
  props: Record<string, unknown>;
  children: SerializedShape[];
} | null {
  const matches = flatten(tree).filter(
    (
      n,
    ): n is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedShape[];
    } =>
      n !== null &&
      "type" in n &&
      (n.props as Record<string, unknown>)["data-slot"] === slot,
  );
  return matches[0] ?? null;
}

describe("ExternalLinksPanel — F-PIPELINE-CRM 08 (#263)", () => {
  it("renders the 4 external link slots", () => {
    const tree = serialize(ExternalLinksPanel({ prospect: makeProspect() }));
    expect(findSlot(tree, "external-link-stripe")).not.toBeNull();
    expect(findSlot(tree, "external-link-odoo")).not.toBeNull();
    expect(findSlot(tree, "external-link-uber-direct")).not.toBeNull();
    expect(findSlot(tree, "external-link-whatsapp")).not.toBeNull();
  });

  it("disables the Stripe Connect link when no onboarding URL is set on the prospect", () => {
    const tree = serialize(ExternalLinksPanel({ prospect: makeProspect() }));
    const stripe = findSlot(tree, "external-link-stripe");
    expect(stripe?.props["data-disabled"]).toBe(true);
  });

  it("uses `https://direct.uber.com` as the direct.uber.com link target (canonical URL)", () => {
    const tree = serialize(ExternalLinksPanel({ prospect: makeProspect() }));
    const uber = findSlot(tree, "external-link-uber-direct");
    expect(uber?.props["href"]).toBe("https://direct.uber.com");
    expect(uber?.props["target"]).toBe("_blank");
  });

  it("formats the WhatsApp deep-link as `https://wa.me/<E.164-digits>` with NO + and NO spaces (FR fallback prefix `33`)", () => {
    const tree = serialize(
      ExternalLinksPanel({
        prospect: makeProspect({ phone: "06 12 34 56 78" }),
      }),
    );
    const wa = findSlot(tree, "external-link-whatsapp");
    expect(wa?.props["href"]).toBe("https://wa.me/33612345678");
  });

  it("formats an E.164-already phone correctly (strip the leading +)", () => {
    const tree = serialize(
      ExternalLinksPanel({
        prospect: makeProspect({ phone: "+33 6 12 34 56 78" }),
      }),
    );
    const wa = findSlot(tree, "external-link-whatsapp");
    expect(wa?.props["href"]).toBe("https://wa.me/33612345678");
  });

  it("disables the WhatsApp link when the phone is the empty string (defensive — schema has no v.optional on phone, but a typo seed could yield '')", () => {
    const tree = serialize(
      ExternalLinksPanel({
        prospect: makeProspect({ phone: "" }),
      }),
    );
    const wa = findSlot(tree, "external-link-whatsapp");
    expect(wa?.props["data-disabled"]).toBe(true);
  });
});
